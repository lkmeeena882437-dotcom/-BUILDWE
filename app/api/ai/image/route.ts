import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { runImage as generateImage } from "@/lib/ai/adapter";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { addGeneration, uid } from "@/lib/db/store";
import { INPUT_LIMITS } from "@/lib/ai/gateway";
import { mirrorRemoteImage, mediaStorageEnabled } from "@/lib/storage/media";
import { creditGate, creditReceipt, refundArtifact } from "@/lib/credits";
import { MODEL_CATALOG } from "@/lib/ai/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("image", session.userId, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json(
        { error: "Describe the image first." },
        { status: 400 }
      );
    }
    // Cost guard (audit V3): reject absurd prompts at the edge instead of
    // silently truncating deep inside the provider.
    if (prompt.length > INPUT_LIMITS.promptChars) {
      return NextResponse.json(
        {
          error: "That prompt is too long — keep it under 8,000 characters.",
          code: "PROMPT_TOO_LONG",
          hint: "Prompt chhota karo — sirf zaroori detail rakho, result bhi behtar aayega.",
        },
        { status: 413 }
      );
    }

    const aspect = String(body?.aspect || "1:1");
    const basePrompt = body?.basePrompt
      ? String(body.basePrompt).slice(0, INPUT_LIMITS.promptChars)
      : undefined;
    const modelId = body?.modelId ? String(body.modelId) : "flux";

    // PRO seat gate, driven by the catalogue rather than one hardcoded id.
    // Before this, the check only matched the literal id "pro", so the real
    // premium models (fal FLUX Dev / Pro) were reachable on a free plan.
    const picked = MODEL_CATALOG.find(
      (m) => m.capability === "image" && m.id === modelId
    );
    if (picked && !picked.tiers.includes("free") && session.plan !== "pro") {
      return NextResponse.json(
        {
          error: `${picked.label} is a PRO model. Switch model or upgrade.`,
          code: "PRO_MODEL",
          hint: "Free plan par FLUX aur FLUX Turbo dono available hain.",
        },
        { status: 402 }
      );
    }

    const limit = checkLimit(session.userId, session.plan, "image");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Limit reached.", code: "LIMIT" },
        { status: 402 }
      );
    }

    // Credits are taken before the paid call and given back if the picture does
    // not exist - see lib/credits.ts.
    const genId = uid("gen");
    const gate = creditGate(session.userId, "image", genId);
    if (!gate.ok) return gate.res;
    let result: Awaited<ReturnType<typeof generateImage>>;
    try {
      result = await generateImage({
        prompt,
        aspect,
        plan: session.plan,
        basePrompt,
        modelId,
      });
    } catch (e) {
      refundArtifact(session.userId, "image", gate.hold.cost, genId);
      throw e;
    }
    if (!result.url) {
      refundArtifact(session.userId, "image", gate.hold.cost, genId);
      return NextResponse.json(
        {
          error: "The image provider returned nothing - your credit was given back. Try again.",
          code: "PROVIDER_EMPTY",
        },
        { status: 502 }
      );
    }

    try {
      recordUsage(session.userId, "image");
    } catch {
      /* */
    }

    let id = genId;

    // Mirror the artwork onto our own storage when configured. Previously the
    // history row pointed at a third-party hot-link we don't control, so an
    // upstream change would silently break every past generation.
    let finalUrl = result.url;
    if (mediaStorageEnabled() && /^https?:/.test(result.url)) {
      try {
        finalUrl = await mirrorRemoteImage(
          result.url,
          `images/${session.userId}/${id}.jpg`
        );
      } catch (e) {
        console.error("[bw] image mirror", e);
      }
    }

    try {
      const gen = addGeneration({
        userId: session.userId,
        type: "image",
        prompt: result.promptUsed || prompt,
        outputUrl: finalUrl,
        meta: {
          aspect,
          model: result.model,
          editMode: result.editMode,
          userPrompt: prompt,
          basePrompt: basePrompt || null,
        },
      });
      id = gen.id;
    } catch (e) {
      console.error("[bw] image persist", e);
    }

    const res = NextResponse.json({
      id,
      url: finalUrl,
      model: result.model,
      provider: "buildwe",
      aspect,
      promptUsed: result.promptUsed,
      editMode: result.editMode,
      userPrompt: prompt,
      // True when the requested model was unreachable and another one served
      // the request — the user should know they didn't get what they picked.
      fellBack: result.fellBack || false,
      credits: creditReceipt(session.userId, gate.hold),
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
