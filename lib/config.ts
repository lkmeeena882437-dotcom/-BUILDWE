/**
 * BUILDWE config — all secrets via env. Replace values in .env.local only.
 * When a provider key is missing, image and voice fall back to keyless public
 * endpoints (real HTTP calls to real services), and everything else says it is
 * unconfigured. There is no mode that answers with invented results.
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
} as const;

/**
 * How many reverse proxies sit in front of us. `x-forwarded-for` is
 * attacker-controlled unless the chain is ours, so with no trusted proxy we
 * must NOT take the client IP from it (audit C3: rotating that header reset
 * every rate-limit bucket). Vercel/Cloudflare set it for us → 1 hop.
 */
export const TRUST_PROXY_HOPS = (() => {
  const explicit = Number(env("TRUST_PROXY_HOPS", ""));
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(explicit, 4);
  if (process.env.VERCEL === "1" || process.env.CF || process.env.FC_REQUEST_ID) return 1;
  // Off production, reading the header is what makes a local demo usable
  // (otherwise every visitor of `localhost:3000` shares one signup bucket).
  // In production the default is 0: unproven headers grant no trust.
  if (process.env.NODE_ENV !== "production") return 1;
  return 0;
})();

/** Ops-only endpoints are closed unless a token is configured. */
export const OPS_TOKEN = env("BW_OPS_TOKEN");
export const ALLOW_DEV_AUTH_LINKS =
  process.env.NODE_ENV !== "production" &&
  env("SHOW_DEV_LINKS", "false") === "true";

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
  /**
   * How many seats one Business order may buy. The multiplier itself is applied
   * server-side (lib/payments/razorpay.ts owns the arithmetic) so a browser can
   * neither pick its price nor its entitlement; this exists only to bound it, and
   * it is served to the UI rather than copied there, so the stepper can never
   * offer a number the order endpoint would refuse.
   */
  seatsMax: envInt("RAZORPAY_PRO_SEATS_MAX", 10),
} as const;

/**
 * Credit economy — the real gate, per the boss's rule of 2026-08-31:
 * **1 normal generation = 1 credit**, heavy tools cost more, signup grants
 * **10 free credits** so anyone can judge the quality, and top-ups are
 * **₹99 = 100** / **₹399 = 500**. Deliberately simple: no expiry, no
 * per-model exchange-rate table, no daily hunt for bonus points. A credit is
 * "one unit of paid work", and the only place it is minted is a real payment,
 * the welcome grant, or the PRO monthly grant.
 *
 * Chat is NOT metered by credits (it keeps its daily fair-use cap) — metering
 * the free hook would make the product worse for the smallest money. Generators
 * are metered, because those are what a bill pays for.
 */
export const CREDITS = {
  welcome: envInt("CREDITS_WELCOME", 10),
  proMonthly: envInt("CREDITS_PRO_MONTHLY", 1000),
  /** what each kind of work costs — the table is here so it is auditable */
  cost: {
    chat: envInt("CREDIT_COST_CHAT", 0),
    image: envInt("CREDIT_COST_IMAGE", 2),
    audio: envInt("CREDIT_COST_AUDIO", 1),
    transcribe: envInt("CREDIT_COST_TRANSCRIBE", 1),
    /** one image read by a model — a model call, priced like a tool */
    vision: envInt("CREDIT_COST_VISION", 1),
    agent: envInt("CREDIT_COST_AGENT", 3),
    /** per live model lane in a side-by-side comparison */
    compareLane: envInt("CREDIT_COST_COMPARE_LANE", 1),
    /** default for a tool whose spec doesn't declare its own cost */
    tool: envInt("CREDIT_COST_TOOL", 1),
  },
  packs: [
    {
      id: "starter",
      label: "Starter pack",
      paise: envInt("CREDIT_PACK_STARTER_PAISE", 9900),
      credits: envInt("CREDIT_PACK_STARTER_CREDITS", 100),
    },
    {
      id: "value",
      label: "Value pack",
      paise: envInt("CREDIT_PACK_VALUE_PAISE", 39900),
      credits: envInt("CREDIT_PACK_VALUE_CREDITS", 500),
    },
  ] as const,
} as const;

export function creditPack(id: string) {
  return CREDITS.packs.find((p) => p.id === String(id || "").trim().toLowerCase());
}

export function hasProviderKey(
  provider: keyof typeof AI_KEYS
): boolean {
  const v = AI_KEYS[provider];
  return Boolean(v && !v.startsWith("your_") && v !== "change_me_long_random_string");
}

/**
 * Whether saved user API keys are encrypted with a secret this deployment
 * owns. `lib/crypto.ts` refuses to fall back in production, so the status page
 * can say "down" instead of implying encryption is always on.
 */
export function byokEncryptionConfigured(): boolean {
  // Exactly the two names lib/crypto.ts will actually use, with no fallback string
  // inside the test: `Boolean(env(K, "some literal"))` is always true, so the old
  // version reported "encrypted with a secret we own" while encrypting with a key
  // that is printed in the public repo.
  return Boolean(AI_KEYS.byokSecret) || Boolean(env("SESSION_SECRET"));
}

export function razorpayConfigured(): boolean {
  return (
    Boolean(RAZORPAY.keyId) &&
    !RAZORPAY.keyId.includes("REPLACE") &&
    Boolean(RAZORPAY.keySecret) &&
    !RAZORPAY.keySecret.startsWith("your_")
  );
}
