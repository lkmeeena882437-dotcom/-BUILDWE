/**
 * BUILDWE image generation — real multi-provider, with honest fallback.
 *
 * WHY THIS EXISTS
 * ---------------
 * The model catalog advertised four image providers (Pollinations, fal,
 * HuggingFace) but `generateImage()` only ever built a Pollinations URL. The
 * fal and HuggingFace rows were decoration: picking "FLUX Pro" produced the
 * exact same Pollinations image as "FLUX". That is the same class of bug the
 * chat catalog had — a menu with one dish behind it.
 *
 * This module gives image generation the same treatment the chat path got:
 * one adapter per vendor, availability-aware selection, and a fallback chain
 * that crosses vendors. Pollinations stays the free default because it needs
 * no key and it is what free users have always had — nothing regresses.
 *
 * OUTPUT CONTRACT
 * ---------------
 * Every adapter returns a URL the browser can render. Pollinations returns a
 * hot-link URL, fal returns a hosted URL, HuggingFace returns raw bytes which
 * we encode as a data URL. Callers do not care which.
 */

import { AI_KEYS } from "@/lib/config";
import { fetchWithTimeout, TIMEOUTS, withRetry } from "@/lib/ai/gateway";
import { MODEL_CATALOG } from "@/lib/ai/models-catalog";

export type ImageResult = {
  url: string;
  /** which vendor actually served it — internal, never shown raw to users */
  provider: string;
  modelId: string;
  /** true when a requested model was unavailable and we used another */
  fellBack: boolean;
};

/* ── Aspect → pixel size ──────────────────────────────────── */

export function aspectToSize(aspect: string): { w: number; h: number } {
  switch (aspect) {
    case "16:9":
    case "yt":
      return { w: 1280, h: 720 };
    case "9:16":
      return { w: 720, h: 1280 };
    case "4:3":
      return { w: 1024, h: 768 };
    case "3:4":
      return { w: 768, h: 1024 };
    default:
      return { w: 1024, h: 1024 };
  }
}

/* ── Availability ─────────────────────────────────────────── */

function keyOk(v?: string): boolean {
  return Boolean(v && !v.startsWith("your_") && !v.includes("REPLACE"));
}

/** Image providers that can actually be called right now. */
export function availableImageProviders(): string[] {
  const out = ["pollinations"]; // always available — no key required
  if (keyOk(AI_KEYS.fal)) out.push("fal");
  if (keyOk(AI_KEYS.hf)) out.push("huggingface");
  return out;
}

/* ── Adapters ─────────────────────────────────────────────── */

function pollinationsUrl(prompt: string, aspect: string, modelId: string): string {
  const { w, h } = aspectToSize(aspect);
  const seed = Math.floor(Math.random() * 1_000_000);
  const clean = prompt.replace(/\s+/g, " ").trim().slice(0, 850);
  const q = encodeURIComponent(clean);
  // Pollinations only knows a couple of model names; anything else maps to flux.
  const model = modelId === "turbo" ? "turbo" : "flux";
  return `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=true&model=${model}`;
}

/** fal.ai — hosted FLUX variants. Returns a hosted image URL. */
async function falImage(
  prompt: string,
  aspect: string,
  modelId: string
): Promise<string | null> {
  const key = AI_KEYS.fal;
  if (!keyOk(key)) return null;

  const { w, h } = aspectToSize(aspect);
  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          `https://fal.run/${modelId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Key ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: prompt.slice(0, 1500),
              image_size: { width: w, height: h },
              num_images: 1,
              enable_safety_checker: true,
            }),
          },
          TIMEOUTS.complete,
          "fal"
        );
        if (!res.ok) throw new Error(`fal ${res.status}`);
        const data = await res.json();
        const url =
          data?.images?.[0]?.url ||
          data?.image?.url ||
          (typeof data?.images?.[0] === "string" ? data.images[0] : null);
        if (!url) throw new Error("fal returned no image");
        return String(url);
      },
      { attempts: 2, label: "fal" }
    );
  } catch (e) {
    console.error("[bw] fal image", (e as Error)?.message);
    return null;
  }
}

/** HuggingFace inference — returns raw bytes, encoded as a data URL. */
async function hfImage(prompt: string, modelId: string): Promise<string | null> {
  const key = AI_KEYS.hf;
  if (!keyOk(key)) return null;

  try {
    const res = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${modelId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: prompt.slice(0, 1000) }),
      },
      TIMEOUTS.complete,
      "huggingface"
    );
    if (!res.ok) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    // Guard against the API returning a JSON error body instead of an image
    if (buf.length < 1024 || buf.subarray(0, 1).toString() === "{") return null;
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.error("[bw] hf image", (e as Error)?.message);
    return null;
  }
}

/* ── Public entry point ───────────────────────────────────── */

/**
 * Generate an image, walking a real cross-vendor chain.
 *
 * Selection honours the requested model when its provider is configured,
 * otherwise it falls through to the next reachable option and finally to
 * Pollinations, which always works. `fellBack` tells the caller whether the
 * user got what they asked for.
 */
export async function generateImageMulti(opts: {
  prompt: string;
  aspect: string;
  plan: "free" | "pro";
  modelId?: string;
}): Promise<ImageResult> {
  const available = availableImageProviders();
  const requested = opts.modelId || "flux";

  // Build the attempt order: requested model first, then other reachable
  // image models ranked by quality, then the keyless default.
  const catalogHit = MODEL_CATALOG.find(
    (m) => m.capability === "image" && m.id === requested
  );
  const allowed = opts.plan === "pro" ? ["pro", "free"] : ["free"];

  const others = MODEL_CATALOG.filter(
    (m) =>
      m.capability === "image" &&
      m.id !== requested &&
      m.tiers.some((t) => allowed.includes(t)) &&
      available.includes(m.provider)
  ).sort((a, b) => b.quality - a.quality);

  const chain = [
    ...(catalogHit && available.includes(catalogHit.provider) ? [catalogHit] : []),
    ...others,
  ];

  let fellBack = false;
  for (const model of chain) {
    if (model.provider === "pollinations") {
      return {
        url: pollinationsUrl(opts.prompt, opts.aspect, model.id),
        provider: "pollinations",
        modelId: model.id,
        fellBack,
      };
    }
    if (model.provider === "fal") {
      const url = await falImage(opts.prompt, opts.aspect, model.id);
      if (url) return { url, provider: "fal", modelId: model.id, fellBack };
      fellBack = true;
      continue;
    }
    if (model.provider === "huggingface") {
      const url = await hfImage(opts.prompt, model.id);
      if (url) return { url, provider: "huggingface", modelId: model.id, fellBack };
      fellBack = true;
      continue;
    }
  }

  // Last resort: Pollinations always works, no key needed.
  return {
    url: pollinationsUrl(opts.prompt, opts.aspect, "flux"),
    provider: "pollinations",
    modelId: "flux",
    fellBack: chain.length > 0,
  };
}
