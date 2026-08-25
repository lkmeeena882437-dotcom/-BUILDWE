/**
 * BUILDWE — Model catalog & automatic routing
 *
 * FREE:  user does NOT pick models. Router + task classifier pick the best
 *        cost-efficient model that still gives strong output.
 * PRO:   priority queue + stronger defaults; optional manual model pick (UI later).
 * BYOK:  user connects their own key → their provider/models (encrypted server-side).
 *
 * Replace env model IDs in .env.local without code changes.
 * Add more rows here anytime — gateway reads by id.
 */

export type Capability = "chat" | "code" | "image" | "audio" | "router";
export type ModelTier = "free" | "pro" | "byok";
export type ProviderId =
  | "groq"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "google"
  | "fal"
  | "huggingface"
  | "deepgram"
  | "elevenlabs"
  | "cartesia";

export type CatalogModel = {
  id: string;
  label: string;
  provider: ProviderId;
  capability: Capability;
  /** free pool | pro pool | user-key only */
  tiers: ModelTier[];
  /** 1–5 quality score for auto-pick */
  quality: number;
  /** 1–5 lower = cheaper / faster for free tier */
  cost: number;
  latency: "fast" | "medium" | "slow";
  strengths: string[];
  /** env override key hint */
  envKey?: string;
  notes?: string;
};

/**
 * Recommended stack (you can keep ALL of these registered).
 * Auto-router ranks by: capability match → tier allowed → quality/cost blend → health.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  // ── Router (internal) ───────────────────────────────────
  {
    id: "buildwe-router-v1",
    label: "BUILDWE Router",
    provider: "groq",
    capability: "router",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 1,
    latency: "fast",
    strengths: ["intent", "language detect", "complexity"],
    notes: "Tiny/fast model or rules+LLM hybrid to pick mode + model",
  },

  // ── Chat ────────────────────────────────────────────────
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "groq",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["general", "hindi-english", "reasoning"],
    envKey: "AI_CHAT_MODEL",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    provider: "groq",
    capability: "chat",
    tiers: ["free"],
    quality: 3,
    cost: 1,
    latency: "fast",
    strengths: ["simple-qa", "low-latency"],
    notes: "Free auto-pick for short/simple questions",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "openrouter",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["long-context", "multimodal-ready"],
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    capability: "chat",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "fast",
    strengths: ["instruction", "tools"],
  },
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet",
    provider: "anthropic",
    capability: "chat",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["writing", "analysis", "careful-reasoning"],
    envKey: "AI_CHAT_MODEL_PRO",
    notes: "PRO default for hard analysis / long writing",
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    provider: "openrouter",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 1,
    latency: "medium",
    strengths: ["value", "reasoning"],
  },

  // ── Code ────────────────────────────────────────────────
  {
    id: "qwen2.5-coder-32b",
    label: "Qwen2.5 Coder 32B",
    provider: "groq",
    capability: "code",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["code-gen", "multi-file", "fix"],
    envKey: "AI_CODE_MODEL",
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    provider: "openai",
    capability: "code",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "fast",
    strengths: ["refactor", "apis"],
  },
  {
    id: "claude-sonnet-code",
    label: "Claude Sonnet (Code)",
    provider: "anthropic",
    capability: "code",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["architecture", "complex-apps", "reviews"],
    envKey: "AI_CODE_MODEL_PRO",
  },
  {
    id: "deepseek-coder",
    label: "DeepSeek Coder",
    provider: "openrouter",
    capability: "code",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 1,
    latency: "medium",
    strengths: ["budget-code", "algorithms"],
  },

  // ── Image ───────────────────────────────────────────────
  {
    id: "fal-ai/flux/schnell",
    label: "FLUX Schnell",
    provider: "fal",
    capability: "image",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["speed", "general"],
    envKey: "AI_IMAGE_MODEL",
  },
  {
    id: "fal-ai/flux/dev",
    label: "FLUX Dev",
    provider: "fal",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 3,
    latency: "medium",
    strengths: ["detail", "prompt-adherence"],
    envKey: "AI_IMAGE_MODEL_PRO",
  },
  {
    id: "fal-ai/flux-pro",
    label: "FLUX Pro",
    provider: "fal",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 5,
    latency: "slow",
    strengths: ["premium", "marketing"],
  },
  {
    id: "sdxl-turbo",
    label: "SDXL Turbo",
    provider: "huggingface",
    capability: "image",
    tiers: ["free"],
    quality: 3,
    cost: 1,
    latency: "fast",
    strengths: ["budget", "fallback"],
  },

  // ── Audio / TTS ─────────────────────────────────────────
  {
    id: "openai-tts-1",
    label: "OpenAI TTS",
    provider: "openai",
    capability: "audio",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["en", "clarity"],
    envKey: "AI_AUDIO_MODEL",
  },
  {
    id: "elevenlabs-multilingual-v2",
    label: "ElevenLabs Multilingual",
    provider: "elevenlabs",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["hindi", "emotions", "clones"],
    envKey: "AI_AUDIO_MODEL_PRO",
  },
  {
    id: "cartesia-sonic",
    label: "Cartesia Sonic",
    provider: "cartesia",
    capability: "audio",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["realtime", "low-latency"],
  },
  {
    id: "deepgram-aura",
    label: "Deepgram Aura",
    provider: "deepgram",
    capability: "audio",
    tiers: ["free", "pro"],
    quality: 3,
    cost: 2,
    latency: "fast",
    strengths: ["value-tts"],
  },
];

export type TaskComplexity = "simple" | "normal" | "complex";

export function estimateComplexity(prompt: string): TaskComplexity {
  const words = prompt.trim().split(/\s+/).length;
  const hard =
    /architect|production|full.?stack|enterprise|optimize|security|multi-?agent|research|compare|thesis/i.test(
      prompt
    );
  if (hard || words > 120) return "complex";
  if (words < 12) return "simple";
  return "normal";
}

/**
 * FREE auto-select: best quality under cost budget.
 * PRO: prefers higher quality; still auto unless user overrides.
 */
