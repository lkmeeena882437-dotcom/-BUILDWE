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

import {
  modelChain,
  pickModel,
  publicModelLabel,
  resolveCapability,
  type Capability,
  type CatalogModel,
} from "@/lib/ai/models-catalog";
import { type ProviderKeys } from "@/lib/ai/provider-registry";
import { availableProvidersFor } from "@/lib/ai/provider-config";
import {
  streamChatOrCode,
  generateImage,
  generateAudioPlan,
} from "@/lib/ai/providers";
import { transcribeAudio } from "@/lib/ai/stt";

export type FeatureCapability = Exclude<Capability, "router"> | "agent";

/**
 * Which vendors can actually be called for this capability right now.
 * Read from PROVIDER_CONFIG + live keys — unkeyed and unimplemented stay out.
 */
export function availableFor(
  capability: FeatureCapability,
  userKeys?: ProviderKeys
): string[] {
  return availableProvidersFor(capability, userKeys);
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
  const capability = resolveCapability(opts.capability);
  return modelChain({
    capability,
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
    capability: resolveCapability(opts.capability),
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
/** Speech-to-text. Catalog-routed since update 18, like every other capability. */
export const runStt = transcribeAudio;
