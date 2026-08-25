/**
 * BUILDWE AI operating rules
 * ─────────────────────────
 * HOW THE PLATFORM WORKS
 *
 * 1. MODES
 *    - chat  → Q&A, writing, brainstorm (feels unlimited; fair-use server-side)
 *    - code  → multi-file projects, canvas, optional clarifying Qs if complex
 *    - image → text-to-image
 *    - audio → text-to-speech
 *    - auto  → router reads prompt + intent keywords → picks mode, then runs
 *
 * 2. MODEL TIERS
 *    FREE  → fast / cheaper models (AI_MODELS.free.*)
 *    PRO   → higher quality / priority (AI_MODELS.pro.*)
 *    BYOK  → user pastes their own provider key (encrypted at rest later)
 *
 * 3. ROUTING ORDER (server)
 *    a. If user BYOK for that capability → use their key + their model preference
 *    b. Else if plan=pro → AI_MODELS.pro + priority queue
 *    c. Else → AI_MODELS.free + standard queue
 *    d. On provider error → fallback chain (groq → openrouter → demo)
 *
 * 4. CAPABILITIES BY PLAN
 *    FREE: chat full (fair use), limited code/image/audio (hidden counters)
 *    PRO:  higher limits, priority, better models, no daily image/audio hard cap
 *
 * 5. PRIVACY
 *    - Keys never leave server (except NEXT_PUBLIC_*)
 *    - Don't log full prompts in production without consent
 *    - See /privacy and /terms
 */

export type AIMode = "chat" | "code" | "image" | "audio" | "auto";
export type Plan = "free" | "pro";

export const SYSTEM_PROMPTS = {
  chat: `You are BUILDWE AI — clear, accurate, concise.
Prioritize correctness. Use markdown when useful. Match the user's language.
Do not invent facts. Give actionable answers.`,

  code: `You are BUILDWE CODE — senior engineer.
Ship production-quality, simple code. State assumptions. Prefer complete files.
Structure: brief approach → code → how to run (only when needed).`,

  image: `Enhance image prompts for clarity, lighting, composition. Keep user intent.`,

  audio: `Prepare text for natural TTS. Keep punctuation clear. Do not alter meaning.`,

  auto: `You are BUILDWE router+assistant. Detect if the user wants chat help, code, an image, or audio. Then solve it.`,
} as const;

/** Keyword intent for Auto mode (client + server can share) */
export function detectIntent(
  prompt: string
): Exclude<AIMode, "auto"> {
  const p = prompt.toLowerCase();

  if (
    /(generate|create|draw|render|imagine).*(image|picture|logo|poster|art|photo)/i.test(
      p
    ) ||
    /\b(image|logo|thumbnail|illustration|wallpaper)\b/.test(p)
  ) {
    return "image";
  }

  if (
    /(speak|voice|tts|narrat|read aloud|text to speech|audio)/i.test(p) ||
    /\b(podcast|voiceover)\b/.test(p)
  ) {
    return "audio";
  }

  if (
    /(code|function|component|api|bug|debug|refactor|typescript|python|react|next\.?js|html|css|build (a|an|the)|landing page|website|app|game)/i.test(
      p
    ) ||
    /```/.test(prompt)
  ) {
    return "code";
  }

  return "chat";
}

export function isComplexCodePrompt(text: string): boolean {
  const t = text.toLowerCase();
  const words = text.trim().split(/\s+/).length;
  const signals = [
    "app",
    "website",
    "game",
    "dashboard",
    "project",
    "saas",
    "landing",
    "full",
    "ecommerce",
    "portfolio",
    "clone",
  ];
  return words >= 8 || signals.some((s) => t.includes(s));
}
