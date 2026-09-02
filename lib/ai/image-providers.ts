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
import { availableProvidersFor } from "@/lib/ai/provider-config";

export type ImageResult = {
  url: string;
  /** which vendor actually served it — internal, never shown raw to users */
  provider: string;
  modelId: string;
  /** true when a requested model was unavailable and we used another */
  fellBack: boolean;
  /**
   * True when we have actual evidence the picture exists: bytes returned by the
   * vendor, or a URL we fetched and confirmed is an image.
   *
   * This is not decoration. Pollinations is a *constructed* hot-link — building
   * the string performs no network call — so `url` was always truthy and the
   * route's `if (!result.url)` refund check could never fire for it. A
   * Pollinations outage therefore charged the user a credit and handed the
   * browser a URL that renders as a broken image, with no refund and no error.
   */
  verified: boolean;
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
  return availableProvidersFor("image");
}

/* ── Adapters ─────────────────────────────────────────────── */

/**
 * Base for the keyless image provider. Overridable with AI_BASE_URL_POLLINATIONS
 * exactly like the LLM vendors in `provider-registry.ts` — same convention, so a
 * proxy (or an offline test fixture) can stand in without a code change.
 */
function pollinationsBase(): string {
  const override = process.env.AI_BASE_URL_POLLINATIONS;
  return override && /^https?:\/\//.test(override)
    ? override.replace(/\/$/, "")
    : "https://image.pollinations.ai";
}

function pollinationsUrl(prompt: string, aspect: string, modelId: string): string {
  const { w, h } = aspectToSize(aspect);
  const seed = Math.floor(Math.random() * 1_000_000);
  const clean = prompt.replace(/\s+/g, " ").trim().slice(0, 850);
  const q = encodeURIComponent(clean);
  // Pollinations only knows a couple of model names; anything else maps to flux.
  const model = modelId === "turbo" ? "turbo" : "flux";
  return `${pollinationsBase()}/prompt/${q}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=true&model=${model}`;
}

/**
 * Confirm a hot-linked URL actually serves an image before we charge for it.
 *
 * Only used for providers whose "result" is a URL we constructed rather than
 * bytes a vendor handed back. A HEAD is enough and costs almost nothing; some
 * CDNs refuse HEAD, so a 405/501 is treated as "can't tell" and we fall back to
 * a ranged GET rather than condemning a working image.
 */
export async function verifyImageUrl(url: string): Promise<boolean> {
  const looksImage = (res: Response) =>
    res.ok && (res.headers.get("content-type") || "").toLowerCase().startsWith("image/");
  try {
    const head = await fetchWithTimeout(
      url,
      { method: "HEAD", cache: "no-store" },
      TIMEOUTS.imageVerify,
      "image-verify"
    );
    if (looksImage(head)) return true;
    // HEAD unsupported → ask for a single byte instead of the whole picture.
    if (head.status !== 405 && head.status !== 501 && head.status !== 403) return false;
  } catch {
    /* fall through to the ranged GET */
  }
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" },
      TIMEOUTS.imageVerify,
      "image-verify"
    );
    return looksImage(res);
  } catch {
    return false;
  }
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

/** OpenAI DALL·E 3 — returns a hosted URL. body differs from the chat API. */
/**
 * Gemini native image generation ("Nano Banana" in Google's consumer naming).
 *
 * Same generateContent endpoint the chat wire uses, with an IMAGE response
 * modality; the picture comes back as inline base64, which we hand on as a data
 * URL so the existing verify/persist path treats it like any other result.
 *
 * The nickname lives in the UI, the model ID lives here — Nano Banana Pro is
 * gemini-3-pro-image, Nano Banana 2 is gemini-3.1-flash-image, Lite is
 * gemini-3.1-flash-lite-image.
 */
