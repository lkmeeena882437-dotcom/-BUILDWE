import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { generateImage } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration, uid } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:image:${session.userId}:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "Describe the image first." }, { status: 400 });
    }
    const aspect = String(body?.aspect || "1:1");

    const limit = checkLimit(session.userId, session.plan, "image");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Limit reached.", code: "LIMIT" },
        { status: 402 }
      );
    }

    const result = await generateImage({
      prompt,
      aspect,
      plan: session.plan,
    });

    try {
      recordUsage(session.userId, "image");
    } catch {
      /* */
    }

    let id = uid("gen");
    try {
      const gen = addGeneration({
        userId: session.userId,
        type: "image",
        prompt,
        outputUrl: result.url,
        meta: { aspect, model: result.model },
      });
      id = gen.id;
    } catch (e) {
      console.error("[bw] image persist", e);
    }

    const res = NextResponse.json({
      id,
      url: result.url,
      model: result.model,
      provider: "buildwe",
      aspect,
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] image route", e);
    return NextResponse.json(
      { error: "Couldn’t create that image. Try again." },
      { status: 500 }
    );
  }
}
