import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { visionComplete } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:vision:${session.userId}:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const image = String(body?.image || "");
    const prompt = String(body?.prompt || "");

    if (!image || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image)) {
      return NextResponse.json(
        { error: "Attach a PNG, JPG, WEBP or GIF image." },
        { status: 400 }
      );
    }
    if (image.length > MAX_IMAGE_BYTES * 1.4) {
      return NextResponse.json(
        { error: "Image too large — keep it under 5 MB." },
        { status: 413 }
      );
    }

    const limit = checkLimit(session.userId, session.plan, "image");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Vision limit reached.", code: "LIMIT" },
        { status: 402 }
      );
    }

    const result = await visionComplete({ prompt, imageDataUrl: image });

    try {
      recordUsage(session.userId, "image");
      addGeneration({
        userId: session.userId,
        type: "image",
        prompt: prompt || "describe image",
        outputText: result.text,
        meta: { kind: "vision", model: result.model, live: result.live },
      });
    } catch {
      /* best effort */
    }

    const res = NextResponse.json({
      ok: true,
      text: result.text,
      model: result.model,
      live: result.live,
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] vision route", e);
    return NextResponse.json(
      { error: "Couldn't analyze that image. Try again." },
      { status: 500 }
    );
  }
}
