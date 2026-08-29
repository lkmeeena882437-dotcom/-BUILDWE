/**
 * BUILDWE Prompt Understanding Layer (Update #1 · P0)
 *
 * Raw prompt → Intent · Entities · Goal · Style · Expected output ·
 * Missing info (material only) → ONE smart clarifier or sensible defaults.
 * Pure heuristics — works with zero provider keys.
 */

export type Understanding = {
  intent:
    | "build-site"
    | "build-app"
    | "code"
    | "debug"
    | "explain"
    | "write"
    | "analyze"
    | "image"
    | "voice"
    | "plan"
    | "chat";
  platform?: string;
  style?: string;
  expectedOutput?: string;
  subject?: string;
  /** missing info that materially changes the output */
  missing: string[];
  /** minor gaps filled with sensible defaults */
  defaultsUsed: string[];
  /** ONE question only when missing info is material; else undefined */
  clarifier?: string;
  /** injects into the system prompt so any model benefits */
  systemHint: string;
  /** human-readable line for the UI chip */
  summary: string;
  /** user asked to change only a specific part (Update #2) */
  surgical: boolean;
  /** user corrected a previous misunderstanding (Update #2) */
  correction: boolean;
};

const PLATFORMS =
  /(telegram|instagram|youtube|whatsapp|twitter|x\.com|linkedin|facebook|shopify|wordpress|github|figma|discord|tiktok|spotify)/i;
const STYLES = {
  professional: /professional|corporate|business|formal|clean|minimal/i,
  fun: /fun|playful|colourful|colorful|vibrant|gen-?z|quirky/i,
  luxury: /luxury|premium|elegant|high-?end|sleek/i,
  dark: /dark|black|midnight/i,
  bright: /bright|light|pastel|white/i,
};
const LANG_HINT = /\b(gujarati|hindi|marathi|tamil|telugu|bengali|kannada|malayalam|punjabi|urdu|arabic|spanish|french|german)\b/i;

function detectIntent(p: string): Understanding["intent"] {
  if (/(logo|poster|thumbnail|image|picture|illustration|banner|wallpaper|icon|art)/i.test(p)) return "image";
  if (/(speak|voice|narrat|voiceover|read (this|it) aloud|audio|podcast)/i.test(p)) return "voice";
  if (/(website|landing page|web ?page|portfolio site|site for|web app)/i.test(p)) return "build-site";
  if (/(app|game|tool|dashboard|clone|calculator|quiz|tracker|bot|extension)/i.test(p)) return "build-app";
  if (/(fix|bug|error|not working|broken|debug|crash|exception)/i.test(p)) return "debug";
  if (/(code|function|component|api|script|regex|sql|query|class|algorithm)/i.test(p)) return "code";
  if (/(plan|strategy|roadmap|steps to|schedule|itinerary|checklist)/i.test(p)) return "plan";
  if (/(analy[sz]e|compare|review|audit|evaluate|pros and cons)/i.test(p)) return "analyze";
  if (/(write|draft|email|caption|essay|blog|article|story|script|bio|copy)/i.test(p)) return "write";
  if (/(explain|what is|how does|why|teach|difference between|meaning)/i.test(p)) return "explain";
  return "chat";
}

