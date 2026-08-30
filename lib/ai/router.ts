/**
 * BUILDWE Auto Router — Boss Update #1 section 2.
 *
 * The previous router (`detectIntent` in rules.ts) was first-match regex, which
 * misfired on very common phrasings:
 *
 *   "explain how image compression works"      → image  (wanted: chat)
 *   "write a blog post about React"            → code   (wanted: chat)
 *   "podcast script about startups"            → audio  (wanted: chat)
 *   "build a logo maker app"                   → image  (wanted: code)
 *
 * The problem is that ONE keyword decided everything. This router scores every
 * mode across weighted signals and picks the winner, so a single stray noun
 * can't hijack the routing.
 *
 * `detectIntent` is kept and now delegates here, so every existing caller
 * benefits without any signature change (additive, per boss's rule #1).
 */

export type RouteMode = "chat" | "code" | "image" | "audio";

export type RouteDecision = {
  mode: RouteMode;
  /** 0–1, how sure we are relative to the runner-up */
  confidence: number;
  /** human-readable signals, surfaced in internal metrics/debug */
  reasons: string[];
  scores: Record<RouteMode, number>;
};

type Rule = { re: RegExp; w: number; why: string };

/**
 * Phrases that mean "talk/teach me ABOUT x" rather than "produce x".
 * These are the biggest source of false positives — an explanation request
 * mentioning "image" or "code" is still a CHAT request.
 */
