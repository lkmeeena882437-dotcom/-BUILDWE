import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { generateAudioPlan } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const ip = clientIp(req);
  const rl = rateLimit(`ai:audio:${session.userId}:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const text = String(body?.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const limit = checkLimit(session.userId, session.plan, "audio");
  if (!limit.ok) {
    return NextResponse.json({ error: limit.message, code: "LIMIT" }, { status: 402 });
  }

  const voice = String(body?.voice || "nova");
  const speed = Number(body?.speed) || 1;

  const plan = await generateAudioPlan({
    text,
    voice,
    speed,
    plan: session.plan,
  });

  recordUsage(session.userId, "audio");
  const gen = addGeneration({
    userId: session.userId,
    type: "audio",
    prompt: text.slice(0, 500),
    outputText: text,
    meta: { voice, speed, type: plan.type, model: plan.model },
  });

  const res = NextResponse.json({
    id: gen.id,
    ...plan,
  });
  attachGuestCookie(res, session.userId);
  return res;
}
