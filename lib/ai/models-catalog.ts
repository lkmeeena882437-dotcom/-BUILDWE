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

export type Capability =
  | "chat"
  | "code"
  | "image"
  | "audio"
  | "stt"
  | "vision"
  | "router";
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
  | "cartesia"
  | "pollinations"
  | "mistral"
  | "deepseek"
  | "together"
  | "stability"
  | "replicate"
  | "goapi"
  | "playht";

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

/** Wire adapter a vendor uses for a capability. Not an HTTP URL — those stay in the registry. */
export type AdapterName = "llm" | "image" | "audio" | "stt" | "vision";

/** A capability a user can actually ask for. `router` is internal; `agent` aliases `code`. */
export type WorkCapability = Exclude<Capability, "router">;

/**
 * One entry per vendor — not per model. The same Groq row powers chat, code, STT and
 * vision without copying key/adapter config onto every catalog model.
 *
 * `adapters` is what we actually have code for. A catalog model whose provider+capability
 * is missing here is never marked available, even if a key exists (Cartesia / PlayHT TTS).
 * `keyEnv` is the platform env var name (null = keyless). It is never sent to the browser.
 */
export type ProviderConfig = {
  id: ProviderId;
  adapters: Partial<Record<WorkCapability, AdapterName>>;
  keyEnv: string | null;
  byokField?: string;
  /** Lower is preferred as a fallback after the scored pick. */
  priority: number;
};

export const PROVIDER_CONFIG: Record<ProviderId, ProviderConfig> = {
  groq: {
    id: "groq",
    adapters: { chat: "llm", code: "llm", stt: "stt", vision: "vision" },
    keyEnv: "GROQ_API_KEY",
    byokField: "groq",
    priority: 2,
  },
  pollinations: {
    id: "pollinations",
    adapters: { image: "image", audio: "audio" },
    keyEnv: null,
    priority: 4,
  },
  openrouter: {
    id: "openrouter",
    adapters: { chat: "llm", code: "llm" },
    keyEnv: "OPENROUTER_API_KEY",
    byokField: "openrouter",
    priority: 3,
  },
  google: {
    id: "google",
    adapters: { chat: "llm", code: "llm", image: "image" },
    keyEnv: "GOOGLE_API_KEY",
    byokField: "google",
    priority: 1,
  },
  openai: {
    id: "openai",
    adapters: { chat: "llm", code: "llm", image: "image", audio: "audio", vision: "vision" },
    keyEnv: "OPENAI_API_KEY",
    byokField: "openai",
    priority: 5,
  },
  anthropic: {
    id: "anthropic",
    adapters: { chat: "llm", code: "llm", vision: "vision" },
    keyEnv: "ANTHROPIC_API_KEY",
    byokField: "anthropic",
    priority: 6,
  },
  mistral: {
    id: "mistral",
    adapters: { chat: "llm", code: "llm" },
    keyEnv: "MISTRAL_API_KEY",
    byokField: "mistral",
    priority: 7,
  },
  deepseek: {
    id: "deepseek",
    adapters: { chat: "llm", code: "llm" },
    keyEnv: "DEEPSEEK_API_KEY",
    byokField: "deepseek",
    priority: 8,
  },
  together: {
    id: "together",
    adapters: { chat: "llm", code: "llm" },
    keyEnv: "TOGETHER_API_KEY",
    byokField: "together",
    priority: 9,
  },
  huggingface: {
    id: "huggingface",
    adapters: { image: "image" },
    keyEnv: "HF_TOKEN",
    priority: 10,
  },
  fal: {
    id: "fal",
    adapters: { image: "image" },
    keyEnv: "FAL_KEY",
    priority: 11,
  },
  elevenlabs: {
    id: "elevenlabs",
    adapters: { audio: "audio" },
    keyEnv: "ELEVENLABS_API_KEY",
    byokField: "elevenlabs",
    priority: 12,
  },
  stability: {
    id: "stability",
    adapters: { image: "image" },
    keyEnv: "STABILITY_API_KEY",
    byokField: "stability",
    priority: 13,
  },
  goapi: {
    id: "goapi",
    adapters: { image: "image" },
    keyEnv: "GOAPI_API_KEY",
    byokField: "goapi",
    priority: 14,
  },
  deepgram: {
    id: "deepgram",
    adapters: { stt: "stt" },
    keyEnv: "DEEPGRAM_API_KEY",
    byokField: "deepgram",
    priority: 5,
  },
  playht: {
    id: "playht",
    adapters: {},
    keyEnv: "PLAYHT_API_KEY",
    byokField: "playht",
    priority: 90,
  },
  cartesia: {
    id: "cartesia",
    adapters: {},
    keyEnv: "CARTESIA_API_KEY",
    priority: 91,
  },
  replicate: {
    id: "replicate",
    adapters: {},
    keyEnv: "REPLICATE_API_TOKEN",
    byokField: "replicate",
    priority: 92,
  },
};