export function pickModel(opts: {
  capability: Exclude<Capability, "router">;
  plan: "free" | "pro";
  prompt: string;
  /** optional PRO manual override id */
  preferModelId?: string;
}): CatalogModel {
  const { capability, plan, prompt, preferModelId } = opts;
  const complexity = estimateComplexity(prompt);
  const allowed: ModelTier[] =
    plan === "pro" ? ["pro", "free"] : ["free"];

  const pool = MODEL_CATALOG.filter(
    (m) =>
      m.capability === capability &&
      m.tiers.some((t) => allowed.includes(t))
  );

  if (preferModelId && plan === "pro") {
    const hit = pool.find((m) => m.id === preferModelId);
    if (hit) return hit;
  }

  if (!pool.length) {
    // should never happen — return a safe chat free model shape
    return MODEL_CATALOG.find((m) => m.id === "llama-3.1-8b-instant")!;
  }

  const scored = pool.map((m) => {
    // Free: minimize cost, keep quality floor
    // Pro: maximize quality, cost secondary
    // Complex tasks boost quality weight
    const qW = plan === "pro" ? 2.2 : complexity === "complex" ? 1.8 : 1.2;
    const cW = plan === "pro" ? 0.4 : complexity === "simple" ? 2.0 : 1.3;
    const lW = m.latency === "fast" ? 0.3 : m.latency === "medium" ? 0.1 : -0.2;
    const score = m.quality * qW - m.cost * cW + lW;
    return { m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].m;
}

/** Human-readable matrix for About / docs */
export function modelsByCapability() {
  const caps: Exclude<Capability, "router">[] = [
    "chat",
    "code",
    "image",
    "audio",
  ];
  return caps.map((c) => ({
    capability: c,
    free: MODEL_CATALOG.filter(
      (m) => m.capability === c && m.tiers.includes("free")
    ),
    pro: MODEL_CATALOG.filter(
      (m) => m.capability === c && m.tiers.includes("pro")
    ),
  }));
}