const EXPLAIN_RE =
  /\b(explain|what is|what are|whats|what's|how does|how do|why is|why do|tell me about|difference between|compare|meaning of|define|samjhao|batao|kya hai|kaise kaam)\b/i;

/** Explicit "produce an artifact" verbs. */
const CREATE_RE =
  /\b(make|create|generate|build|design|draw|render|write|code|banao|bana do|likho|chahiye)\b/i;

const IMAGE_RULES: Rule[] = [
  { re: /\b(image|picture|photo|logo|poster|banner|thumbnail|illustration|artwork|wallpaper|icon|mockup|avatar)\b/i, w: 3, why: "visual noun" },
  { re: /\b(draw|render|illustrate|visualize|photorealistic|4k|hd render)\b/i, w: 3, why: "visual verb" },
  { re: /\b(cinematic|watercolor|oil painting|sketch|3d render|concept art|studio lighting|minimal(ist)? design)\b/i, w: 3, why: "art style" },
  { re: /\b(aspect ratio|16:9|9:16|1:1|4:3|portrait mode|landscape mode)\b/i, w: 2, why: "aspect ratio" },
  { re: /^\s*(image|img|picture|photo)\s*[:\-]/i, w: 6, why: "image: prefix" },
];

const AUDIO_RULES: Rule[] = [
  { re: /\b(speak|say|read aloud|voice ?over|voiceover|narrate|narration|tts|text.to.speech)\b/i, w: 4, why: "speech verb" },
  { re: /\b(audio|mp3|podcast|voice|sound ?track|dub|dubbing)\b/i, w: 2, why: "audio noun" },
  { re: /^\s*(speak|say|voice|audio|narrate)\s*[:\-]/i, w: 6, why: "speak: prefix" },
  { re: /\b(male|female) voice\b|\bin (a|an) .{0,20}voice\b/i, w: 3, why: "voice spec" },
];

const CODE_RULES: Rule[] = [
  { re: /\b(code|function|class|method|variable|array|loop|api|endpoint|database|query|schema)\b/i, w: 2, why: "programming noun" },
  { re: /\b(bug|debug|error|exception|stack ?trace|crash|fix this|not working|undefined|null pointer)\b/i, w: 3, why: "debugging" },
  { re: /\b(react|next\.?js|vue|angular|svelte|node|express|django|flask|laravel|rails|spring)\b/i, w: 3, why: "framework" },
  { re: /\b(typescript|javascript|python|java|c\+\+|c#|golang|rust|php|ruby|swift|kotlin|sql|html|css|tailwind)\b/i, w: 3, why: "language" },
  { re: /\b(refactor|optimize|deploy|compile|npm|yarn|pip|git|docker|webpack|vite)\b/i, w: 3, why: "tooling" },
  { re: /```|<\/?[a-z]+>|\bconst |\blet |\bdef |\bimport |\bexport |=>|\{\}/i, w: 4, why: "code syntax" },
  { re: /\b(app|website|web ?app|landing page|dashboard|game|component|form|login page|crud|bot|script)\b/i, w: 2, why: "buildable artifact" },
];

const CHAT_RULES: Rule[] = [
  { re: EXPLAIN_RE, w: 3, why: "explanation request" },
  { re: /\b(idea|ideas|brainstorm|suggest|advice|opinion|think|plan|strategy|help me decide|pros and cons)\b/i, w: 2, why: "thinking task" },
  { re: /\b(essay|blog|article|email|letter|caption|copy|post|summary|summarize|translate|rewrite|paraphrase)\b/i, w: 3, why: "writing task" },
  { re: /^\s*(hi|hey|hello|yo|hy|hii+|namaste|salaam|good (morning|evening|afternoon))\b/i, w: 5, why: "greeting" },
  { re: /\b(kaise ho|kya haal|kaise hain|thanks|thank you|shukriya|ok|okay|cool|nice)\b/i, w: 3, why: "conversational" },
  { re: /\?\s*$/, w: 1, why: "question" },
];

function scoreRules(text: string, rules: Rule[]): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const r of rules) {
    if (r.re.test(text)) {
      score += r.w;
      reasons.push(r.why);
    }
  }
  return { score, reasons };
}

/**
 * Score every mode and return the winner with confidence + reasoning.
 */
export function routeIntent(prompt: string): RouteDecision {
  const text = String(prompt || "").trim();

  // Empty / trivial → chat. Nothing to build from.
  if (text.length < 2) {
    return {
      mode: "chat",
      confidence: 1,
      reasons: ["empty prompt"],
      scores: { chat: 1, code: 0, image: 0, audio: 0 },
    };
  }

  const image = scoreRules(text, IMAGE_RULES);
  const audio = scoreRules(text, AUDIO_RULES);
  const code = scoreRules(text, CODE_RULES);
  const chat = scoreRules(text, CHAT_RULES);

  const reasons: string[] = [];

  // ── Disambiguation: "explain X" beats "produce X" ──────────
  // "explain how image compression works" must NOT route to the image studio.
  const explaining = EXPLAIN_RE.test(text);
  const creating = CREATE_RE.test(text);
  if (explaining && !creating) {
    chat.score += 4;
    image.score = Math.max(0, image.score - 3);
    audio.score = Math.max(0, audio.score - 3);
    // code keeps most of its weight: "explain this error" is still a code task
    code.score = Math.max(0, code.score - 1);
    reasons.push("explanation, not generation");
  }

  // "write a script/blog/story" is writing, not audio/code — unless the user
  // explicitly asks to speak it.
  if (/\b(write|draft|compose|likho)\b/i.test(text) && !/\b(speak|read aloud|voice ?over|tts)\b/i.test(text)) {
    if (/\b(script|story|blog|article|essay|post|copy|email)\b/i.test(text)) {
      chat.score += 3;
      audio.score = Math.max(0, audio.score - 2);
      reasons.push("writing task");
    }
  }

  // A buildable artifact ("logo maker app") is code even though "logo" is a
  // visual noun — the app is the deliverable, not the picture.
  if (/\b(app|website|tool|maker|generator|clone|platform|dashboard)\b/i.test(text) && code.score > 0) {
    code.score += 2;
    image.score = Math.max(0, image.score - 2);
    reasons.push("buildable product");
  }

  const scores: Record<RouteMode, number> = {
    chat: chat.score,
    code: code.score,
    image: image.score,
    audio: audio.score,
  };

  const ranked = (Object.entries(scores) as [RouteMode, number][]).sort(
    (a, b) => b[1] - a[1]
  );
  const [topMode, topScore] = ranked[0];
  const runnerUp = ranked[1][1];

  // Nothing matched → chat is the safe default (it can answer anything).
  if (topScore === 0) {
    return {
      mode: "chat",
      confidence: 0.5,
      reasons: ["no strong signal — default chat"],
      scores,
    };
  }

  const confidence = Math.min(1, (topScore - runnerUp) / Math.max(topScore, 1) + 0.35);
  const detail =
    topMode === "image" ? image.reasons
    : topMode === "audio" ? audio.reasons
    : topMode === "code" ? code.reasons
    : chat.reasons;

  return {
    mode: topMode,
    confidence: Number(confidence.toFixed(2)),
    reasons: Array.from(new Set(detail.concat(reasons))).slice(0, 4),
    scores,
  };
}
