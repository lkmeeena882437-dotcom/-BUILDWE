/**
 * AI Gateway — server-side only.
 *
 * FLOW (automatic on Free; stronger on Pro)
 * 1. detectIntent(prompt) → chat | code | image | audio
 * 2. estimateComplexity(prompt)
 * 3. pickModel({ capability, plan, prompt }) from MODEL_CATALOG
 * 4. Call provider with server key (or user BYOK)
 * 5. Fallback chain if provider fails
 *
 * TEST: demo text when NEXT_PUBLIC_DEMO_MODE=true or keys missing.
 * PROD: implement fetch bodies under each provider case.
 */

import {
  AI_KEYS,
  APP,
  hasProviderKey,
} from "@/lib/config";
import {
  SYSTEM_PROMPTS,
  detectIntent,
  type AIMode,
  type Plan,
} from "@/lib/ai/rules";
import {
  pickModel,
  estimateComplexity,
  type CatalogModel,
} from "@/lib/ai/models-catalog";

export type GenerateInput = {
  mode: Exclude<AIMode, "auto"> | "auto";
  prompt: string;
  plan: Plan;
  userApiKey?: string;
  /** PRO optional override */
  preferModelId?: string;
  skills?: string[];
  signal?: AbortSignal;
};

export type GenerateResult = {
  ok: boolean;
  text?: string;
  url?: string;
  model: string;
  provider: string;
  resolvedMode: Exclude<AIMode, "auto">;
  complexity: string;
  demo: boolean;
  error?: string;
};

export async function generateAI(
  input: GenerateInput
): Promise<GenerateResult> {
  const resolvedMode =
    input.mode === "auto" ? detectIntent(input.prompt) : input.mode;
  const complexity = estimateComplexity(input.prompt);
  const model: CatalogModel = pickModel({
    capability: resolvedMode,
    plan: input.plan,
    prompt: input.prompt,
    preferModelId: input.preferModelId,
  });

  const skillNote =
    input.skills && input.skills.length
      ? `\n\n_Tuned for: ${input.skills.slice(0, 4).join(", ")}_`
      : "";

  const useByok = Boolean(input.userApiKey && input.userApiKey.length > 8);

  // ── Real providers (wire when keys exist) ───────────────
  if (!APP.demoMode && (useByok || hasProviderKey(model.provider as keyof typeof AI_KEYS) || hasProviderKey("groq") || hasProviderKey("openrouter"))) {
    // TODO(prod): switch(model.provider) { case "groq": ... }
    // Use AI_KEYS.*, SYSTEM_PROMPTS[resolvedMode], model.id
    void AI_KEYS;
    void SYSTEM_PROMPTS;
  }

  // ── Demo ────────────────────────────────────────────────
  return {
    ok: true,
    text: demoReply(resolvedMode, input.prompt) + skillNote,
    model: model.id,
    provider: model.provider,
    resolvedMode,
    complexity,
    demo: true,
  };
}

function demoReply(mode: Exclude<AIMode, "auto">, prompt: string): string {
  if (mode === "code") {
    return `Here's a solid start for: “${prompt.slice(0, 80)}”.\n\nOpen the **Files** canvas for the full project scaffold.\n\nSay what to change next.`;
  }
  if (mode === "image") {
    return `Image prompt ready: ${prompt.slice(0, 200)}`;
  }
  if (mode === "audio") {
    return prompt;
  }
  return `Got it.\n\n**Next steps**\n- Clarify the outcome\n- Smallest useful version\n- One action now\n\nTell me constraints and I'll go deeper.`;
}

/** Client streaming simulator until SSE routes are live */
export async function streamDemoText(
  full: string,
  onChunk: (partial: string) => void,
  signal?: AbortSignal
) {
  const parts = full.split(/(\s+)/);
  let acc = "";
  for (const part of parts) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    acc += part;
    onChunk(acc);
    await new Promise((r) => setTimeout(r, part.length > 10 ? 14 : 6));
  }
}
