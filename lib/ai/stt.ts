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
import { modelChain } from "@/lib/ai/models-catalog";
import { availableProvidersFor } from "@/lib/ai/provider-config";
import { noteModelFailure, noteModelSuccess } from "@/lib/ai/model-chain";
import type { ProviderKeys } from "@/lib/ai/provider-registry";

/* ── Key sanity ─────────────────────────────────────────── */

function keyOk(v?: string): boolean {
  return Boolean(v && !v.startsWith("your_") && !v.includes("REPLACE"));
}

/**
 * Endpoint for an STT vendor. Same `AI_BASE_URL_<PROVIDER>` convention the LLM
 * registry uses, so a deployment can route STT through its own egress proxy and
 * the tests can exercise the real multipart/raw-body path offline. Server-side
 * only; never sent to the browser.
 */
function sttEndpoint(provider: "groq" | "deepgram", fallback: string): string {
  const override = (process.env[`AI_BASE_URL_${provider.toUpperCase()}_STT`] || "").trim();
  return /^https?:\/\//.test(override) ? override : fallback;
}

/**
 * Key for an STT vendor: the caller's own key wins, else the platform key.
 * Mirrors how the LLM registry resolves BYOK, and keeps env-var names in
 * exactly one place per vendor.
 */
function sttKeyFor(provider: string, userKeys?: ProviderKeys): string | undefined {
  const own = (userKeys as Record<string, string | undefined> | undefined)?.[provider];
  if (keyOk(own)) return own;
  if (provider === "groq") return AI_KEYS.groq;
  if (provider === "deepgram") return AI_KEYS.deepgram;
  return undefined;
}

/* ── Adapters ───────────────────────────────────────────── */

/**
 * Whisper large-v3 via Groq. The Groq endpoint mirrors OpenAI's
 * /audio/transcriptions: multipart/form-data with `file` + `model`.
 */
async function groqWhisper(
  audio: Blob,
  filename: string,
  modelId: string,
  key?: string
): Promise<string | null> {
  if (!keyOk(key)) return null;

  try {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", modelId);
    form.append("response_format", "json");

    const res = await fetchWithTimeout(
      sttEndpoint("groq", "https://api.groq.com/openai/v1/audio/transcriptions"),
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
  filename: string,
  modelId: string,
  key?: string
): Promise<string | null> {
  if (!keyOk(key)) return null;

  const mime = audio.type || (filename.endsWith(".webm") ? "audio/webm" : "audio/mpeg");

  try {
    const res = await fetchWithTimeout(
      `${sttEndpoint("deepgram", "https://api.deepgram.com/v1/listen")}?model=${encodeURIComponent(modelId)}&punctuate=true`,
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
 * Transcribe an audio clip.
 *
 * The vendor order is NOT written here. It comes from the same catalog +
 * availability path chat, code, image and TTS already use, so an STT row can be
 * re-prioritised, gated to a tier, or added without editing this file. Before
 * update 18 this function hardcoded "Deepgram, then Groq", which meant catalog
 * changes to STT silently did nothing.
 *
 * Keeps its original return shape so the route is unchanged: `live: false` is
 * still the signal that nothing transcribed, and the route still refunds.
 */
export async function transcribeAudio(opts: {
  audio: Blob;
  filename?: string;
  /** Caller's own keys, so BYOK reaches STT like every other capability. */
  userKeys?: ProviderKeys;
  plan?: "free" | "pro";
  /** Explicit catalog model id. Ignored unless it is a registered STT row. */
  preferModelId?: string;
}): Promise<{ text: string; provider: string; model: string; live: boolean }> {
  const filename =
    opts.filename || `recording.${opts.audio?.type === "audio/webm" ? "webm" : "m4a"}`;

  const chain = modelChain({
    capability: "stt",
    plan: opts.plan ?? "free",
    prompt: "",
    preferModelId: opts.preferModelId,
    availableProviders: availableProvidersFor("stt", opts.userKeys),
    max: 4,
  });

  for (const model of chain) {
    const key = sttKeyFor(model.provider, opts.userKeys);
    let text: string | null = null;
    try {
      if (model.provider === "groq") {
        text = await groqWhisper(opts.audio, filename, model.id, key);
      } else if (model.provider === "deepgram") {
        text = await deepgramNova(opts.audio, filename, model.id, key);
      } else {
        // Registered for STT in the catalog but with no adapter here yet.
        continue;
      }
    } catch (e) {
      console.error("[bw] stt adapter", model.provider, (e as Error)?.message);
      text = null;
    }

    if (text) {
      noteModelSuccess(model.id);
      return { text, provider: model.provider, model: model.label, live: true };
    }
    // Same two-strike cooldown the other capabilities use, so a dead STT vendor
    // stops leading the chain for the next caller.
    noteModelFailure(model.id);
  }

  // Honest fallback — never pretend we heard something we didn't. `live: false` is
  // the signal the route uses to refuse the call (503, and the credit is refunded),
  // so this text must stay an explanation and must never be handed out as a result.
  return {
    text:
      "Voice-to-text isn't connected right now, so we cannot transcribe this. Your recording is safe and can be sent again as soon as transcription is available — ask the operator of this deployment to enable a transcription provider.",
    provider: "buildwe",
    model: "BUILDWE Voice (preview)",
    live: false,
  };
}
