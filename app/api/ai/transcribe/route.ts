import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp } from "@/lib/rate-limit/memory";
import { rateLimitDurable } from "@/lib/rate-limit/durable";
import { transcribeAudio } from "@/lib/ai/stt";

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
    const ip = clientIp(req);
    const rl = await rateLimitDurable(`ai:stt:${session.userId}:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment." },
        { status: 429 }
      );
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("audio");
    const filename = String(form?.get("filename") || "") || undefined;

    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json(
        { error: "Attach an audio recording first." },
        { status: 400 }
      );
    }

    const result = await transcribeAudio({ audio: file, filename });

    const res = NextResponse.json({
      ok: true,
      text: result.text,
      model: result.model,
      provider: result.provider,
      live: result.live,
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
