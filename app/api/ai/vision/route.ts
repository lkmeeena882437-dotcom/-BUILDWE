import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { visionComplete } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration, findUserById } from "@/lib/db/store";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("vision", session.userId, 20, 60_000);
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
        {
          error: "Image too large — keep it under 5 MB.",
          code: "FILE_TOO_LARGE",
          hint: "Reduce the image size under 5 MB (or screenshot a smaller crop) and attach it again.",
        },
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

    // BYOK — user's own Groq key powers vision too
    const owner = findUserById(session.userId);
    const byok = owner?.byok || {};
    const userKeys = {
      groq: byok.groq ? decryptSecret(byok.groq) : undefined,
    };

    const result = await visionComplete({ prompt, imageDataUrl: image, userKeys });

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
