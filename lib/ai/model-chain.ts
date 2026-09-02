/**
 * UPDATE 12 — chat/code model chain assembly.
 *
 * `models-catalog.ts` decides which models are *good* for a prompt.
 * This file decides which of them are worth *calling on this request*, and in
 * what order. It was previously inlined in `streamChatOrCode`, where three
 * problems were invisible:
 *
 *   1. A hardcoded legacy Groq list was appended unconditionally, so ids that
 *      are not in the catalog (`gemma2-9b-it`) were attempted ahead of real
 *      catalog models on other vendors — and if one answered, it answered as an
 *      off-catalog id with a guessed brand.
 *   2. The env override and the scored pick were pushed onto the chain without
 *      checking their vendor is reachable, so a deployment with no OpenAI key
 *      still spent its first two attempts on `gpt-4o`.
 *   3. A model that just failed was retried at position 1 on the very next
 *      request, so one dead vendor taxed every user with the same timeout.
 *
 * The chain is pure except for the failure memory, which is deliberately a
 * process-local map: it is an optimisation, never correctness. If it is empty
 * (fresh process, new instance) behaviour is exactly the un-cooled chain.
 */

import {
  MODEL_CATALOG,
  modelChain,
  pickModel,
  routeModelFor,
  type CatalogModel,
} from "@/lib/ai/models-catalog";

/** How long a model stays benched after it fails to answer. */
export const COOLDOWN_MS = 60_000;

/** Consecutive failures before a model is benched at all — one blip is not an outage. */
export const COOLDOWN_AFTER = 2;

type Strike = { count: number; until: number };
const strikes = new Map<string, Strike>();

/** Record that a model did not answer. Two strikes inside the window bench it. */
export function noteModelFailure(modelId: string, now = Date.now()): void {
  const prev = strikes.get(modelId);
  const count = prev && prev.until > now ? prev.count + 1 : 1;
  strikes.set(modelId, {
    count,
    until: now + (count >= COOLDOWN_AFTER ? COOLDOWN_MS : COOLDOWN_MS / 2),
  });
}

/** Record that a model answered — clears its strikes immediately. */
export function noteModelSuccess(modelId: string): void {
  strikes.delete(modelId);
}

/** True while a model is benched. Expired entries are swept on read. */
export function isCoolingDown(modelId: string, now = Date.now()): boolean {
  const s = strikes.get(modelId);
  if (!s) return false;
  if (s.until <= now) {
    strikes.delete(modelId);
    return false;
  }
  return s.count >= COOLDOWN_AFTER;
}

/** Test/ops hook — forget all failure history. */
export function resetModelHealth(): void {
  strikes.clear();
}

function reachable(
  model: CatalogModel | null | undefined,
  availableProviders: readonly string[],
  plan: "free" | "pro"
): boolean {
  if (!model) return false;
  if (!availableProviders.includes(model.provider)) return false;
  return plan === "pro"
    ? model.tiers.includes("pro") || model.tiers.includes("free")
    : model.tiers.includes("free");
}

export type ChatChainInput = {
  capability: "chat" | "code";
  plan: "free" | "pro";
  prompt: string;
  /** Vendors with a usable key right now (platform or BYOK). */
  availableProviders: readonly string[];
  /** Operator's AI_CHAT_MODEL / AI_CODE_MODEL override, if any. */
  envModel?: string;
  /** Chars of attached context, for the long-document routing policy. */
  contextSize?: number;
  /** Force exactly one model (comparison lanes) — no fallbacks. */
  forceModel?: string;
  /** Skip the first N candidates ("use another model"). */
  preferOffset?: number;
  /** Last-resort ids kept for backwards compatibility. Only used if nothing else is reachable. */
  legacy?: readonly string[];
  max?: number;
  now?: number;
};

export type ChatChain = {
  /** Ordered model ids to attempt. */
  models: string[];
  /** Ids dropped only because they are benched — surfaced for /api/health. */
  cooling: string[];
};

/**
 * Build the ordered list of model ids to try for one chat/code request.
 *
 * Order: operator override → routing policy flagship → scored pick → catalog
 * fallback chain (cross-vendor first). Every entry is a catalog model whose
 * vendor is reachable and whose tier the plan allows. Benched models drop to
 * the back rather than out, so a cooled-down chain is never shorter than an
 * empty one.
 */
export function buildChatChain(input: ChatChainInput): ChatChain {
  const {
    capability,
    plan,
    prompt,
    availableProviders,
    envModel,
    contextSize,
    forceModel,
    preferOffset,
    legacy = [],
    max = 6,
    now = Date.now(),
  } = input;

  // A forced model is an explicit instruction (comparison lanes). Honour it
  // verbatim — benching or fallback here would silently answer as the wrong
  // model, which is the one thing a comparison must never do.
  if (forceModel) return { models: [forceModel], cooling: [] };

  const rowFor = (id?: string) =>
    id ? MODEL_CATALOG.find((m) => m.id === id && m.capability === capability) ?? null : null;

  const ordered: string[] = [];
  const push = (id?: string | null) => {
    if (id && !ordered.includes(id)) ordered.push(id);
  };

  // 1. Operator override — only when this deployment can actually reach it.
  const envRow = rowFor(envModel);
  if (reachable(envRow, availableProviders, plan)) push(envRow!.id);

  // 2. Routing policy flagship (long document / code / normal ask).
  const routed = rowFor(
    routeModelFor({ capability, plan, prompt, contextSize })
  );
  if (reachable(routed, availableProviders, plan)) push(routed!.id);

  // 3. Scored pick, then the catalog's cross-vendor fallback chain.
  if (availableProviders.length) {
    push(
      pickModel({ capability, plan, prompt, availableProviders }).id
    );
    for (const m of modelChain({
      capability,
      plan,
      prompt,
      availableProviders,
      max,
    })) {
      push(m.id);
    }
  }

  // 4. Legacy ids: last resort only, and only if the catalog gave us nothing.
  //    Keeping them ahead of catalog models is what made an unknown id answer.
  if (!ordered.length) for (const id of legacy) push(id);

  const cooling = ordered.filter((id) => isCoolingDown(id, now));
  const hot = ordered.filter((id) => !isCoolingDown(id, now));
  // Benched models go to the back, never away — an all-cold chain must still try.
  let models = [...hot, ...cooling];

  if (preferOffset && models.length > 1) {
    models = models.slice(Math.min(preferOffset, models.length - 1));
  }

  return { models: models.slice(0, max), cooling };
}
