import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { generateAudioPlan } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration, uid } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:audio:${session.userId}:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const text = String(body?.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Paste a script first." }, { status: 400 });
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

    const plan = await generateAudioPlan({
      text,
      voice,
      speed,
      plan: session.plan,
    });

    try {
      recordUsage(session.userId, "audio");
    } catch {
      /* */
    }

    let id = uid("gen");
    try {
      const gen = addGeneration({
        userId: session.userId,
        type: "audio",
        prompt: text.slice(0, 500),
        outputText: text,
        meta: { voice, speed, model: plan.model },
      });
      id = gen.id;
    } catch (e) {
      console.error("[bw] audio persist", e);
    }

    const res = NextResponse.json({
      id,
      ...plan,
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
