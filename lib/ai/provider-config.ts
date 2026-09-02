/**
 * Live provider readiness — catalog data plus the keys this process actually has.
 *
 * `models-catalog.ts` stays import-free (tests compile it standalone). This file
 * is the only place that asks "is GROQ_API_KEY set?" so a missing key cannot
 * be reported as available, and an unimplemented vendor (Cartesia, PlayHT)
 * cannot light up just because a key exists.
 */

import { AI_KEYS } from "@/lib/config";
import {
  PROVIDER_CONFIG,
  resolveCapability,
  type ProviderConfig,
} from "@/lib/ai/models-catalog";
import type { ProviderKeys } from "@/lib/ai/provider-registry";

function keyOk(v?: string): boolean {
  return Boolean(v && !v.startsWith("your_") && !v.includes("REPLACE"));
}

/** Env var name → AI_KEYS field. Names never leave this module. */
const ENV_TO_AI: Record<string, keyof typeof AI_KEYS> = {
  GROQ_API_KEY: "groq",
  OPENROUTER_API_KEY: "openrouter",
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  GOOGLE_API_KEY: "google",
  HF_TOKEN: "hf",
  FAL_KEY: "fal",
  MISTRAL_API_KEY: "mistral",
  DEEPSEEK_API_KEY: "deepseek",
  TOGETHER_API_KEY: "together",
  STABILITY_API_KEY: "stability",
  REPLICATE_API_TOKEN: "replicate",
  GOAPI_API_KEY: "goapi",
  PLAYHT_API_KEY: "playht",
  ELEVENLABS_API_KEY: "elevenlabs",
  DEEPGRAM_API_KEY: "deepgram",
};

function platformKey(cfg: ProviderConfig): string | undefined {
  if (!cfg.keyEnv) return undefined;
  const field = ENV_TO_AI[cfg.keyEnv];
  return field ? AI_KEYS[field] : undefined;
}

/**
 * Vendors that can actually be called for this capability right now.
 * Agent aliases code. Unimplemented adapters are omitted even when a key exists.
 */
export function availableProvidersFor(
  capability: string,
  userKeys?: ProviderKeys
): string[] {
  const cap = resolveCapability(capability);
  const out: string[] = [];
  for (const cfg of Object.values(PROVIDER_CONFIG) as ProviderConfig[]) {
    if (!cfg.adapters[cap]) continue;
    if (cfg.keyEnv === null) {
      out.push(cfg.id);
      continue;
    }
    const own = cfg.byokField
      ? userKeys?.[cfg.byokField as keyof ProviderKeys]
      : undefined;
    if (keyOk(typeof own === "string" ? own : undefined) || keyOk(platformKey(cfg))) {
      out.push(cfg.id);
    }
  }
  return out;
}
