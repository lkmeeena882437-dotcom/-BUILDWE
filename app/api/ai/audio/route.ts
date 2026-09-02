import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { runAudio as generateAudioPlan } from "@/lib/ai/adapter";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration, uid } from "@/lib/db/store";
import { INPUT_LIMITS } from "@/lib/ai/gateway";
import { persistDataUrl, mediaStorageEnabled } from "@/lib/storage/media";
import { creditGate, creditReceipt, getBalance, refundArtifact } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("audio", session.userId, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const text = String(body?.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Paste a script first." }, { status: 400 });
    }
    // Cost guard (audit V3) — TTS is billed per character.
    if (text.length > INPUT_LIMITS.audioChars) {
      return NextResponse.json(
        {
          error: "That script is too long — keep it under 5,000 characters.",
          code: "SCRIPT_TOO_LONG",
          hint: "Script ko chhote hisso me todo aur alag-alag generate karo.",
        },
        { status: 413 }
      );
    }

    const limit = checkLimit(session.userId, session.plan, "audio");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Limit reached.", code: "LIMIT" },
        { status: 402 }
      );
    }

    const voice = String(body?.voice || "nova");
    const speed = Number(body?.speed) || 1;

    const genId = uid("gen");
    const gate = creditGate(session.userId, "audio", genId);
    if (!gate.ok) return gate.res;
    let plan: Awaited<ReturnType<typeof generateAudioPlan>>;
    try {
      plan = await generateAudioPlan({
        text,
        voice,
        speed,
        plan: session.plan,
      });
    } catch (e) {
      refundArtifact(session.userId, "audio", gate.hold.cost, genId);
      throw e;
    }
    // Two different things can come back from that call. `browser-tts` means
    // the browser's own speech engine served it - no server call, no cost, so
    // the hold is returned. A real mp3 that came back empty is a failed run,
    // which is also not billable, and the client is told so.
    //
    // `verified` (update 14) is the billable condition: it is set only when the
    // bytes decoded to a genuine audio container. A truthy `audioUrl` was not
    // enough — the keyless vendor is a chat model asked for speech, and a
    // scrap of base64 lifted out of an apology satisfied the old check.
    const generated =
      plan.type === "mp3" && Boolean(plan.audioUrl) && plan.verified === true;

    if (!generated) {
      // Nothing was synthesised, so nothing is owed. Refund first, then decide
      // what to tell the client.
      refundArtifact(session.userId, "audio", gate.hold.cost, genId);

      if (plan.type === "mp3") {
        // A vendor answered but the bytes were not audio — a failed run.
        return NextResponse.json(
          {
            error: "The voice provider didn’t return usable audio — your credit was given back.",
            code: "PROVIDER_EMPTY",
            hint: "Voice models abhi busy hain — thodi der baad dobara try karo.",
          },
          { status: 502 }
        );
      }

      // No vendor was reachable. The browser's own speech engine can still read
      // the script, which is genuinely useful, so this is a 200 — but it is the
      // user's device talking, not a BUILDWE generation. It is therefore not
      // billed (`charged: 0`), not counted as usage, and not written to history
      // as a creation, because there is no artifact to replay later.
      const res = NextResponse.json({
        ...plan,
        provider: "buildwe",
        verified: false,
        credits: { charged: 0, balance: getBalance(session.userId) },
      });
      attachGuestCookie(res, session.userId);
      return res;
    }

    try {
      recordUsage(session.userId, "audio");
    } catch {
      /* */
    }

    let id = genId;

    // Persist the audio itself, not just a row saying it existed. Previously
    // the MP3 lived only in a base64 data URL held in memory, so history
    // showed the entry but the sound was gone after a refresh.
    let storedUrl: string | undefined;
    const rawAudio =
      "audioUrl" in plan && typeof plan.audioUrl === "string" ? plan.audioUrl : undefined;
    if (rawAudio?.startsWith("data:") && mediaStorageEnabled()) {
      try {
        // Extension follows the container the vendor actually returned —
        // storing an Ogg clip as ".mp3" makes a file that some players refuse.
        // `persistDataUrl` already sets Content-Type from the data URL itself.
        const mime = "mime" in plan && typeof plan.mime === "string" ? plan.mime : "audio/mpeg";
        const ext =
          mime === "audio/wav" ? "wav" : mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "m4a" : "mp3";
        const hosted = await persistDataUrl(
          rawAudio,
          `audio/${session.userId}/${id}.${ext}`
        );
        if (hosted !== rawAudio) storedUrl = hosted;
      } catch (e) {
        // Storage is best-effort — never fail a generation over it.
        console.error("[bw] audio store", e);
      }
    }

    try {
      const gen = addGeneration({
        userId: session.userId,
        type: "audio",
        prompt: text.slice(0, 500),
        outputText: text,
        ...(storedUrl ? { outputUrl: storedUrl } : {}),
        meta: { voice, speed, model: plan.model },
      });
      id = gen.id;
    } catch (e) {
      console.error("[bw] audio persist", e);
    }

    const res = NextResponse.json({
      id,
      ...plan,
      // Prefer the hosted URL so the client caches a real file, not base64.
      ...(storedUrl ? { audioUrl: storedUrl, stored: true } : {}),
      provider: "buildwe",
      credits: creditReceipt(session.userId, gate.hold),
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] audio route", e);
    return NextResponse.json(
      { error: "Couldn’t generate voice. Try again." },
      { status: 500 }
    );
  }
}
