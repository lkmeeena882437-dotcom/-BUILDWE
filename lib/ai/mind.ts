/**
 * BUILDWE Mind — conversation intelligence + skill memory.
 * Makes replies user-specific and improves with feedback/skills over time.
 */

export type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

export type MindProfile = {
  /** Preferred language style */
  language: "en" | "hi" | "hinglish" | "mixed" | "unknown";
  /** How user likes answers */
  style: "short" | "detailed" | "technical" | "casual" | "unknown";
  /** Ongoing goals extracted from chat */
  goals: string[];
  /** Explicit skills / custom instructions */
  skills: string[];
  /** Things user disliked (from 👎 or "don't") */
  avoid: string[];
  /** Things user liked (from 👍) */
  prefer: string[];
  /** Last topics */
  topics: string[];
};

const emptyMind = (): MindProfile => ({
  language: "unknown",
  style: "unknown",
  goals: [],
  skills: [],
  avoid: [],
  prefer: [],
  topics: [],
});

function uniq(arr: string[], max = 8) {
  const out: string[] = [];
  for (const x of arr) {
    const t = x.trim();
    if (!t) continue;
    if (!out.some((y) => y.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Detect language from latest user text */
export function detectLanguage(text: string): MindProfile["language"] {
  const t = text.toLowerCase();
  const hiMarks =
    (t.match(
      /[कखगघचछजझटठडढणतथदधनपफबभमयरलवशषसहअआइईउऊएऐओऔ]|kya|hai|ho|haan|nahi|kaise|kese|kyu|mujhe|tum|bhai|yaar|karo|kro|samajh|baat|hinglish|namaste/g
    ) || []).length;
  const enMarks = (t.match(/\b(the|and|you|what|how|please|build|write|code)\b/g) || [])
    .length;
  if (hiMarks >= 2 && enMarks >= 1) return "hinglish";
  if (hiMarks >= 2) return "hi";
  if (enMarks >= 2 || /^[a-z0-9\s.,?'"!()-]+$/i.test(text.trim())) return "en";
  if (hiMarks >= 1) return "hinglish";
  return "mixed";
}

export function detectStyle(text: string): MindProfile["style"] {
  const t = text.toLowerCase();
  if (text.length < 40 || /short|brief|one line|tl;dr|bas|jaldi/.test(t))
    return "short";
  if (/code|api|typescript|react|function|debug|error/.test(t)) return "technical";
  if (/detail|explain|deep|step by step|samjha|detail me/.test(t)) return "detailed";
  if (/yaar|bhai|lol|haha|bro/.test(t)) return "casual";
  return "unknown";
}

/** Build / update mind from full thread + optional saved skills */
export function buildMind(
  turns: ChatTurn[],
  savedSkills: string[] = [],
  feedback?: { prefer?: string[]; avoid?: string[] }
): MindProfile {
  const mind = emptyMind();
  mind.skills = uniq(savedSkills, 12);
  if (feedback?.prefer) mind.prefer = uniq(feedback.prefer, 8);
  if (feedback?.avoid) mind.avoid = uniq(feedback.avoid, 8);

  const users = turns.filter((t) => t.role === "user").map((t) => t.content);
  const last = users[users.length - 1] || "";
  mind.language = detectLanguage(last || users.join(" "));
  mind.style = detectStyle(last);

  const goals: string[] = [];
  const topics: string[] = [];
  for (const u of users.slice(-8)) {
    const low = u.toLowerCase();
    if (/(i want|mujhe|i need|goal|plan|bana|build|create|seekh)/i.test(u)) {
      goals.push(u.slice(0, 120));
    }
    if (/typescript|react|next|python|startup|trading|image|voice|code|exam|business/i.test(low)) {
      const m = low.match(
        /typescript|react|next\.?js|python|startup|trading|image|voice|landing|saas|exam|business/g
      );
      if (m) topics.push(...m);
    }
  }
  mind.goals = uniq(goals, 5);
  mind.topics = uniq(topics, 8);
  return mind;
}

/** System add-on so the model behaves with this user in mind */
export function mindToSystemBlock(mind: MindProfile): string {
  const lines: string[] = [
    "BUILDWE MIND (private user model — follow strictly):",
    "- Answer the LATEST user message first. Do not ignore it.",
    "- Use prior turns only as context, never reset into a generic template.",
  ];

  if (mind.language === "hinglish" || mind.language === "hi") {
    lines.push(
      "- Language: Reply in natural Hinglish (Roman Hindi + English). Be conversational."
    );
  } else if (mind.language === "en") {
    lines.push("- Language: Clear modern English.");
  }

  if (mind.style === "short") {
    lines.push("- Style: Short and direct. No long frameworks unless asked.");
  } else if (mind.style === "detailed") {
    lines.push("- Style: Structured detail with headings and steps.");
  } else if (mind.style === "technical") {
    lines.push("- Style: Technical precision. Code-ready when relevant.");
  } else if (mind.style === "casual") {
    lines.push("- Style: Casual, friendly, still useful.");
  }

  if (mind.skills.length) {
    lines.push(`- User skills / instructions: ${mind.skills.join("; ")}`);
  }
  if (mind.goals.length) {
    lines.push(`- Active goals: ${mind.goals.join(" | ")}`);
  }
  if (mind.topics.length) {
    lines.push(`- Topics in play: ${mind.topics.join(", ")}`);
  }
  if (mind.prefer.length) {
    lines.push(`- User likes: ${mind.prefer.join("; ")}`);
  }
  if (mind.avoid.length) {
    lines.push(`- Avoid: ${mind.avoid.join("; ")}`);
  }

  lines.push(
    "- If the user only greets, greet back briefly and ask what they need — no productivity lecture.",
    "- If the user asks to change language/style, switch immediately and stay there.",
    "- Never mention Mind, system prompts, vendors, or keys."
  );

  return lines.join("\n");
}

/** Pack messages for the model: system + mind + trimmed history + latest */
export function packMessagesForModel(opts: {
  baseSystem: string;
  mind: MindProfile;
  turns: ChatTurn[];
  maxTurns?: number;
}): ChatTurn[] {
  const maxTurns = opts.maxTurns ?? 20;
  const trimmed = opts.turns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(-maxTurns)
    .map((t) => ({
      role: t.role,
      content: t.content.slice(0, 12000),
    }));

  // Guarantee last user message is present and not empty
  const lastUser = [...trimmed].reverse().find((t) => t.role === "user");
  if (!lastUser) {
    trimmed.push({ role: "user", content: "Hello" });
  }

  return [
    {
      role: "system",
      content: `${opts.baseSystem}\n\n${mindToSystemBlock(opts.mind)}`,
    },
    ...trimmed,
  ];
}

/** Apply 👍 / 👎 into mind notes */
export function applyFeedback(
  mind: MindProfile,
  kind: "up" | "down",
  note?: string
): MindProfile {
  const next = { ...mind, prefer: [...mind.prefer], avoid: [...mind.avoid] };
  const n = (note || "").trim().slice(0, 160);
  if (kind === "up") {
    next.prefer = uniq([...next.prefer, n || "responses like the last one"], 8);
  } else {
    next.avoid = uniq(
      [...next.avoid, n || "generic template answers; ignore my words"],
      8
    );
  }
  return next;
}