export const KEYLESS_PROVIDERS: readonly ProviderId[] = (
  Object.values(PROVIDER_CONFIG) as ProviderConfig[]
)
  .filter((p) => p.keyEnv === null)
  .map((p) => p.id);

/** Agent runs on the code catalog — one set of models, not a second copy. */
export function resolveCapability(cap: string): WorkCapability {
  if (cap === "agent") return "code";
  if (cap === "router") return "chat";
  return cap as WorkCapability;
}

export function providerConfig(id: string): ProviderConfig | undefined {
  return PROVIDER_CONFIG[id as ProviderId];
}

export function adapterFor(provider: string, capability: string): AdapterName | null {
  const cap = resolveCapability(capability);
  return PROVIDER_CONFIG[provider as ProviderId]?.adapters[cap] ?? null;
}

export function isKeylessProvider(provider: string): boolean {
  return (KEYLESS_PROVIDERS as readonly string[]).includes(provider);
}

export function isProviderImplemented(provider: string, capability: string): boolean {
  return adapterFor(provider, capability) !== null;
}

export function requiredKeyEnv(provider: string): string | null {
  return PROVIDER_CONFIG[provider as ProviderId]?.keyEnv ?? null;
}

/**
 * Recommended stack (you can keep ALL of these registered).
 * Auto-router ranks by: capability match → tier allowed → quality/cost blend → health.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  // ── Router (internal) ───────────────────────────────────
  {
    id: "openai/gpt-oss-20b",
    label: "BUILDWE Router",
    provider: "groq",
    capability: "router",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 1,
    latency: "fast",
    strengths: ["intent", "language detect", "complexity"],
    notes: "Tiny fast model for intent classification when rules are unsure",
  },

  /* ── Chat ─────────────────────────────────────────────────
   * Model ids here are the EXACT strings each vendor expects, because the
   * provider registry now sends them to that vendor's own endpoint. A wrong
   * id is a 400 from the real provider, not a silent fallback.
   */
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "groq",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["general", "hindi-english", "reasoning"],
    envKey: "AI_CHAT_MODEL",
    notes: "Free default — strong all-rounder on the fastest inference we have",
  },
  {
    id: "qwen/qwen3.6-27b",
    label: "Qwen 3.6 27B",
    provider: "groq",
    capability: "chat",
    tiers: ["free"],
    quality: 2,
    cost: 1,
    latency: "fast",
    strengths: ["short-form", "cheapest"],
    notes: "Third compare seat: fast and cheap, so the lane is not a third copy of the 70B answer",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    provider: "groq",
    capability: "chat",
    tiers: ["free"],
    quality: 3,
    cost: 1,
    latency: "fast",
    strengths: ["simple-qa", "low-latency"],
    notes: "Auto-picked for short/simple questions to keep cost near zero",
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    label: "Kimi K2",
    provider: "groq",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 5,
    cost: 2,
    latency: "fast",
    strengths: ["long-context", "agentic", "multilingual"],
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    label: "DeepSeek R1 Distill 70B",
    provider: "groq",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "medium",
    strengths: ["step-by-step", "maths", "logic"],
    notes: "Reasoning-tuned — auto-picked for complex analytical prompts",
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    provider: "google",
    capability: "chat",
    tiers: ["free", "pro", "byok"],
    quality: 5,
    cost: 2,
    latency: "fast",
    strengths: ["general", "reasoning", "long-context", "multimodal"],
    notes: "Primary chat route when a Google key is configured",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    provider: "google",
    capability: "chat",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["general", "long-context", "summarisation"],
    notes: "First Gemini fallback when 3.7 is unavailable",
  },
  {
    id: "groq/compound",
    label: "Groq Compound",
    provider: "groq",
    capability: "chat",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["tool-use", "web-reasoning", "synthesis"],
    notes: "Agentic/tool-capable Groq route used for web-search synthesis",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra",
    provider: "openrouter",
    capability: "chat",
    tiers: ["free", "pro", "byok"],
    quality: 5,
    cost: 1,
    latency: "slow",
    strengths: ["long-context", "deep-reasoning", "orchestration"],
    notes: "OpenRouter free tier — last chat fallback before offline",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    capability: "chat",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["long-context", "multimodal", "summarisation"],
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
    strengths: ["instruction", "tools", "consistency"],
  },
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet",
    provider: "anthropic",
    capability: "chat",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["writing", "analysis", "careful-reasoning", "nuance"],
    envKey: "AI_CHAT_MODEL_PRO",
    notes: "PRO default for long-form writing and hard analysis",
  },
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek V3",
    provider: "openrouter",
    capability: "chat",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 1,
    latency: "medium",
    strengths: ["value", "reasoning", "multilingual"],
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    capability: "chat",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "fast",
    strengths: ["reasoning", "instruction", "multilingual", "tools"],
    envKey: "AI_CHAT_MODEL_PRO",
    notes: "All-rounder flagship — general questions and multi-step reasoning",
  },
  {
    id: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    provider: "google",
    capability: "chat",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["long-context", "multimodal", "summarisation", "document"],
    notes: "2M-token context — routed for very large documents/PDFs",
  },
  {
    id: "minimaxai/minimax-m2.7",
    label: "MiniMax M2.7",
    provider: "groq",
    capability: "chat",
    tiers: ["pro"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["deep-reasoning", "complex", "analysis"],
    notes: "Highest-capacity open-weight route — reserved for hard problems",
  },
  {
    id: "mistral-large-latest",
    label: "Mistral Large 2",
    provider: "mistral",
    capability: "chat",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "medium",
    strengths: ["logic", "multilingual", "european", "code"],
    notes: "Multilingual open-weight powerhouse — excellent backup/fallback",
  },

  /* ── Code ─────────────────────────────────────────────── */
  {
    id: "qwen/qwen3.6-27b",
    label: "Qwen 3.6 27B (Code)",
    provider: "groq",
    capability: "code",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["code-gen", "multi-file", "fix"],
    envKey: "AI_CODE_MODEL",
    notes: "Free default for coding — purpose-trained on code",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Code)",
    provider: "groq",
    capability: "code",
    tiers: ["free", "pro"],
    quality: 5,
    cost: 2,
    latency: "fast",
    strengths: ["planning", "tool-use", "agentic-code"],
    notes: "Preferred for agent runs — follows multi-step tool plans well",
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash (Code)",
    provider: "google",
    capability: "code",
    tiers: ["free", "pro", "byok"],
    quality: 5,
    cost: 2,
    latency: "fast",
    strengths: ["codegen", "refactor", "tool-use", "long-context"],
    notes: "Primary code/agent route when a Google key is configured",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash (Code)",
    provider: "google",
    capability: "code",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["codegen", "explain-code", "long-context"],
    notes: "Gemini code fallback",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra (Code)",
    provider: "openrouter",
    capability: "code",
    tiers: ["free", "pro", "byok"],
    quality: 5,
    cost: 1,
    latency: "slow",
    strengths: ["long-context", "agent", "orchestration"],
    notes: "OpenRouter free tier — code/agent fallback",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (Code)",
    provider: "groq",
    capability: "code",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["explain-code", "general-code"],
  },
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet (Code)",
    provider: "anthropic",
    capability: "code",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["architecture", "complex-apps", "code-review", "refactor"],
    envKey: "AI_CODE_MODEL_PRO",
    notes: "PRO default — best at whole-project reasoning",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4.1 mini (Code)",
    provider: "openai",
    capability: "code",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "fast",
    strengths: ["refactor", "apis", "tests"],
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct",
    label: "Qwen Coder (OpenRouter)",
    provider: "openrouter",
    capability: "code",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 1,
    latency: "medium",
    strengths: ["budget-code", "algorithms"],
    notes: "Cross-vendor backup so a Groq outage doesn't kill coding",
  },
  {
    id: "claude-3-opus-20240229",
    label: "Claude 3 Opus",
    provider: "anthropic",
    capability: "code",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 5,
    latency: "slow",
    strengths: ["architecture", "system-design", "deep-reasoning", "complex-apps"],
    notes: "Heavy architecture/system-design — slower, deeper reasoning",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o (Code)",
    provider: "openai",
    capability: "code",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "fast",
    strengths: ["multi-language", "python", "data-analysis", "tools"],
    notes: "Code Canvas — multi-language accuracy + data analysis",
  },
  {
    id: "deepseek-coder-v2",
    label: "DeepSeek Coder V2",
    provider: "deepseek",
    capability: "code",
    tiers: ["free", "pro", "byok"],
    quality: 5,
    cost: 1,
    latency: "medium",
    strengths: ["code-gen", "edge-case", "value", "algorithms"],
    notes: "GPT-4-level coding at a fraction of the cost — open weight",
  },
  {
    id: "Qwen/Qwen2.5-Coder-32B-Instruct",
    label: "Qwen 2.5 Coder (Together)",
    provider: "together",
    capability: "code",
    tiers: ["free", "pro", "byok"],
    quality: 4,
    cost: 1,
    latency: "medium",
    strengths: ["code-gen", "edge-case", "logic-puzzles", "budget-code"],
    notes: "Specialised edge-case/algorithm fallback model",
  },

  /* ── Image ────────────────────────────────────────────── */
  /*
   * Gemini image models. "Nano Banana" is Google's consumer nickname; the API
   * ids below are what the endpoint actually accepts. Paid rows are pro/byok —
   * a provider offering a free consumer tier is not the same as free API
   * inference, so they are not marked free.
   */
  {
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    provider: "google",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["photoreal", "text-in-image", "layout", "4k"],
    notes: "Gemini 3 Pro Image — professional assets and complex layouts",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Nano Banana 2",
    provider: "google",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 3,
    latency: "fast",
    strengths: ["general", "editing", "text-in-image", "4k"],
    notes: "Gemini 3.1 Flash Image — default generalist image route",
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite",
    provider: "google",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["low-latency", "high-volume", "drafts"],
    notes: "Gemini 3.1 Flash Lite Image — cheapest/fastest Gemini image lane",
  },
  {
    id: "flux",
    label: "FLUX",
    provider: "pollinations",
    capability: "image",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 1,
    latency: "medium",
    strengths: ["general", "prompt-adherence", "no-key-needed"],
    envKey: "AI_IMAGE_MODEL",
    notes: "Free default — works with zero configuration",
  },
  {
    id: "turbo",
    label: "FLUX Turbo",
    provider: "pollinations",
    capability: "image",
    tiers: ["free", "pro"],
    quality: 3,
    cost: 1,
    latency: "fast",
    strengths: ["speed", "drafts", "iterations"],
  },
  {
    id: "fal-ai/flux/schnell",
    label: "FLUX Schnell",
    provider: "fal",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["speed", "quality-balance"],
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
    id: "fal-ai/flux-pro/v1.1",
    label: "FLUX Pro 1.1",
    provider: "fal",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 5,
    latency: "slow",
    strengths: ["premium", "marketing", "photoreal"],
  },
  {
    id: "stabilityai/stable-diffusion-xl-base-1.0",
    label: "SDXL",
    provider: "huggingface",
    capability: "image",
    tiers: ["free", "byok"],
    quality: 3,
    cost: 1,
    latency: "medium",
    strengths: ["budget", "fallback", "styles"],
  },

  /* ── Image ── premium top-tier (new providers) ───────────── */
  {
    id: "midjourney-v6.1",
    label: "Midjourney v6.1",
    provider: "goapi",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 5,
    latency: "slow",
    strengths: ["cinematic", "artistic", "premium", "style"],
    notes: "Cinematic premium shots (via GoAPI wrapper — no official API)",
  },
  {
    id: "dall-e-3",
    label: "DALL·E 3",
    provider: "openai",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["prompt-adherence", "diagram", "vector-art", "instruction"],
    notes: "Strong prompt adherence — exact diagrams & vector art",
  },
  {
    id: "stabilityai/stable-diffusion-3-large",
    label: "Stable Diffusion 3",
    provider: "stability",
    capability: "image",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "medium",
    strengths: ["customizable", "aspect-ratio", "fast-render", "styles"],
    notes: "Highly customisable + specific aspect ratios",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o Vision",
    provider: "openai",
    capability: "vision",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["image-read", "screenshot-to-code", "ocr", "analysis"],
    notes: "Reads images (UI screenshot → code). Not a generator.",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet Vision",
    provider: "anthropic",
    capability: "vision",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["image-read", "screenshot-to-code", "analysis", "vision"],
    notes: "Reads images. Not a generator.",
  },

  /* ── Audio / TTS ──────────────────────────────────────── */
  {
    id: "openai-audio",
    label: "BUILDWE Voice",
    provider: "pollinations",
    capability: "audio",
    tiers: ["free", "pro"],
    quality: 4,
    cost: 1,
    latency: "fast",
    strengths: ["en", "clarity", "no-key-needed"],
    envKey: "AI_AUDIO_MODEL",
    notes: "Free default — real MP3 with zero configuration",
  },
  {
    id: "tts-1",
    label: "OpenAI TTS",
    provider: "openai",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["en", "clarity", "consistency"],
  },
  {
    id: "tts-1-hd",
    label: "OpenAI TTS HD",
    provider: "openai",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 3,
    latency: "medium",
    strengths: ["studio-quality", "narration"],
  },
  {
    id: "eleven_multilingual_v2",
    label: "ElevenLabs Multilingual v2",
    provider: "elevenlabs",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 4,
    latency: "medium",
    strengths: ["hindi", "emotion", "voice-clones"],
    envKey: "AI_AUDIO_MODEL_PRO",
    notes: "PRO default when an ElevenLabs key is configured",
  },
  {
    id: "sonic-english",
    label: "Cartesia Sonic",
    provider: "cartesia",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 2,
    latency: "fast",
    strengths: ["realtime", "low-latency"],
  },
  {
    id: "aura-asteria-en",
    label: "Deepgram Aura",
    provider: "deepgram",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 3,
    cost: 2,
    latency: "fast",
    strengths: ["value-tts", "conversational"],
  },
  {
    id: "eleven_flash_v2_5",
    label: "ElevenLabs Flash v2.5",
    provider: "elevenlabs",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "fast",
    strengths: ["low-latency", "conversational", "voices"],
    notes: "Fast ElevenLabs voice for interactive chat",
  },
  {
    id: "playht",
    label: "PlayHT",
    provider: "playht",
    capability: "audio",
    tiers: ["pro", "byok"],
    quality: 4,
    cost: 3,
    latency: "medium",
    strengths: ["voice-clones", "expressive", "multilingual"],
    notes: "Voice cloning + expressive TTS alternative to ElevenLabs",
  },

  /* ── Speech-to-Text (STT) — Voice: Listen ─────────────── */
  {
    id: "whisper-large-v3",
    label: "Whisper v3 (Groq)",
    provider: "groq",
    capability: "stt",
    tiers: ["free", "pro", "byok"],
    quality: 5,
    cost: 1,
    latency: "fast",
    strengths: ["transcribe", "real-time", "multilingual"],
    notes: "Ultra-fast STT via Groq LPU — real-time speech recognition",
  },
  {
    id: "nova-2",
    label: "Deepgram Nova-2",
    provider: "deepgram",
    capability: "stt",
    tiers: ["pro", "byok"],
    quality: 5,
    cost: 3,
    latency: "fast",
    strengths: ["streaming", "low-latency", "live-call"],
    notes: "Fastest STT — near-zero latency for live voice chat",
  },
];