async function googleImage(
  prompt: string,
  modelId: string
): Promise<string | null> {
  const key = AI_KEYS.google;
  if (!keyOk(key)) return null;

  const base = (
    process.env.AI_BASE_URL_GOOGLE_IMAGE ||
    "https://generativelanguage.googleapis.com/v1beta/models"
  ).replace(/\/$/, "");

  try {
    const res = await fetchWithTimeout(
      `${base}/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key as string,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt.slice(0, 2000) }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      },
      TIMEOUTS.complete,
      "image"
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    for (const part of data?.candidates?.[0]?.content?.parts || []) {
      const b64 = part?.inlineData?.data;
      if (b64) {
        const mime = part.inlineData?.mimeType || "image/png";
        return `data:${mime};base64,${b64}`;
      }
    }
    return null;
  } catch (e) {
    console.error("[bw] google image", (e as Error)?.message);
    return null;
  }
}

async function openaiImage(
  prompt: string,
  aspect: string,
  modelId: string
): Promise<string | null> {
  const key = AI_KEYS.openai;
  if (!keyOk(key)) return null;

  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          "https://api.openai.com/v1/images/generations",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: modelId === "dall-e-3" ? "dall-e-3" : "dall-e-3",
              prompt: prompt.slice(0, 1000),
              n: 1,
              size: aspect === "1:1" ? "1024x1024" : "1024x1792",
              response_format: "url",
            }),
          },
          TIMEOUTS.complete,
          "openai-image"
        );
        if (!res.ok) throw new Error(`openai image ${res.status}`);
        const data = await res.json();
        const url = data?.data?.[0]?.url as string | undefined;
        if (!url) throw new Error("openai returned no image");
        return url;
      },
      { attempts: 2, label: "openai-image" }
    );
  } catch (e) {
    console.error("[bw] openai image", (e as Error)?.message);
    return null;
  }
}

/** Stability SD3 — returns a hosted URL. Base64 is returned when `output_format` is set. */
async function stabilityImage(
  prompt: string,
  aspect: string,
  modelId: string
): Promise<string | null> {
  const key = AI_KEYS.stability;
  if (!keyOk(key)) return null;
  const isSD3 = modelId.includes("stable-diffusion-3");
  const apiUrl = isSD3
    ? "https://api.stability.ai/v2beta/stable-image/generate/sd3"
    : "https://api.stability.ai/v2beta/stable-image/generate/core";
  const width = aspect === "16:9" || aspect === "yt" ? 1280 : 1024;
  const height = aspect === "9:16" ? 1280 : aspect === "16:9" || aspect === "yt" ? 720 : aspect === "4:3" ? 768 : 1024;
  const aspectRatio =
    aspect === "1:1" ? "1:1" : aspect === "16:9" ? "4:3" : aspect === "9:16" ? "3:2" : "4:3";

  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          apiUrl,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: prompt.slice(0, 1000),
              model: isSD3 ? modelId : "stable-diffusion-v1-6",
              // Stability: size is expressed as width/height; aspect ratio only on sd3
              ...(isSD3 ? { aspect_ratio: aspectRatio, mode: "text-to-image" } : { width, height }),
              output_format: "png",
            }),
          },
          TIMEOUTS.complete,
          "stability"
        );
        if (!res.ok) throw new Error(`stability ${res.status}`);
        const data = await res.json();
        // Some responses return a hosted URL; others a base64 image.
        const hosted =
          data?.url ||
          (data?.image && typeof data.image === "string" && data.image.startsWith("http")
            ? data.image
            : null);
        if (hosted) return hosted;
        const b64 = data?.artifacts?.[0]?.base64 || data?.image;
        if (typeof b64 === "string" && b64.length > 1000) {
          return `data:image/png;base64,${b64}`;
        }
        throw new Error("stability returned no image");
      },
      { attempts: 2, label: "stability" }
    );
  } catch (e) {
    console.error("[bw] stability image", (e as Error)?.message);
    return null;
  }
}

/**
 * Midjourney via GoAPI / PiAPI — async job APIs. We submit a task and poll the
 * status endpoint a bounded number of times. The first success that yields a
 * URL wins; otherwise null so the chain falls through to the next provider.
 */
async function goapiMidjourney(
  prompt: string,
  aspect: string
): Promise<string | null> {
  const key = AI_KEYS.goapi;
  if (!keyOk(key)) return null;
  const aspectRating = aspect === "16:9" || aspect === "yt" ? "16:9" : aspect === "9:16" ? "9:16" : "1:1";

  try {
    // Submit the task
    const submit = await fetchWithTimeout(
      "https://api.goapi.ai/api/v1/midjourney/imagine",
      {
        method: "POST",
        headers: {
          "X-API-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${prompt} --ar ${aspectRating} --v 6.1`,
        }),
      },
      TIMEOUTS.complete,
      "goapi"
    );
    if (!submit.ok) return null;
    const submitData = (await submit.json()) as { data?: { task_id?: string; image_url?: string } };
    if (submitData.data?.image_url) return submitData.data.image_url;
    const taskId = submitData.data?.task_id;
    if (!taskId) return null;

    // Poll up to ~12 times with a short backoff.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const status = await fetchWithTimeout(
        `https://api.goapi.ai/api/v1/midjourney/task/${taskId}`,
        {
          method: "GET",
          headers: { "X-API-Key": key },
        },
        TIMEOUTS.complete,
        "goapi"
      );
      if (!status.ok) continue;
      const s = (await status.json()) as { data?: { status?: string; image_url?: string; fail_reason?: string } };
      if (s.data?.image_url) return s.data.image_url;
      if (s.data?.status === "FAILURE" || s.data?.fail_reason) return null;
    }
    return null;
  } catch (e) {
    console.error("[bw] goapi midjourney", (e as Error)?.message);
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
      // Constructed hot-link: nothing has been generated yet. Confirm the
      // picture really renders, otherwise treat it like any other dead vendor
      // and keep walking the chain.
      const url = pollinationsUrl(opts.prompt, opts.aspect, model.id);
      if (await verifyImageUrl(url)) {
        return {
          url,
          provider: "pollinations",
          modelId: model.id,
          fellBack,
          verified: true,
        };
      }
      fellBack = true;
      continue;
    }
    if (model.provider === "fal") {
      const url = await falImage(opts.prompt, opts.aspect, model.id);
      if (url) return { url, provider: "fal", modelId: model.id, fellBack, verified: true };
      fellBack = true;
      continue;
    }
    if (model.provider === "huggingface") {
      const url = await hfImage(opts.prompt, model.id);
      if (url) return { url, provider: "huggingface", modelId: model.id, fellBack, verified: true };
      fellBack = true;
      continue;
    }
    if (model.provider === "google") {
      const url = await googleImage(opts.prompt, model.id);
      if (url) return { url, provider: "google", modelId: model.id, fellBack, verified: true };
      fellBack = true;
      continue;
    }
    if (model.provider === "openai") {
      const url = await openaiImage(opts.prompt, opts.aspect, model.id);
      if (url) return { url, provider: "openai", modelId: model.id, fellBack, verified: true };
      fellBack = true;
      continue;
    }
    if (model.provider === "stability") {
      const url = await stabilityImage(opts.prompt, opts.aspect, model.id);
      if (url) return { url, provider: "stability", modelId: model.id, fellBack, verified: true };
      fellBack = true;
      continue;
    }
    if (model.provider === "goapi") {
      const url = await goapiMidjourney(opts.prompt, opts.aspect);
      if (url) return { url, provider: "goapi", modelId: model.id, fellBack, verified: true };
      fellBack = true;
      continue;
    }
  }

  // Last resort: the keyless default, still only reported as real if it renders.
  // `verified: false` is what lets the route refund instead of charging for a
  // broken image — the honest outcome when every vendor is down.
  const last = pollinationsUrl(opts.prompt, opts.aspect, "flux");
  return {
    url: last,
    provider: "pollinations",
    modelId: "flux",
    fellBack: chain.length > 0,
    verified: await verifyImageUrl(last),
  };
}