/** looks for a name-ish token: capitalized word mid-sentence, quoted, or "for X" */
function findSubject(raw: string): string | undefined {
  const quoted = raw.match(/["“']([^"”']{2,40})["”']/);
  if (quoted) return quoted[1];
  const forMy = raw.match(/\b(?:for|of)\s+(?:my|our|the)\s+([A-Za-z][\w&-]*(?:\s+[A-Za-z][\w&-]*)?)/i);
  if (forMy) return forMy[1];
  const midCap = raw.match(/(?:^|[.!?]\s+|\s)([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?/);
  if (midCap && !/^(I|The|This|That|Make|Create|Build|Write|Explain|Please|Can|You|My|A|An|In|On|For|And|But)$/i.test(midCap[1])) {
    return midCap[2] ? `${midCap[1]} ${midCap[2]}` : midCap[1];
  }
  return undefined;
}

export function understandPrompt(raw: string): Understanding {
  const p = raw.toLowerCase();
  const intent = detectIntent(raw);
  const platform = raw.match(PLATFORMS)?.[1];
  const style = Object.entries(STYLES).find(([, re]) => re.test(raw))?.[0];
  const lang = raw.match(LANG_HINT)?.[1];
  const subject = findSubject(raw);

  // ── Smart-execution modes (Update #2) ────────────────────
  const surgical = /(only|just|sirf|bas)\s+(the\s+)?(section|part|para|paragraph|cta|heading|title|line|button|color)|change\s+(only|just)|make\s+(only|just)|shorten\s+(only|just|section)|replace\s+(only|just)|section\s*\d/i.test(raw);
  const correction = /(not what i meant|that'?s not what|wrong assumption|galat|galti|ulte|ulta|ye nahi|matlab tha|i meant|misunderstood|matlab maine|dusra|doosra chahiye)/i.test(raw);

  const missing: string[] = [];
  const defaultsUsed: string[] = [];
  let clarifier: string | undefined;
  let expectedOutput: string | undefined;

  switch (intent) {
    case "build-site":
      expectedOutput = "landing page / website (single file, deploy-ready)";
      if (!subject) missing.push("brand or channel name");
      if (!platform && /channel|community|group/i.test(p)) defaultsUsed.push("generic community layout");
      break;
    case "build-app":
      expectedOutput = "working app scaffold (runnable code)";
      if (!/(with|using|in)\s+(react|html|next|python|js|javascript|ts|typescript|css|tailwind)/i.test(p))
        defaultsUsed.push("HTML + JS single file (easiest to preview)");
      break;
    case "image":
      expectedOutput = "generated image";
      if (!subject && !style) defaultsUsed.push("clean modern look");
      break;
    case "voice":
      expectedOutput = "spoken audio (MP3)";
      if (raw.trim().length < 40) missing.push("the script to speak");
      break;
    case "write":
      expectedOutput = "written draft";
      if (!/(words|lines|paragraphs|short|long|brief)/i.test(p)) defaultsUsed.push("medium length");
      break;
    case "debug":
      expectedOutput = "diagnosis + fixed code";
      if (!/```|error|traceback|exception|\b\d{3}\b/i.test(raw)) missing.push("the error message or code");
      break;
    case "explain":
      expectedOutput = "clear explanation";
      break;
    default:
      break;
  }

  // Smart clarification: ask ONE question only when the gap is material
  if (missing.length) {
    const what = missing[0];
    clarifier = `Quick check — ${what} kya hai? (Ya bolo "use defaults" aur main sensible placeholders laga dunga.)`;
  }

  const parts = [
    `Intent: ${intent}`,
    subject ? `Subject: ${subject}` : "",
    platform ? `Platform: ${platform}` : "",
    style ? `Style: ${style}` : "",
    lang ? `Language: ${lang}` : "",
    expectedOutput ? `Expected output: ${expectedOutput}` : "",
  ].filter(Boolean);

  const hintLines = [
    "PROMPT UNDERSTANDING (internal — use, don't recite):",
    ...parts.map((l) => `- ${l}`),
    surgical
      ? "- SURGICAL EDIT: the user wants ONLY a specific part changed. Reproduce the previous answer EXACTLY as-is, changing only the part they named. Do not rewrite, reorder, or 'improve' anything else."
      : "",
    correction
      ? "- USER CORRECTION: your previous answer was based on a wrong assumption. (1) Name the wrong assumption in ONE short line. (2) Deliver the corrected answer immediately. Do NOT restart the whole task from zero."
      : "",
    missing.length ? `- Materially missing: ${missing.join(", ")} → FIRST deliver a best-effort version with sensible defaults, THEN ask at most ONE short question about: ${missing[0]}.` :
      "- Nothing critical missing — do not ask questions, just deliver.",
    defaultsUsed.length ? `- Defaults you may assume: ${defaultsUsed.join("; ")}` : "",
  ].filter(Boolean);

  const summaryParts = [...parts];
  if (surgical) summaryParts.push("surgical edit");
  if (correction) summaryParts.push("correction");

  return {
    intent,
    platform: platform ? platform.toLowerCase() : undefined,
    style,
    subject,
    expectedOutput,
    missing,
    defaultsUsed,
    clarifier,
    systemHint: hintLines.join("\n"),
    summary: summaryParts.join(" · ") + (defaultsUsed.length ? ` · defaults: ${defaultsUsed.join(", ")}` : ""),
    surgical,
    correction,
  };
}
