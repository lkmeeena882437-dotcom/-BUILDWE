import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { transcribeAudio } from "@/lib/ai/stt";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { uid } from "@/lib/db/store";
import { creditGate, creditReceipt, refundArtifact } from "@/lib/credits";

/** 10 minutes of compressed audio is ~25 MB; beyond that it is an abuse attempt. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/transcribe — Voice: Listen.
 *
 * Accepts an audio blob (multipart form-data: `audio` + optional `filename`)
 * and returns the transcript with which provider/model served it. Uses the
 * same auth + rate-limit + honest-fallback pattern as the rest of the AI
 * routes. The client passes a Blob directly, so it works from a MediaRecorder
 * stream or a file upload.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("stt", session.userId, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment." },
        { status: 429 }
      );
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("audio");
    const filename = String(form?.get("filename") || "") || undefined;

    // No cap at all used to mean a caller could stream an arbitrary-sized
    // recording into a paid transcription API through a free account (A3).
    if (file instanceof Blob && file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `That recording is too large — ${MAX_UPLOAD_BYTES / 1_000_000} MB is the ceiling. Trim it or send a shorter clip.`,
          code: "PAYLOAD_TOO_LARGE",
          maxBytes: MAX_UPLOAD_BYTES,
        },
        { status: 413 }
      );
    }

    const audioLimit = checkLimit(session.userId, session.plan, "audio");
    if (!audioLimit.ok) {
      return NextResponse.json(
        { error: audioLimit.message || "Daily limit reached.", code: "LIMIT" },
        { status: 429 }
      );
    }

    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json(
        { error: "Attach an audio recording first." },
        { status: 400 }
      );
    }

    const sttId = uid("stt");
    const gate = creditGate(session.userId, "transcribe", sttId);
    if (!gate.ok) return gate.res;
    let result: Awaited<ReturnType<typeof transcribeAudio>>;
    try {
      result = await transcribeAudio({ audio: file, filename });
    } catch (e) {
      refundArtifact(session.userId, "transcribe", gate.hold.cost, sttId);
      throw e;
    }
    // Nothing recognised, or no STT provider answered: the user did not get an
    // artifact, so they do not pay for one — and they do not get a success either.
    // This used to return `ok: true` with the explanation inside `text`, which meant
    // any caller that trusts `ok` (a composer inserting a transcript, a tool page
    // rendering its answer) would happily deliver an apology as if it were the
    // result. A refusal with the same words is the honest shape.
    const said = String(result.text || "").trim();
    if (!result.live || !said) {
      refundArtifact(session.userId, "transcribe", gate.hold.cost, sttId);
      return NextResponse.json(
        {
          ok: false,
          error:
            said ||
            "Nothing was recognised in that recording — try again a little closer to the microphone.",
          code: result.live ? "NO_SPEECH_DETECTED" : "TRANSCRIPTION_UNAVAILABLE",
          live: false,
        },
        { status: result.live ? 422 : 503 }
      );
    }
    recordUsage(session.userId, "audio");

    const res = NextResponse.json({
      ok: true,
      text: result.text,
      model: result.model,
      provider: result.provider,
      live: result.live,
      credits: creditReceipt(session.userId, gate.hold),
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] stt route", e);
    return NextResponse.json(
      { error: "Couldn't transcribe that audio. Try again." },
      { status: 500 }
    );
  }
}
