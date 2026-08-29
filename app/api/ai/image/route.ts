import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { generateImage } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const ip = clientIp(req);
  const rl = rateLimit(`ai:image:${session.userId}:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  const aspect = String(body?.aspect || "1:1");

  const limit = checkLimit(session.userId, session.plan, "image");
  if (!limit.ok) {
    return NextResponse.json({ error: limit.message, code: "LIMIT" }, { status: 402 });
  }

  const result = await generateImage({
    prompt,
    aspect,
    plan: session.plan,
  });

  recordUsage(session.userId, "image");
  const gen = addGeneration({
    userId: session.userId,
    type: "image",
    prompt,
    outputUrl: result.url,
    meta: { aspect, model: result.model, provider: result.provider },
  });

  const res = NextResponse.json({
    id: gen.id,
    url: result.url,
    model: result.model,
    provider: result.provider,
    aspect,
  });
  attachGuestCookie(res, session.userId);
  return res;
}
