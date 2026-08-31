/**
 * BUILDWE Speech-to-Text — Voice: Listen.
 *
 * The catalog (models-catalog.ts) advertises Whisper (Groq) and Deepgram
 * Nova-2 for transcription. This module gives both a real adapter, mirroring
 * the multi-provider treatment the chat and image paths got: availability-aware
 * selection, a cross-vendor fallback chain, and an honest transcript when no
 * STT provider is configured.
 *
 * Whisper via Groq is OpenAI-compatible (POST /audio/transcriptions with
 * multipart form-data). Deepgram uses its own /v1/listen endpoint with a
 * `?model=nova-2` query and the raw audio as the body.
 *
 * Every call goes through the gateway's timeout wrapper so a hanging STT
 * request cannot pin a serverless instance.
 */

import { AI_KEYS } from "@/lib/config";
import { fetchWithTimeout, TIMEOUTS } from "@/lib/ai/gateway";

/* ── Key sanity ─────────────────────────────────────────── */

function keyOk(v?: string): boolean {
  return Boolean(v && !v.startsWith("your_") && !v.includes("REPLACE"));
}

/* ── Adapters ───────────────────────────────────────────── */

/**
 * Whisper large-v3 via Groq. The Groq endpoint mirrors OpenAI's
 * /audio/transcriptions: multipart/form-data with `file` + `model`.
 */
async function groqWhisper(
  audio: Blob,
  filename: string
): Promise<string | null> {
  const key = AI_KEYS.groq;
  if (!keyOk(key)) return null;

  try {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", "whisper-large-v3");
    form.append("response_format", "json");

    const res = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      },
      TIMEOUTS.complete,
      "stt"
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data?.text?.trim() || null;
  } catch (e) {
    console.error("[bw] groq whisper", (e as Error)?.message);
    return null;
  }
}

/**
 * Deepgram Nova-2. Raw audio body + `?model=nova-2`. Returns a speaker-less
 * transcript by default (`{ results: { channels: [ { alternatives: [{ transcript }] } ] } }`).
 */
async function deepgramNova(
  audio: Blob,
  filename: string
): Promise<string | null> {
  const key = AI_KEYS.deepgram;
  if (!keyOk(key)) return null;

  const mime = audio.type || (filename.endsWith(".webm") ? "audio/webm" : "audio/mpeg");

  try {
    const res = await fetchWithTimeout(
      "https://api.deepgram.com/v1/listen?model=nova-2&punctuate=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": mime,
        },
        // Deepgram accepts raw bytes; Blob works too.
        body: audio,
      },
      TIMEOUTS.complete,
      "stt"
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    };
    const t =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    return t.trim() || null;
  } catch (e) {
    console.error("[bw] deepgram nova", (e as Error)?.message);
    return null;
  }
}

/* ── Public entry point ─────────────────────────────────── */

/**
 * Transcribe an audio clip, walking a real cross-vendor chain:
 * Deepgram Nova-2 first (low-latency live), then Whisper via Groq.
 * Both only run if their key is configured; otherwise we return an honest,
 * still-useful transcript fallback.
 */
export async function transcribeAudio(opts: {
  audio: Blob;
  filename?: string;
}): Promise<{ text: string; provider: string; model: string; live: boolean }> {
  const filename =
    opts.filename || `recording.${opts.audio?.type === "audio/webm" ? "webm" : "m4a"}`;

  // Deepgram Nova-2 — preferred for streaming/live (lowest latency).
  const dg = await deepgramNova(opts.audio, filename);
  if (dg) {
    return { text: dg, provider: "deepgram", model: "Deepgram Nova-2", live: true };
  }

  // Whisper via Groq — fast, multilingual, works for files too.
  const wk = await groqWhisper(opts.audio, filename);
  if (wk) {
    return { text: wk, provider: "groq", model: "Whisper v3", live: true };
  }

  // Honest fallback — never pretend we heard something we didn't.
  return {
    text:
      "Voice-to-text isn't connected right now, so we cannot transcribe this. Your recording is safe and can be sent again as soon as transcription is available — ask the operator of this deployment to enable a transcription provider.",
    provider: "buildwe",
    model: "BUILDWE Voice (preview)",
    live: false,
  };
}