export function modelsForCapability(cap: string): CatalogModel[] {
  const resolved = resolveCapability(cap);
  return MODEL_CATALOG.filter((m) => m.capability === resolved);
}

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
/**
 * What KIND of work is this, beyond how hard it is? A 2000-word essay and a
 * multi-region architecture review are both "complex", but they want very
 * different models. Matching the ask against each model's declared strengths
 * is what makes a 28-model catalog better than a 1-model one.
 */
export type TaskKind =
  | "writing"
  | "reasoning"
  | "code"
  | "conversation"
  | "translation"
  | "summarise";

export function detectTaskKind(prompt: string): TaskKind {
  const p = prompt.toLowerCase();
  if (/\b(translate|translation|hindi me|in hindi|convert to (hindi|english))\b/.test(p))
    return "translation";
  if (/\b(summari[sz]e|tldr|shorten|key points|brief)\b/.test(p)) return "summarise";
  if (/\b(essay|blog|article|story|poem|script|copy|caption|draft|write|rewrite|letter|email)\b/.test(p))
    return "writing";
  if (/\b(analy[sz]e|compare|evaluate|prove|calculate|solve|why|reason|tradeoff|architect|debug)\b/.test(p))
    return "reasoning";
  if (/\b(code|function|component|api|bug|refactor|implement|build a|app)\b/.test(p))
    return "code";
  return "conversation";
}

