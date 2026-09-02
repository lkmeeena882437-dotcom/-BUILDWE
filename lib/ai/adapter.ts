/**
 * BUILDWE capability adapter — the only door feature APIs should use.
 *
 * Flow: feature route → this layer → catalog chain → vendor adapter → branded result.
 *
 * Rules:
 *  - The browser never calls a vendor. Keys stay on the server.
 *  - Adding a model is a catalog row (and a vendor adapter only if the vendor is new).
 *    Chat, code, image, audio and the agent do not get rewritten.
 *  - A failed model walks the configured fallback chain. The user sees a BUILDWE brand,
 *    never a raw vendor id or endpoint.
 */

import { AI_KEYS } from "@/lib/config";
import {
  modelChain,
  pickModel,
  publicModelLabel,
  type Capability,
  type CatalogModel,
} from "@/lib/ai/models-catalog";
import {
  availableProviders,
  type ProviderKeys,
} from "@/lib/ai/provider-registry";
import { availableImageProviders } from "@/lib/ai/image-providers";
import {
  streamChatOrCode,
  generateImage,
  generateAudioPlan,
  availableAudioProviders,
} from "@/lib/ai/providers";

export type FeatureCapability = Exclude<Capability, "router">;

function keyOk(v?: string): boolean {
  return Boolean(v && !v.startsWith("your_") && !v.includes("REPLACE"));
}

/**
 * Which vendors can actually be called for this capability right now.
 * Image and audio have their own keyless defaults; chat/code use the LLM registry.
 */
export function availableFor(
  capability: FeatureCapability,
  userKeys?: ProviderKeys
): string[] {
  if (capability === "image") return availableImageProviders();
  if (capability === "audio") return availableAudioProviders(userKeys);
  if (capability === "stt") {
    const out: string[] = [];
    if (keyOk(AI_KEYS.groq) || userKeys?.groq) out.push("groq");
    if (keyOk(AI_KEYS.deepgram) || userKeys?.deepgram) out.push("deepgram");
    return out;
  }
  if (capability === "vision") {
    const out: string[] = [];
    if (keyOk(AI_KEYS.openai) || userKeys?.openai) out.push("openai");
    if (keyOk(AI_KEYS.anthropic) || userKeys?.anthropic) out.push("anthropic");
    if (keyOk(AI_KEYS.groq) || userKeys?.groq) out.push("groq");
    return out;
  }
  return availableProviders(userKeys);
}

/** Ordered fallback chain for a capability. First usable model leads. */
export function chainFor(opts: {
  capability: FeatureCapability;
  plan: "free" | "pro";
  prompt: string;
  userKeys?: ProviderKeys;
  preferModelId?: string;
  max?: number;
}): CatalogModel[] {
  return modelChain({
    capability: opts.capability,
    plan: opts.plan,
    prompt: opts.prompt,
    preferModelId: opts.preferModelId,
    availableProviders: availableFor(opts.capability, opts.userKeys),
    max: opts.max ?? 5,
  });
}

/** Best single pick for a capability on this deployment. */
export function pickFor(opts: {
  capability: FeatureCapability;
  plan: "free" | "pro";
  prompt: string;
  userKeys?: ProviderKeys;
  preferModelId?: string;
}): CatalogModel {
  return pickModel({
    capability: opts.capability,
    plan: opts.plan,
    prompt: opts.prompt,
    preferModelId: opts.preferModelId,
    availableProviders: availableFor(opts.capability, opts.userKeys),
  });
}

/** Public brand for whatever answered — never a vendor product name. */
export const brandFor = publicModelLabel;

/**
 * Feature runners. Routes import these so a future model lands in the catalog
 * without a second edit in chat/code/image/audio.
 */
export const runChat = streamChatOrCode;
export const runImage = generateImage;
export const runAudio = generateAudioPlan;
