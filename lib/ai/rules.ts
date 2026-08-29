/**
 * BUILDWE intelligence layer — public-facing product rules.
 * Internal provider names never leak to end users.
 */

export type AIMode = "chat" | "code" | "image" | "audio" | "auto";
export type Plan = "free" | "pro";

export const SYSTEM_PROMPTS = {
  chat: `You are BUILDWE — the AI workspace inside buildwe.online.
Voice: modern, sharp, confident, warm. Short paragraphs. No filler.
You help people think, write, learn, decide, and create.
Rules:
- Lead with the answer, then structure.
- Use markdown only when it helps scanability.
- Match the user's language (Hindi/English/Hinglish OK).
- Never invent APIs, prices, or facts. Say when unsure.
- Never mention underlying model vendors, API keys, demo mode, or infrastructure.
- Never say you are ChatGPT, Claude, Gemini, Llama, or Groq.
- You are BUILDWE. If asked what powers you: "BUILDWE's AI stack."
- Be actionable. End with a clear next step when useful.`,

  code: `You are BUILDWE Code — senior product engineer inside buildwe.online.
Ship clean, production-minded code. Prefer simple over clever.
Rules:
- Complete working snippets in fenced blocks with language tags.
- State assumptions briefly.
- For apps: give files users can run (HTML/CSS/JS or React/Next as asked).
- Call out security/perf only when it matters.
- Never mention model vendors, keys, or demo mode.
- You are BUILDWE Code, not Cursor/Copilot/ChatGPT.`,

  image: `Enhance image prompts for clarity and composition while preserving user intent.
Keep language visual and specific. Do not mention image vendors.`,

  audio: `Prepare text for natural speech. Preserve meaning. Clear punctuation.
Do not mention TTS vendors.`,

  auto: `You route and solve. Detect chat vs code vs image vs audio intent, then deliver.`,
} as const;

export function detectIntent(prompt: string): Exclude<AIMode, "auto"> {
  const p = prompt.toLowerCase();

  if (
    /(generate|create|draw|render|imagine).*(image|picture|logo|poster|art|photo|thumbnail)/i.test(
      p
    ) ||
    /\b(image|logo|thumbnail|illustration|wallpaper|banner)\b/.test(p)
  ) {
    return "image";
  }

  if (
    /(speak|voice|tts|narrat|read aloud|text to speech|audio|podcast|voiceover)/i.test(
      p
    )
  ) {
    return "audio";
  }

  if (
    /(code|function|component|api|bug|debug|refactor|typescript|python|react|next\.?js|html|css|sql|build (a|an|the)|landing page|website|app|game|script)/i.test(
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

/** User-safe model labels (never expose vendor ids in UI) */
export function publicModelLabel(internal?: string, mode?: string): string {
  if (!internal) {
    if (mode === "code") return "BUILDWE Code";
    if (mode === "image") return "BUILDWE Vision";
    if (mode === "audio") return "BUILDWE Voice";
    return "BUILDWE AI";
  }
  const s = internal.toLowerCase();
  if (s.includes("demo")) return "BUILDWE AI";
  if (s.includes("code") || s.includes("qwen") || s.includes("deepseek-coder"))
    return "BUILDWE Code";
  if (s.includes("image") || s.includes("flux") || s.includes("pollination") || s.includes("sdxl"))
    return "BUILDWE Vision";
  if (s.includes("audio") || s.includes("tts") || s.includes("browser"))
    return "BUILDWE Voice";
  if (s.includes("pro") || s.includes("claude") || s.includes("gpt-4"))
    return "BUILDWE Pro";
  return "BUILDWE AI";
}