/** How well a model's declared strengths match the kind of work asked for. */
function strengthBonus(m: CatalogModel, kind: TaskKind): number {
  const s = m.strengths.join(" ");
  const has = (re: RegExp) => (re.test(s) ? 1 : 0);
  switch (kind) {
    case "writing":
      return has(/writing|nuance|narration|analysis/) * 1.4;
    case "reasoning":
      return has(/reasoning|step-by-step|logic|maths|analysis|careful/) * 1.4;
    case "code":
      return has(/code|refactor|architecture|algorithms|agentic/) * 1.4;
    case "translation":
      return has(/multilingual|hindi|hindi-english/) * 1.4;
    case "summarise":
      return has(/long-context|summarisation|summari/) * 1.2;
    default:
      return has(/general|conversational|instruction/) * 0.6;
  }
}

export function pickModel(opts: {
  capability: Exclude<Capability, "router">;
  plan: "free" | "pro";
  prompt: string;
  /** optional PRO manual override id */
  preferModelId?: string;
  /**
   * Providers that actually have a usable key right now. When supplied, models
   * from unconfigured vendors are dropped BEFORE scoring — otherwise the
   * router happily picks Claude on a deployment with no Anthropic key and the
   * request just fails over. Omit to consider the whole catalog.
   */
  availableProviders?: readonly string[];
}): CatalogModel {
  const capability = resolveCapability(opts.capability);
  const { plan, prompt, preferModelId, availableProviders } = opts;
  const complexity = estimateComplexity(prompt);
  const allowed: ModelTier[] = plan === "pro" ? ["pro", "free"] : ["free"];

  const tierPool = MODEL_CATALOG.filter(
    (m) => m.capability === capability && m.tiers.some((t) => allowed.includes(t))
  );

  const pool = availableProviders
    ? tierPool.filter(
        (m) =>
          isKeylessProvider(m.provider) || availableProviders.includes(m.provider)
      )
    : tierPool;

  // PRO manual override — honoured only if that model is actually reachable.
  if (preferModelId && plan === "pro") {
    const hit = pool.find((m) => m.id === preferModelId);
    if (hit) return hit;
  }

  const usable = pool.length ? pool : tierPool;
  if (!usable.length) {
    return MODEL_CATALOG.find((m) => m.id === "openai/gpt-oss-20b")!;
  }

  const kind = detectTaskKind(prompt);

  const scored = usable.map((m) => {
    // Free: minimise cost, keep a quality floor.
    // Pro: maximise quality, cost secondary.
    // Complex tasks push weight towards quality either way.
    const qW = plan === "pro" ? 2.2 : complexity === "complex" ? 1.8 : 1.0;
    // Trivial asks should not burn a flagship: cost dominates hard when the
    // question is a greeting or a one-liner.
    const cW =
      plan === "pro"
        ? 0.4
        : complexity === "simple"
          ? 3.2
          : complexity === "complex"
            ? 1.0
            : 1.3;
    const lW = m.latency === "fast" ? 0.3 : m.latency === "medium" ? 0.1 : -0.2;

    // Strength match is weighted heavily on PRO, where quality is the point.
    const fit = strengthBonus(m, kind) * (plan === "pro" ? 1.6 : 0.8);

    // A reasoning model on a trivial ask is pure latency.
    const overkill =
      complexity === "simple" &&
      m.strengths.some((x) => /reasoning|step-by-step|logic/.test(x))
        ? -0.8
        : 0;

    return { m, score: m.quality * qW - m.cost * cW + lW + fit + overkill };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].m;
}

/**
 * Ordered fallback chain for a capability: the best pick first, then
 * alternatives that prefer a DIFFERENT provider, so one vendor outage cannot
 * take the whole capability down. This is what makes "4-5 models per field"
 * real rather than decorative.
 */
export function modelChain(opts: {
  capability: Exclude<Capability, "router">;
  plan: "free" | "pro";
  prompt: string;
  preferModelId?: string;
  availableProviders?: readonly string[];
  max?: number;
}): CatalogModel[] {
  const capability = resolveCapability(opts.capability);
  const first = pickModel({ ...opts, capability });
  const allowed: ModelTier[] = opts.plan === "pro" ? ["pro", "free"] : ["free"];

  const rest = MODEL_CATALOG.filter(
    (m) =>
      m.capability === capability &&
      m.id !== first.id &&
      m.tiers.some((t) => allowed.includes(t)) &&
      (!opts.availableProviders ||
        isKeylessProvider(m.provider) ||
        opts.availableProviders.includes(m.provider))
  );

  // Cross-vendor first (catalog priority, then quality), then same-vendor alternates.
  const otherVendor = rest.filter((m) => m.provider !== first.provider);
  const sameVendor = rest.filter((m) => m.provider === first.provider);
  const pri = (m: CatalogModel) => PROVIDER_CONFIG[m.provider]?.priority ?? 50;
  const byFallback = (a: CatalogModel, b: CatalogModel) =>
    pri(a) - pri(b) || b.quality - a.quality;
  otherVendor.sort(byFallback);
  sameVendor.sort(byFallback);

  const chain = [first, ...otherVendor, ...sameVendor];
  // de-duplicate by id (the same id can appear under two capabilities)
  const seen = new Set<string>();
  const unique = chain.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return unique.slice(0, opts.max ?? 5);
}

/**
 * BUILDWE Auto-Router model strategy (Phase 10).
 *
 * `pickModel` already ranks the catalog by capability + task-kind blending.
 * This helper makes the operator's *intent → model* policy explicit on top of
 * that, so a very large document is steered to a long-context model, a code
 * ask is steered to the strongest coding model, and so on. It is additive: it
 * returns a hand-picked id for the strong signals, otherwise `undefined` so the
 * caller falls through to the normal scored pick.
 *
 * Policy (mirrors the product spec):
 *   - "generate image" / "draw"  → premium image model (FLUX Pro / Midjourney)
 *     is handled by the image studio route, which already routes by modelId.
 *   - "React"/"Python"/"bug"     → coding flagship (Claude 3.5 Sonnet)
 *   - normal question            → flagship chat (GPT-4o)
 *   - very large file/document   → long-context (Gemini 1.5 Pro)
 */
export function routeModelFor(opts: {
  capability: Exclude<Capability, "router">;
  plan: "free" | "pro";
  prompt: string;
  /** char count of any attached (large) document context */
  contextSize?: number;
}): string | undefined {
  const { capability, plan, prompt, contextSize } = opts;
  if (plan !== "pro") return undefined; // free tier stays cost-driven

  const p = prompt.toLowerCase();
  const LARGE_DOC = "gemini-1.5-pro";

  // Very large context → Gemini 1.5 Pro (2M tokens)
  const largeContext = Boolean(contextSize && contextSize > 100_000);
  const longDocAsk = /\b(pdf|book|report|research paper|thesis|long document|bade (document|pdf)|summary of this (file|doc))\b/.test(p);
  if (capability === "chat" && (largeContext || longDocAsk)) {
    return LARGE_DOC;
  }

  // Code ask → strongest coding model (Claude 3.5 Sonnet as the king of code)
  if (capability === "code" && /\b(react|python|\bbug\b|debug|refactor|component|next\\.?js)\b/.test(p)) {
    return "claude-3-5-sonnet-20241022";
  }

  // Normal question → flagship all-round chat model (GPT-4o)
  if (capability === "chat" && !/\b(pdf|book|report|research paper|thesis|long document)\b/.test(p)) {
    return "gpt-4o";
  }

  return undefined;
}

/** Human-readable matrix for About / docs */
export function modelsByCapability() {
  const caps: Exclude<Capability, "router">[] = [
    "chat",
    "code",
    "image",
    "audio",
    "stt",
    "vision",
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

/* ── What the product calls a model ───────────────────────────────────── */

/**
 * The public brand for a capability. Deliberately not the vendor's product name: the chat chip, the
 * tool cards and /status all say "BUILDWE X", because a person using this app is not buying a Groq
 * subscription from us — they are buying a workspace.
 */
export const MODEL_BRANDS: Record<Capability, string> = {
  chat: "BUILDWE AI",
  router: "BUILDWE AI",
  code: "BUILDWE Code",
  image: "BUILDWE Vision",
  vision: "BUILDWE Vision",
  audio: "BUILDWE Voice",
  stt: "BUILDWE Voice",
};

/**
 * The row for a model id. Capability-aware on purpose: the same Groq id is registered twice (once
 * as a chat model, once as a code model), so a plain `find` would answer a *code* run with the chat
 * row and label it "BUILDWE AI". With no hint there is nothing better to do than take the first row
 * — and a test pins the weaker guarantee that no capability ever lists an id twice.
 */
export function catalogRow(id?: string | null, capability?: Capability): CatalogModel | null {
  if (!id) return null;
  const rows = MODEL_CATALOG.filter((m) => m.id === id);
  if (!rows.length) return null;
  return rows.find((r) => !capability || r.capability === capability) || rows[0];
}

const MODE_CAPABILITY: Record<string, Capability> = {
  chat: "chat",
  code: "code",
  agent: "code",
  image: "image",
  audio: "audio",
  vision: "vision",
  stt: "stt",
};

/**
 * The brand for whoever answered. Audit A9: this used to read the id's *substrings*, so a chat model
 * configured as `AI_CHAT_MODEL=gpt-4o-vision-preview` announced itself as "BUILDWE Vision", and a
 * comparison of three models labelled all three lanes "BUILDWE AI" — a feature whose whole job is
 * telling models apart, printing one word in every lane. Now the catalog row decides. An id the
 * catalog does not know (an env override, a BYOK model) gets the brand for the surface that ran,
 * which is the most that is true about it.
 */
export function publicModelLabel(internal?: string | null, mode?: string): string {
  const hint = mode ? MODE_CAPABILITY[mode] : undefined;
  const row = catalogRow(internal, hint);
  if (row) return MODEL_BRANDS[row.capability];
  return MODEL_BRANDS[hint || "chat"];
}

/**
 * The real model name, for the surfaces whose job is to distinguish models: the comparison lanes and
 * the developer API. Falls back to the brand, never to a guess, so an unknown id stays honest about
 * being unknown.
 */
export function modelDetailLabel(internal?: string | null, mode?: string): string {
  const hint = mode ? MODE_CAPABILITY[mode] : undefined;
  return catalogRow(internal, hint)?.label || publicModelLabel(internal, mode);
}
