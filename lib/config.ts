/**
 * BUILDWE config — all secrets via env. Replace values in .env.local only.
 * TEST MODE: when keys missing, adapters return safe demo responses.
 */

function env(key: string, fallback = ""): string {
  if (typeof process === "undefined") return fallback;
  return (process.env[key] as string | undefined)?.trim() || fallback;
}

function envInt(key: string, fallback: number): number {
  const n = Number(env(key, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

export const APP = {
  name: env("NEXT_PUBLIC_APP_NAME", "BUILDWE.ONLINE"),
  url: env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  demoMode: env("NEXT_PUBLIC_DEMO_MODE", "true") === "true",
} as const;

export const LIMITS = {
  free: {
    codeDaily: envInt("FREE_CODE_DAILY_LIMIT", 15),
    imageDaily: envInt("FREE_IMAGE_DAILY_LIMIT", 5),
    audioDaily: envInt("FREE_AUDIO_DAILY_LIMIT", 5),
  },
  pro: {
    codeMonthly: envInt("PRO_CODE_MONTHLY_LIMIT", 500),
    imageMonthly: envInt("PRO_IMAGE_MONTHLY_LIMIT", 999999),
    audioMonthly: envInt("PRO_AUDIO_MONTHLY_LIMIT", 999999),
  },
} as const;

/** Server-only AI keys — never import this object into client components */
export const AI_KEYS = {
  groq: env("GROQ_API_KEY"),
  openrouter: env("OPENROUTER_API_KEY"),
  openai: env("OPENAI_API_KEY"),
  anthropic: env("ANTHROPIC_API_KEY"),
  google: env("GOOGLE_API_KEY"),
  hf: env("HF_TOKEN"),
  fal: env("FAL_KEY"),
  mistral: env("MISTRAL_API_KEY"),
  deepseek: env("DEEPSEEK_API_KEY"),
  together: env("TOGETHER_API_KEY"),
  stability: env("STABILITY_API_KEY"),
  replicate: env("REPLICATE_API_TOKEN"),
  goapi: env("GOAPI_API_KEY"),
  playht: env("PLAYHT_API_KEY"),
  elevenlabs: env("ELEVENLABS_API_KEY"),
  deepgram: env("DEEPGRAM_API_KEY"),
  byokSecret: env("BYOK_ENCRYPTION_SECRET"),
} as const;

export const AI_MODELS = {
  free: {
    chat: env("AI_CHAT_MODEL", "llama-3.3-70b-versatile"),
    code: env("AI_CODE_MODEL", "qwen-2.5-coder-32b"),
    image: env("AI_IMAGE_MODEL", "fal-ai/flux/schnell"),
    audio: env("AI_AUDIO_MODEL", "openai-audio"),
  },
  pro: {
    chat: env("AI_CHAT_MODEL_PRO", "gpt-4o"),
    code: env("AI_CODE_MODEL_PRO", "claude-3-5-sonnet-20241022"),
    image: env("AI_IMAGE_MODEL_PRO", "fal-ai/flux/dev"),
    audio: env("AI_AUDIO_MODEL_PRO", "eleven_multilingual_v2"),
  },
} as const;

export const RAZORPAY = {
  /** Public key — safe in browser checkout */
  keyId: env("NEXT_PUBLIC_RAZORPAY_KEY_ID", "rzp_test_REPLACE_ME"),
  /** Server only */
  keySecret: env("RAZORPAY_KEY_SECRET"),
  webhookSecret: env("RAZORPAY_WEBHOOK_SECRET"),
  amountPaise: envInt("RAZORPAY_PRO_AMOUNT_PAISE", 50000),
  currency: env("RAZORPAY_PRO_CURRENCY", "INR"),
  planName: env("RAZORPAY_PRO_PLAN_NAME", "BUILDWE PRO"),
  planId: env("RAZORPAY_PRO_PLAN_ID"),
} as const;

export function hasProviderKey(
  provider: keyof typeof AI_KEYS
): boolean {
  const v = AI_KEYS[provider];
  return Boolean(v && !v.startsWith("your_") && v !== "change_me_long_random_string");
}

export function razorpayConfigured(): boolean {
  return (
    Boolean(RAZORPAY.keyId) &&
    !RAZORPAY.keyId.includes("REPLACE") &&
    Boolean(RAZORPAY.keySecret) &&
    !RAZORPAY.keySecret.startsWith("your_")
  );
}
