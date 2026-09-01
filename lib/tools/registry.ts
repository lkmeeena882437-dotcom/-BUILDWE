/**
 * BUILDWE tool registry (Wave 1) — 31 real writing/marketing/dev tools.
 *
 * This is the thing the product was missing: `app.1min.ai`'s homepage nav is
 * ~70 purpose-built generators, and BUILDWE had one free-text composer. Every
 * entry below is executable: the same spec drives the public tool page, the
 * server-side prompt, the input validation, the output contract the runner
 * enforces, and the tests. There is no tool that exists in a menu but has no
 * engine behind it — `tests/tools.mjs` boots the app and runs them.
 *
 * Prompt design notes (why these are not "write me a blog post" wrappers):
 *  • Every tool states the output format it will be graded on, so the runner's
 *    checks (headings / bullets / length / must-include) are contract, not vibe.
 *  • Facts the user did not supply must come back as `[ADD: …]` instead of
 *    being invented. That is the anti-hallucination rule the audit asked for.
 *  • Length/audience/tone/language are inputs, not afterthoughts, so the tool
 *    is deterministic about shape while the model decides content.
 */

import type { ToolField, ToolSpec, Values } from "./types";

/* ── field helpers ───────────────────────────────────────── */

const text = (
  key: string,
  label: string,
  o: { required?: boolean; max?: number; placeholder?: string; help?: string } = {}
): ToolField => ({
  key,
  label,
  kind: "text",
  required: o.required,
  max: o.max ?? 300,
  ...(o.placeholder ? { placeholder: o.placeholder } : {}),
  ...(o.help ? { help: o.help } : {}),
});

const area = (
  key: string,
  label: string,
  o: { required?: boolean; max?: number; placeholder?: string; help?: string } = {}
): ToolField => ({
  key,
  label,
  kind: "textarea",
  required: o.required,
  max: o.max ?? 6000,
  ...(o.placeholder ? { placeholder: o.placeholder } : {}),
  ...(o.help ? { help: o.help } : {}),
});

const sel = (
  key: string,
  label: string,
  options: [string, string][],
  def?: string,
  help?: string
): ToolField => ({
  key,
  label,
  kind: "select",
  options: options.map(([value, l]) => ({ value, label: l })),
  ...(def ? { default: def } : {}),
  ...(help ? { help } : {}),
});

const num = (key: string, label: string, min: number, maxV: number, def: number): ToolField => ({
  key,
  label,
  kind: "number",
  min,
  max_value: maxV,
  default: def,
});

const bool = (key: string, label: string, def = false): ToolField => ({
  key,
  label,
  kind: "checkbox",
  default: def,
});

const AUDIENCE = sel(
  "audience",
  "Who reads this?",
  [
    ["general", "General audience"],
    ["beginner", "Beginners"],
    ["pro", "Professionals in the field"],
    ["buyer", "Potential buyers"],
    ["exec", "Executives / decision makers"],
    ["student", "Students"],
  ],
  "general"
);

const TONE = sel(
  "tone",
  "Tone",
  [
    ["neutral", "Clear and neutral"],
    ["friendly", "Warm and friendly"],
    ["bold", "Bold and punchy"],
    ["formal", "Formal"],
    ["witty", "Witty"],
    ["authoritative", "Authoritative"],
    ["empathetic", "Empathetic"],
  ],
  "neutral"
);

const LANGUAGE = sel(
  "language",
  "Language",
  [
    ["match", "Match my input"],
    ["en", "English"],
    ["hi", "हिन्दी (Hindi)"],
    ["hinglish", "Hinglish (Roman script)"],
    ["es", "Español"],
    ["fr", "Français"],
    ["de", "Deutsch"],
  ],
  "match",
  "Output is written in this language; instructions stay in English."
);

const LENGTH = sel(
  "length",
  "Length",
  [
    ["short", "Short"],
    ["medium", "Medium"],
    ["long", "Long / in-depth"],
  ],
  "medium"
);

const WORDS: Record<string, string> = {
  short: "Target 200–350 words.",
  medium: "Target 500–750 words.",
  long: "Target 1100–1600 words.",
};

/* ── shared rules ────────────────────────────────────────── */

/**
 * The house rules every generator shares. Kept as one string so "no invented
 * facts" is enforced in 31 places by editing one.
 */
const RULES = `HARD RULES
- No preamble, no sign-off, no "Certainly", no talking about the task. Output the deliverable and nothing else.
- Never invent facts: names, statistics, dates, prices, citations, testimonials or quotes. Anything you need but were not given must appear as [ADD: what is needed] so the user fills it in themselves.
- No superlative inflation ("game-changing", "revolutionary", "unmatched") unless the user asked for hype.
- Plain sentences. Active voice. Cut adverbs. British or American spelling, consistent throughout.
- Markdown only for structure the format needs (headings, lists, bold). No emoji unless asked for.`;

function styleLines(v: Values): string {
  const bits: string[] = [];
  if (v.audience && v.audience !== "match") {
    const who: Record<string, string> = {
      general: "Write for a general audience.",
      beginner: "Write for beginners: define every technical term in one clause.",
      pro: "Write for practitioners: skip basics, be precise, use correct jargon.",
      buyer: "Write for a buyer: benefits over features, objection-aware, no jargon.",
      exec: "Write for an executive: answer first, evidence second, no filler.",
      student: "Write for a student: concrete examples, simple structure.",
    };
    bits.push(who[String(v.audience)] || "");
  }
  const toneMap: Record<string, string> = {
    neutral: "Tone: clear and neutral.",
    friendly: "Tone: warm and human, contractions welcome.",
    bold: "Tone: bold and punchy — short sentences, strong verbs.",
    formal: "Tone: formal and professional.",
    witty: "Tone: witty, but never at the reader's expense.",
    authoritative: "Tone: authoritative — state, don't hedge.",
    empathetic: "Tone: empathetic and considerate of the reader's situation.",
  };
  if (toneMap[String(v.tone)]) bits.push(toneMap[String(v.tone)]);
  if (v.language && v.language !== "match") {
    bits.push(`Write the deliverable in ${String(v.language)} (keep proper nouns as given).`);
  }
  if (v.length && WORDS[String(v.length)]) bits.push(WORDS[String(v.length)]);
  if (v.extra) bits.push(`Additional user instruction: ${String(v.extra)}`);
  return bits.filter(Boolean).join(" ");
}

const EXTRA = text(
  "extra",
  "Anything else it must do?",
  { max: 500, placeholder: "e.g. mention the free trial, keep sentences under 14 words" }
);

/** common tail used by the long-form prose tools */
function proseSpec(
  id: string,
  name: string,
  tagline: string,
  description: string,
  role: string,
  format: string,
  checks: ToolSpec["checks"],
  maxTokens: number,
  creditCost = 2
): ToolSpec {
  return {
    id,
    name,
    category: "Writing",
    tagline,
    description,
    feature: "chat",
    creditCost,
    maxTokens,
    temperature: 0.7,
    fields: [
      area("topic", "What is it about?", {
        required: true,
        max: 4000,
        placeholder: "Why most Indian D2C brands plateau at ₹40L ARR — and the 3 levers that break the ceiling",
        help: "Topic, thesis, or paste your rough notes / draft.",
      }),
      text("context", "Context (optional)", {
        max: 3000,
        placeholder: "brand name, product, offer, region, data points you want used",
      }),
      AUDIENCE,
      TONE,
      LENGTH,
      LANGUAGE,
      EXTRA,
    ],
    checks,
    buildSystem: (v) =>
      `You are BUILDWE's ${role}. ${format}\n\n${styleLines(v)}\n\n${RULES}`,
    buildUser: (v) =>
      `TOPIC / NOTES:\n${String(v.topic || "")}\n\nCONTEXT:\n${String(v.context || "none provided")}`,
  };
}

/* ── the registry ────────────────────────────────────────── */

export const TOOLS: ToolSpec[] = [
  /* ══ Writing ══════════════════════════════════════════════ */
  proseSpec(
    "blog-post",
    "Blog Post Writer",
    "Outline-ready post with H2s, meta description and a CTA.",
    "Turns a topic, a thesis or rough notes into a publishable blog post: SEO-shaped headings, an answer-first intro, scannable sections, a meta description and a call to action. Facts you didn't supply come back as [ADD:] placeholders instead of invented statistics.",
    "long-form blog writer",
    'OUTPUT FORMAT — exactly this:\n1. Line 1: "# <title>" under 60 characters.\n2. Then a "## Key takeaways" section with 3–5 bullets.\n3. Then 3–6 "## " sections with prose; at most one bullet list per section.\n4. Then a "## Call to action" section of 1–3 sentences that tells the reader what to do next.\n5. Finish with a line "META: <150–158 character meta description>" and a line "SLUG: <kebab-case-slug>".',
    { headings: 4, bullets: 3, minWords: 250, mustInclude: ["META:", "SLUG:"] },
    4096
  ),
  proseSpec(
    "article-writer",
    "Article Writer",
    "Structured article with sections, examples and a summary.",
    "A tighter, more editorial sibling of the blog post: lede, nut graf, argument in sections, one worked example, and a closing summary. Suited to publications, newsletters and knowledge bases.",
    "article writer for an online publication",
    "OUTPUT FORMAT — exactly this:\n1. \"# <headline>\" then a one-line standfirst in italics.\n2. A lede paragraph (answer first), then a nut graf stating what the article argues and why it matters.\n3. 3–6 \"## \" sections. At least one section must contain a concrete worked example or scenario.\n4. End with \"## Bottom line\" — 2–4 sentences, no new claims.\nDo not include a meta description or CTA block.",
    { headings: 4, minWords: 300 },
    4096
  ),
  proseSpec(
    "essay-writer",
    "Essay Writer",
    "Thesis-driven essay with arguments, evidence and counterpoints.",
    "Builds an argumentative or expository essay: thesis, body paragraphs that each carry one claim with reasoning, an honest counterargument with a rebuttal, and a conclusion. It writes a model essay for you to work from — the thinking stays yours.",
    "essay writer",
    "OUTPUT FORMAT — exactly this:\n1. An introduction ending in a single-sentence thesis.\n2. 3–5 body paragraphs, each starting with a topic sentence and carrying one claim plus its reasoning.\n3. One \"Counterargument\" paragraph that states the strongest opposing view fairly, then rebuts it.\n4. A conclusion that restates the thesis in new words and says what follows from it.\nNumber the sections with \"## \" headings so the structure is visible. Do not fabricate sources; where evidence is needed write [ADD: citation for …].",
    { headings: 4, minWords: 350, mustInclude: ["Counterargument"] },
    3072
  ),
  {
    id: "paraphraser",
    name: "Paraphrasing Tool",
    category: "Writing",
    tagline: "Same meaning, new wording — in the style you pick.",
    description:
      "Rewrites your text in a different register without drifting from the original meaning. Choose fluent, formal, simple, shortened or expanded. Returns the rewrite plus a one-line note on what changed, so you can see it didn't add claims.",
    feature: "chat",
    maxTokens: 1600,
    temperature: 0.5,
    keywords: /\b(paraphras|rewrite this|rephrase|doosre shabdon)\b/i,
    fields: [
      area("source", "Text to paraphrase", {
        required: true,
        max: 6000,
        placeholder: "Paste the paragraph. The rewrite keeps every fact and drops nothing.",
      }),
      sel(
        "mode",
        "Rewrite style",
        [
          ["fluent", "Fluent — same meaning, better flow"],
          ["formal", "Formal — for reports and clients"],
          ["simple", "Simple — plain words, shorter sentences"],
          ["short", "Condensed — about 60% of the length"],
          ["expand", "Expanded — more explanation, same claims"],
        ],
        "fluent"
      ),
      LANGUAGE,
    ],
    checks: { minWords: 12 },
    buildSystem: (v) =>
      `You are a paraphrasing engine. Mode: ${String(v.mode || "fluent")}. ${styleLines(v)}
RULES
- Preserve every fact, number, name, negation and degree word ("most" must not become "all").
- Do not add new claims, examples, or emphasis. Do not shorten in expanded mode or lengthen in condensed mode beyond the stated target.
- Return ONLY this, in this order:
REWRITE:
<the paraphrased text>

CHANGED: <one sentence on what was actually improved, max 20 words>
- Output plain text (no markdown headings). Never comment on quality or ask follow-ups.`,
    buildUser: (v) => `SOURCE TEXT:\n${String(v.source || "")}`,
  },
  {
    id: "grammar-checker",
    name: "Grammar Checker",
    category: "Writing",
    tagline: "Fixes grammar, explains the two real edits.",
    description:
      "Corrects grammar, punctuation, agreement and clarity, returns the clean version, and lists each meaningful change with the rule behind it. Style preferences are left alone unless they hurt readability — so you learn instead of trusting a black box.",
    feature: "chat",
    maxTokens: 2048,
    temperature: 0.2,
    keywords: /\b(grammar|proofread|spelling|tyo?\w*\s?check)\b/i,
    fields: [
      area("source", "Text to check", {
        required: true,
        max: 6000,
        placeholder: "Paste the text you want cleaned up.",
      }),
      bool("explain", "Explain each fix", true),
      bool("strict", "Also tighten style (not just errors)", false),
    ],
    checks: { mustInclude: ["CORRECTED:"] },
    buildSystem: (v) =>
      `You are a copy editor.
CORRECTED: return the full text with errors fixed, same order, same meaning, no added content.
${v.explain ? 'Then a "CHANGES:" section: one line per real edit as "«before» → «after» — <rule in ≤10 words>". Only list substantive edits (grammar, agreement, tense, punctuation that changes meaning, ambiguity); skip trivial commas, and if there were none write "CHANGES:\nNone — the text was already correct."' : "Do not list changes; return the corrected text only."}
${v.strict ? "Also fix wordiness, passive constructions that hide the actor, and vague nouns, and mark those lines with (style)." : "Do NOT rewrite for taste. If a sentence is grammatically fine, leave it exactly as written."}
Never invent facts, never add sentences, never comment on the writing.`,
    buildUser: (v) => `TEXT:\n${String(v.source || "")}`,
  },

  /* ══ Social ═══════════════════════════════════════════════ */
  {
    id: "tweet-writer",
    name: "Tweet Writer",
    category: "Social",
    tagline: "Ten within-limit options, each with a reason.",
    description:
      "Writes ten genuinely different posts about your idea, every one under 280 characters, no hashtags unless you ask, and a one-line note on why each works. The counter is enforced by the runner, not by hope.",
    feature: "chat",
    maxTokens: 1200,
    temperature: 0.85,
    keywords: /\b(tweet|x post|status update)\b/i,
    fields: [
      area("idea", "What's the post about?", {
        required: true,
        max: 1500,
        placeholder: "We shipped offline mode after 400 users told us their metro drops signal every 2 minutes",
      }),
      sel(
        "angle",
        "Angle",
        [
          ["insight", "Insight / observation"],
          ["story", "Mini story"],
          ["contrarian", "Contrarian take"],
          ["launch", "Launch announcement"],
          ["question", "Question that invites replies"],
          ["listicle", "Compressed list"],
        ],
        "insight"
      ),
      TONE,
      bool("hashtags", "Allow hashtags", false),
      bool("threads", "Allow line breaks between beats", true),
    ],
    checks: { maxChars: 12000, variants: [8, 12] },
    buildSystem: (v) =>
      `You are a ${String(v.angle || "insight")} tweet writer. ${styleLines(v)}
OUTPUT: exactly 10 options, one per line, formatted "N. <text> — why: <≤8 words>".
EVERY OPTION MUST BE ≤ 280 CHARACTERS including spaces. Count them; longer ones are invalid and will be rejected.
${v.hashtags ? "You may use at most one hashtag per option." : "No hashtags at all."}
${v.threads ? "Line breaks inside an option are allowed to create rhythm (keep each line under 40 chars)." : "Each option must be a single line."}
No emoji unless the user asked. Don't open with "I", "Just", "Thrilled" or a thread-hook cliché. Don't fake numbers or quotes.`,
    buildUser: (v) => `IDEA:\n${String(v.idea || "")}`,
  },
  {
    id: "x-thread",
    name: "Thread Writer",
    category: "Social",
    tagline: "Hook, 6–9 beats, closer with a takeaway.",
    description:
      "Builds a numbered X thread: a hook that earns the click, one idea per tweet, a concrete example in the middle, and a closing tweet that restates the takeaway. Each tweet is checked for length; the thread is checked for arc.",
    feature: "chat",
    maxTokens: 2048,
    temperature: 0.75,
    keywords: /\b(thread\b|twitter thread)\b/i,
    fields: [
      area("subject", "Thread subject", {
        required: true,
        max: 2000,
        placeholder: "How we cut our AI bill 71% without users noticing — 8 things that actually worked",
      }),
      num("tweets", "How many tweets", 3, 12, 8),
      sel("goal", "Goal", [
        ["teach", "Teach something"],
        ["story", "Tell a story"],
        ["launch", "Announce / launch"],
        ["debate", "Make an argument"],
      ], "teach"),
      TONE,
    ],
    checks: { minWords: 60, variants: [3, 14] },
    buildSystem: (v) =>
      `You are a thread writer. ${styleLines(v)}
OUTPUT FORMAT — ${Number(v.tweets) || 8} tweets, each on its own block, prefixed exactly "1/8 " style (current/total).
- Tweet 1 is the hook: a specific promise or number, no "🧵 1/8" cliché before it.
- Middle tweets: one idea each, ≤ 270 characters, concrete over abstract. At least one must carry a real example or number the user supplied.
- Final tweet: the takeaway + what to do with it.
If you need a fact the user didn't provide, write [ADD: …] inside that tweet rather than inventing it. No link shorteners, no "follow me" bait unless requested.`,
    buildUser: (v) => `SUBJECT:\n${String(v.subject || "")}\nGOAL: ${String(v.goal || "teach")}`,
  },
  {
    id: "instagram-caption",
    name: "Instagram Caption",
    category: "Social",
    tagline: "Caption + first comment hashtags, in your voice.",
    description:
      "Writes a caption that matches the image you describe, with a hook line, a human middle, and a call to action. Hashtags go in a separate first-comment block so the caption itself doesn't read like spam.",
    feature: "chat",
    maxTokens: 900,
    temperature: 0.8,
    keywords: /\b(instagram|caption|insta post|reel)\b/i,
    fields: [
      area("image", "What's in the post?", {
        required: true,
        max: 1500,
        placeholder: "Photo of our new filter bottle on a Pune rooftop at dusk, launch week",
      }),
      text("cta", "Call to action", { max: 200, placeholder: "comment FILTER for the link" }),
      num("hashtags", "Hashtags in first comment", 0, 15, 8),
      sel("voice", "Voice", [
        ["casual", "Casual"],
        ["poetic", "Poetic"],
        ["funny", "Funny"],
        ["brand", "Polished brand voice"],
      ], "casual"),
    ],
    checks: { minWords: 12, maxChars: 2400 },
    buildSystem: (v) =>
      `You are an Instagram caption writer with a ${String(v.voice || "casual")} voice. ${styleLines(v)}
OUTPUT FORMAT:
CAPTION:
<max 2100 characters. Line 1 is the hook (≤ 8 words, no hashtag). Then 2–5 short lines. Last line is the call to action${v.cta ? `: ${String(v.cta)}` : "."}>

FIRST COMMENT:
<${Number(v.hashtags) || 0} hashtags, space separated, specific to the post — no #love #instagood filler>
Never invent prices, dates, discounts, stock or "link in bio" unless given. No emoji walls (≤ 4 emoji total).`,
    buildUser: (v) => `POST:\n${String(v.image || "")}`,
  },
  {
    id: "facebook-post",
    name: "Facebook Post",
    category: "Social",
    tagline: "Community-first post that invites replies.",
    description:
      "Writes a page/group post tuned for conversation: a plain-spoken opener, one idea with a detail that makes it real, and a question people can actually answer. No hashtag spam, no engagement bait phrasing.",
    feature: "chat",
    maxTokens: 700,
    temperature: 0.8,
    keywords: /\b(facebook|fb post|group post)\b/i,
    fields: [
      area("news", "What are you telling people?", { required: true, max: 1500, placeholder: "We're reopening the repair café on Sunday, and we need 3 volunteers who can open a laptop" }),
      sel("kind", "Post type", [["update", "Update"], ["offer", "Offer / announcement"], ["question", "Question / discussion"], ["event", "Event reminder"]], "update"),
      text("cta", "Where should the link/go to?", { max: 200, placeholder: "forms.gate/repairstall" }),
    ],
    checks: { minWords: 25, maxChars: 4000 },
    buildSystem: (v) =>
      `You are writing a Facebook ${String(v.kind || "update")} for a page's audience.
Rules: conversational, 80–180 words, short paragraphs (1–2 lines each), one specific detail that proves it's real, and end with a question a member can answer in one line${v.cta ? ` plus a line pointing to ${String(v.cta)}` : ""}.
No hashtags unless the user asked. No "👇", "Tag a friend who", "Don't forget to like", or other engagement bait. No invented times, prices, venues or availability — [ADD: …] instead. Output the post text only.`,
    buildUser: (v) => `SUBSTANCE:\n${String(v.news || "")}`,
  },
  {
    id: "linkedin-post",
    name: "LinkedIn Post",
    category: "Social",
    tagline: "Hook in 2 lines, one lesson, no LinkedIn voice.",
    description:
      "Writes a post that reads like a person: a scroll-stopping first two lines, a specific story or number, the lesson, and an open question. Explicitly bans the fake-insight patterns that make the platform a joke.",
    feature: "chat",
    maxTokens: 1000,
    temperature: 0.7,
    keywords: /\blinkedin|b2b post|professional post\b/i,
    fields: [
      area("message", "The point / story you want to land", { required: true, max: 2500, placeholder: "Our first enterprise deal died in procurement for 5 months and it taught us to write the security doc before the sales deck" }),
      sel("format", "Shape", [["story", "Short story + lesson"], ["list", "Numbered takeaways"], ["hot-take", "Contrarian take"], ["update", "Milestone update"]], "story"),
      bool("hashtags", "Add 3 hashtags", false),
    ],
    checks: { minWords: 60, maxChars: 6000 },
    buildSystem: (v) =>
      `You are a ${String(v.format || "story")} LinkedIn writer.
FORMAT: line 1 ≤ 12 words that creates tension; line 2 adds specificity; blank line; then 2–5 short paragraphs of ≤ 3 lines each; end with one question or one clear takeaway${v.hashtags ? "; then 3 relevant hashtags on a final line" : ""}.
BANNED, for real: "I'm humbled to", "Thrilled to announce", "Agree?", "🚀🚀🚀", one-word lines used as a rhythm trick three times in a row, fake dialogue ("He said, 'You can't.' I said, 'Watch me.'"), and any invented metric, date, client name or quote.
Length 120–220 words. If the user's facts are thin, write [ADD: the number that proves it] rather than inventing. Output only the post.`,
    buildUser: (v) => `SUBSTANCE:\n${String(v.message || "")}`,
  },
  {
    id: "linkedin-comment",
    name: "LinkedIn Comment",
    category: "Social",
    tagline: "A reply that adds something instead of 'Great post!'",
    description:
      "Writes 5 candidate comments on a post you paste — each taking a position, adding an experience or asking a sharp question, so the algorithm and the author both get value from it. Sound like a colleague, not a bot.",
    feature: "chat",
    maxTokens: 700,
    temperature: 0.8,
    fields: [
      area("post", "The post you're commenting on", { required: true, max: 4000, placeholder: "Paste it in. I'll read it and respond to the actual argument." }),
      sel("stance", "Your stance", [["agree", "Agree + extend"], ["nuance", "Agree mostly, one caveat"], ["disagree", "Respectfully disagree"], ["question", "Ask the missing question"]], "nuance"),
      text("me", "One line about you (for credibility)", { max: 200, placeholder: "I run ops at a 40-person fintech" }),
    ],
    checks: { variants: [4, 6], minWords: 20 },
    buildSystem: (v) =>
      `You are writing a ${String(v.stance || "nuance")} comment on someone's LinkedIn post${v.me ? ` from: ${String(v.me)}` : ""}.
Give exactly 5 options, one per line as "1. <comment> (why: ≤6 words)". Each 20–60 words. Each must reference something specific from the post, not its topic generally. No "Great insights!", no "Thanks for sharing", no emoji, no pitching, no invented personal anecdotes beyond what the user gave.`,
    buildUser: (v) => `POST:\n${String(v.post || "")}`,
  },
  {
    id: "youtube-script",
    name: "YouTube Script",
    category: "Social",
    tagline: "Hook, chapters, retention beats, end screen.",
    description:
      "Writes a spoken script with timestamps, chapter markers and retention beats: an opening that pays off the thumbnail, a promise, then chapters that each end on a reason to keep watching. Includes a description and chapter list you can paste.",
    feature: "chat",
    creditCost: 2,
    maxTokens: 4096,
    temperature: 0.65,
    keywords: /\b(youtube|video script|reel script|shorts script)\b/i,
    fields: [
      text("title", "Working title", { required: true, max: 150, placeholder: "I rebuilt our AI stack on a ₹4k/month budget" }),
      area("beats", "What actually happens / what you want to say", { required: true, max: 5000, placeholder: "Costs before, what we removed, latency numbers, the one thing I'd do differently" }),
      sel("style", "Delivery", [["talking", "Talking head"], ["vo", "Voice-over with b-roll"], ["tutorial", "Screen-recorded tutorial"], ["interview", "Q&A"]], "talking"),
      num("minutes", "Target length (minutes)", 1, 30, 8),
      LANGUAGE,
    ],
    checks: { headings: 3, minWords: 200 },
    buildSystem: (v) =>
      `You are a ${String(v.style || "talking")} YouTube scriptwriter for a video of about ${Number(v.minutes) || 8} minutes (≈${(Number(v.minutes) || 8) * 150} spoken words). ${styleLines(v)}
OUTPUT FORMAT — exactly:
## HOOK (0:00–0:20) — say, don't sell: the payoff in one sentence + why it isn't obvious
## SETUP — what the video proves and the one rule for watching
## CHAPTERS — for each chapter: "### <name> (m:ss)" then spoken lines, plus [B-ROLL: what's on screen] where it helps. Each chapter except the last ends with a one-line pull forward.
## END — the takeaway in ≤ 2 sentences, then the single ask (subscribe/comment/link).
## DESCRIPTION — 2–3 sentence video description, then a "CHAPTERS:" block with the same m:ss markers.
Spoken style: second person, short sentences, no written-style connectives ("furthermore"). Never invent numbers, product names or claims about the creator — [ADD: your actual figure] where the script needs one.`,
    buildUser: (v) =>
      `TITLE: ${String(v.title || "")}\n\nBEATS / SOURCE MATERIAL:\n${String(v.beats || "")}`,
  },
  {
    id: "tiktok-hooks",
    name: "TikTok Hooks",
    category: "Social",
    tagline: "12 opening lines that survive the first second.",
    description:
      "Generates hooks for a specific video, grouped by mechanism (curiosity gap, bold claim, POV, pattern interrupt, direct address), each with the visual that has to happen in the first frame. Kills the clichés it knows don't work.",
    feature: "chat",
    maxTokens: 1200,
    temperature: 0.95,
    keywords: /\b(tik ?tok|hook|reel hook|shorts hook)\b/i,
    fields: [
      area("video", "What's the video?", { required: true, max: 1500, placeholder: "3-slide teardown of why your landing page loses mobile users at the price row" }),
      sel("audience2", "Who's scrolling", [
        ["customers", "Potential customers"],
        ["creators", "Other creators"],
        ["hiring", "Candidates / hiring"],
        ["general", "General"],
      ], "customers"),
      bool("visuals", "Include a first-frame visual note", true),
    ],
    checks: { variants: [10, 14], maxChars: 3500 },
    buildSystem: (v) =>
      `You are a short-form video hook writer for ${String(v.audience2 || "potential customers")}.
Give exactly 12 hooks in 4 groups headed "## Curiosity gap", "## Bold claim", "## POV / direct address", "## Pattern interrupt" — 3 hooks each.
Each hook: "N. <spoken line ≤ 14 words>"${v.visuals ? " then on the same line \" | first frame: <what's visibly happening>\"" : ""}.
Hooks must be sayable in under 3 seconds and must not promise what the video (per the user) does not deliver. BANNED: "Wait for it", "You won't believe", "Nobody talks about", "Stop doing this", "Watch till the end". No invented stats.`,
    buildUser: (v) => `VIDEO:\n${String(v.video || "")}`,
  },

  /* ══ Marketing ════════════════════════════════════════════ */
  {
    id: "ad-copy",
    name: "Ad Copy Generator",
    category: "Marketing",
    tagline: "Headlines, body and CTA per platform, within limits.",
    description:
      "Writes platform-shaped ad copy (Google RSA-style headlines/descriptions, Meta primary text, LinkedIn) with the real character ceilings respected, each variant anchored to a different benefit, plus what to test first.",
    feature: "chat",
    creditCost: 2,
    maxTokens: 1800,
    temperature: 0.85,
    keywords: /\b(ad copy|google ads|meta ads|facebook ads|advertis)\b/i,
    fields: [
      text("product", "Product / offer", { required: true, max: 400, placeholder: "BUILDWE PRO — one AI workspace, ₹500/mo, no card needed to start" }),
      text("outcome", "Main outcome the buyer wants", { required: true, max: 300, placeholder: "stop paying for 4 AI subscriptions" }),
      text("objection", "Biggest objection", { max: 300, placeholder: "another subscription I'll forget about" }),
      sel("platform", "Platform", [["google", "Google (RSA)"], ["meta", "Meta (feed)"], ["linkedin", "LinkedIn Sponsored"], ["all", "All three"]], "all"),
    ],
    checks: { minWords: 40, mustInclude: ["HEADLINES:"] },
    buildSystem: (v) =>
      `You are a direct-response copywriter. Adhere to real platform limits — count characters.
${/google|all/.test(String(v.platform)) ? `GOOGLE (RSA):
HEADLINES: exactly 8 lines, each ≤ 30 characters, no two starting with the same 3 words.
DESCRIPTIONS: exactly 3 lines, each ≤ 90 characters, each naming a benefit and one an objection-handling line.
` : ""}${/meta|all/.test(String(v.platform)) ? `META:
PRIMARY TEXT: 2 variants, 60–125 words each, first line ≤ 8 words (before the fold), then benefit, then proof, then one ask.
HEADLINE: 3 options ≤ 40 characters. CTA: one of "Learn more", "Sign up", "Get offer".
` : ""}${/linkedin|all/.test(String(v.platform)) ? `LINKEDIN:
INTRO LINE ≤ 140 characters, then 3 benefit bullets ≤ 90 characters each, then a single-sentence ask.
` : ""}
EVERYWHERE: no invented prices, discounts, trials, awards, "award-winning", customer counts or guarantees. Use exactly the offer the user gave; [ADD: …] where a number is needed. Add at the very end "TEST FIRST: <one sentence on which variable to test>".`,
    buildUser: (v) =>
      `OFFER: ${String(v.product || "")}\nOUTCOME: ${String(v.outcome || "")}\nOBJECTION: ${String(v.objection || "not provided")}`,
  },
  {
    id: "product-description",
    name: "Product Description",
    category: "Marketing",
    tagline: "Benefits-first copy with specs, FAQ and schema-ready fields.",
    description:
      "Writes an e-commerce product page: title with keyword, 3 benefit-led paragraphs, feature→benefit table, who it's for / not for, and a short FAQ. Facts come from your spec sheet only, so nothing on the page is unsellable later.",
    feature: "chat",
    creditCost: 2,
    maxTokens: 1800,
    temperature: 0.6,
    keywords: /\b(product description|amazon listing|shopify desc)\b/i,
    fields: [
      text("product2", "Product name", { required: true, max: 150, placeholder: "Meridian 750 insulated steel bottle" }),
      area("specs", "Specs / what it actually is", { required: true, max: 3000, placeholder: "750ml, 18/8 steel, 24h cold / 12h hot, powder coat, leak-test at 1 bar, 420g, made in India" }),
      text("buyer", "Who buys it", { max: 300, placeholder: "commuters and trail walkers who hate plastic taste" }),
      sel("channel", "Channel", [["shopify", "Own store"], ["amazon", "Marketplace (Amazon-style)"], ["flipkart", "Marketplace (Flipkart-style)"]], "shopify"),
    ],
    checks: { minWords: 90, headings: 2 },
    buildSystem: (v) =>
      `You are an e-commerce copywriter writing for a ${String(v.channel || "own store")} listing. ${styleLines(v)}
OUTPUT FORMAT:
# <product title, ≤ 70 characters, includes the main keyword naturally>
2–3 paragraphs (max 70 words each): what it is, then the benefit in the buyer's real situation, then why this one over the obvious alternative.
**Features → benefits** as a list: "«feature» — «what it means for you»". Only features from the spec.
## Who it's for / not for — 2 bullets each (saying who shouldn't buy it is allowed and builds trust).
## FAQ — 3 Q&A pairs of ≤ 35 words, answering questions the spec can actually answer.
Every claim must trace to the provided spec. Price, stock, delivery windows, warranty terms and certifications not in the spec must be [ADD: …]. No "premium quality", "crafted with love", "elevate your", or unverifiable hype adjectives.`,
    buildUser: (v) =>
      `PRODUCT: ${String(v.product2 || "")}\nSPEC:\n${String(v.specs || "")}\nBUYER: ${String(v.buyer || "not provided")}`,
  },
  {
    id: "slogan",
    name: "Slogan & Brand Name",
    category: "Marketing",
    tagline: "Names and taglines with the reasoning and a risk note.",
    description:
      "Generates brand names and taglines in batches by naming strategy (evocative, coined, founder, descriptor), with pronunciation, a one-line rationale, and the obvious legal/translation risk flagged. Not a trademark clearance — a thinking tool.",
    feature: "chat",
    maxTokens: 1400,
    temperature: 0.95,
    keywords: /\b(slogan|brand name|name for|tagline|naming)\b/i,
    fields: [
      text("what", "What is the brand/product?", { required: true, max: 500, placeholder: "Repair-café marketplace for small Indian cities; booking + parts + pickup" }),
      sel("type", "Naming strategy", [["evocative", "Evocative"], ["coined", "Coined word"], ["compound", "Two real words"], ["descriptor", "Plain descriptor"]], "coined"),
      num("count", "Options", 5, 20, 12),
      text("avoid", "Avoid these roots/words", { max: 200, placeholder: "go, karo, fixy, -ly" }),
    ],
    checks: { variants: [4, 22] },
    buildSystem: (v) =>
      `You are a brand namer using a ${String(v.type || "coined")} strategy.
Give exactly ${Number(v.count) || 12} options, one per line: "<name> — <tagline ≤ 7 words> | <rationale ≤ 10 words> | <risk>".
Risk = the first thing that could bite (hard to spell, reads like another brand, bad meaning in a language, too generic to register). Say it plainly.
${v.avoid ? `Do not use these roots: ${String(v.avoid)}.` : ""}
Names must be ≤ 12 characters, pronounceable in Indian English, and not a real existing company you can name. Never claim availability: add " — availability unverified" at the end of the list as a single final line.`,
    buildUser: (v) => `BRAND:\n${String(v.what || "")}`,
  },
  {
    id: "press-release",
    name: "Press Release",
    category: "Marketing",
    tagline: "Dateline, quote slots, boilerplate — AP style.",
    description:
      "Writes a release a journalist can use: headline and subhead, a datelined lede that states the news, two quote slots (with speaker left blank for you to fill), a context paragraph, the boilerplate, and the media contact line.",
    feature: "chat",
    creditCost: 2,
    maxTokens: 1400,
    temperature: 0.45,
    keywords: /\b(press release|announcement pr|media release)\b/i,
    fields: [
      text("news2", "The news", { required: true, max: 600, placeholder: "BUILDWE opens its repair-network pilot to 12 cities, 40 self-help repair cafés, funding from a Karnataka govt MSME grant" }),
      area("facts", "Numbers, dates, places, who", { max: 3000, placeholder: "pilot starts 15 Sept, 12 cities list…, 40 cafés, grant ₹18L" }),
      text("company", "Company boilerplate (about us)", { max: 800, placeholder: "BUILDWE is an AI workspace company based in Kota, Rajasthan." }),
      text("contact", "Media contact", { max: 200, placeholder: "press@buildwe.online" }),
    ],
    checks: { minWords: 120, mustInclude: ["###", "ABOUT", "MEDIA CONTACT"] },
    buildSystem: (v) =>
      `You are a PR writer following AP style.
OUTPUT FORMAT:
FOR IMMEDIATE RELEASE
# <headline ≤ 90 characters, verb-driven>
## <subhead ≤ 130 characters adding the "so what">
CITY, Country — <month day, year>: <lede: who did what, the scale, and why it matters, ≤ 45 words>
Then 2 body paragraphs of specifics.
Then exactly two quote paragraphs: "[QUOTE 1 — <role>: what they'd actually say]" and "[QUOTE 2 — <customer/partner role>: …]" — leave them as brackets, don't ghostwrite attributed quotes.
Then "###" heading line, then:
ABOUT: <company boilerplate>
MEDIA CONTACT: <contact>
Only the facts the user gave; every missing fact is [ADD: …]. No "revolutionary", "leading provider", "poised to", or "in today's fast-paced world". End with "###".`,
    buildUser: (v) =>
      `NEWS: ${String(v.news2 || "")}\nFACTS:\n${String(v.facts || "none provided")}\nBOILERPLATE: ${String(v.company || "[ADD: one-sentence company boilerplate]")}\nCONTACT: ${String(v.contact || "[ADD: media contact]")}`,
  },
  {
    id: "seo-meta",
    name: "SEO Title & Meta",
    category: "Marketing",
    tagline: "Title, description and slug that fit real SERP widths.",
    description:
      "Writes three title options, three meta descriptions and a slug for a page, sized to real pixel-width limits rather than raw character counts, with the keyword placed in the parts that get indexed. Includes what to check on-page.",
    feature: "chat",
    maxTokens: 900,
    temperature: 0.5,
    keywords: /\b(seo|meta description|title tag|slug)\b/i,
    fields: [
      text("page", "What's the page about?", { required: true, max: 1200, placeholder: "Guide to Razorpay + Stripe webhooks for a Next.js subscription app" }),
      text("kw", "Target keyword", { required: true, max: 120, placeholder: "razorpay webhook next.js" }),
      text("brand", "Brand to append", { max: 80, placeholder: "BUILDWE" }),
    ],
    checks: { minWords: 40, mustInclude: ["TITLES:", "DESCRIPTIONS:", "SLUG:"] },
    buildSystem: (v) =>
      `You are a technical SEO writer. Pixel widths matter more than character counts: title ≤ 580px (≈55 chars), description ≤ 920px (≈155 chars).
OUTPUT FORMAT, exactly:
TITLES:
1. <title> (<n> chars) — 3 options, keyword in the first half${v.brand ? `, suffix " | ${String(v.brand)}"` : ""}
DESCRIPTIONS:
1. <description> (<n> chars) — 3 options; each states the payoff and contains a verb; no keyword stuffing
SLUG:
/<kebab-case, ≤ 5 words, keyword first>
CHECK ON PAGE:
- <3 bullets: what the H1, first paragraph and heading structure must then do for this query>
Report accurate character counts — if you miscount, the check fails. No clickbait, no invented numbers or years.`,
    buildUser: (v) => `PAGE: ${String(v.page || "")}\nKEYWORD: ${String(v.kw || "")}`,
  },
  {
    id: "brand-voice",
    name: "Brand Voice Generator",
    category: "Marketing",
    tagline: "Derives a voice profile, then saves it as your instructions.",
    description:
      "Reads samples of how you already write and produces a reusable brand voice: register, sentence rhythm, vocabulary to use and avoid, formatting habits, and 3 do/don't examples. One click saves it into your workspace skills so chat and every other tool pick it up.",
    feature: "chat",
    maxTokens: 1400,
    temperature: 0.4,
    keywords: /\b(brand voice|tone of voice|writing style guide)\b/i,
    fields: [
      area("samples", "Paste 2–5 examples of your writing", {
        required: true,
        max: 6000,
        placeholder: "Paste real emails, posts or product copy — the more varied, the better the profile.",
        help: "Only your own text. Don't paste confidential customer messages.",
      }),
      text("not3", "What should we never sound like?", { max: 200, placeholder: "corporate, apologetic, salesy" }),
    ],
    afterRun: "save-brand-voice",
    checks: { headings: 3, minWords: 80 },
    buildSystem: (v) =>
      `You derive a brand voice profile from real writing samples. Only describe what is observable in the samples; never flatter.
OUTPUT FORMAT:
## Voice in one line
## Register & rhythm (sentence length, formality, directness)
## Vocabulary: always use (5–8 words/phrases) / never use (5–8)
## Formatting habits (lists vs prose, emoji, headings, links, numbers)
## Do / Don't — one short example pair per rule, at most 3 pairs
${v.not3 ? `The user explicitly does not want to sound like: ${String(v.not3)}.` : ""}
Then a final line "BRAND VOICE: <one tight paragraph, ≤ 60 words, that can be pasted into any AI prompt as the voice instruction>".
Quote the samples when you make a claim about the voice (e.g. "avg sentence 9 words — 'We shipped. It broke. It ships.'").`,
    buildUser: (v) => `SAMPLES:\n${String(v.samples || "")}`,
  },

  /* ══ Business ═════════════════════════════════════════════ */
  {
    id: "email-writer",
    name: "Email Writer",
    category: "Business",
    tagline: "Subject lines that survive the preview pane.",
    description:
      "Writes the email with the ask in the first two lines, plus 3 subject-line options and a shorter follow-up variant you can send in three days. Types: cold, follow-up, sales, newsletter, apology, thank-you, request, decline.",
    feature: "chat",
    maxTokens: 1000,
    temperature: 0.6,
    keywords: /\b(email|mail to|write to my|follow up)\b/i,
    fields: [
      sel("kind2", "Email type", [
        ["cold", "Cold outreach"],
        ["followup", "Follow-up (no reply yet)"],
        ["sales", "Proposal / sales"],
        ["newsletter", "Newsletter"],
        ["apology", "Apology / delay"],
        ["thanks", "Thank-you"],
        ["ask", "Internal request"],
        ["decline", "Saying no"],
      ], "cold"),
      area("situation", "Situation in plain words", { required: true, max: 3000, placeholder: "They run a 20-person D2C brand; we fixed their returns page in a week; want a 20-min call" }),
      text("ask2", "The one ask", { required: true, max: 250, placeholder: "20 minutes next week — Tue or Thu" }),
      text("sign", "Your name / signature line", { max: 150, placeholder: "Meena, BUILDWE" }),
      bool("casual", "Keep it informal", false),
    ],
    checks: { minWords: 40, maxChars: 5000, mustInclude: ["SUBJECT:", "EMAIL:"] },
    buildSystem: (v) =>
      `You write a ${String(v.kind2 || "cold")} email. ${v.casual ? "Register: informal, contractions fine." : "Register: professional, no slang."}
OUTPUT FORMAT, exactly:
SUBJECT:
1. <≤ 45 characters> — 3 options; specific over clever; no "Quick question?", no "Touching base", no fake "Re:"
EMAIL:
<greeting line>, <body>. Openers: for cold${" "}state why them, in one line, then the ask; for follow-up: no guilt, one new piece of value; for apology: name the impact and the fix, no "unforeseen circumstances"; for decline: warm, firm, no false hope. Body ≤ 130 words, ≤ 5 sentences per paragraph. One ask, with a concrete time option${v.sign ? `, closing with ${String(v.sign)}` : ""}.
FOLLOW-UP (if no reply):
<a ≤ 45 word nudge adding something new, not "just bumping this">
Never invent names, dates, prices, deadlines, or prior conversations. [ADD: …] for anything needed but missing.`,
    buildUser: (v) =>
      `SITUATION: ${String(v.situation || "")}\nASK: ${String(v.ask2 || "")}`,
  },
  {
    id: "proposal",
    name: "Project Proposal",
    category: "Business",
    tagline: "Scope, deliverables, timeline, what voids the quote.",
    description:
      "Drafts a short proposal a client can sign: problem, approach, deliverables in and out of scope, milestones with weeks, what could change the price, payment terms with blanks for your numbers, and the assumptions both sides are accepting.",
    feature: "chat",
    creditCost: 2,
    maxTokens: 2048,
    temperature: 0.45,
    keywords: /\b(proposal\b|scope of work|sow|quote for)\b/i,
    fields: [
      text("client", "Client / who's reading", { required: true, max: 200, placeholder: "Head of Ops, 60-person logistics company" }),
      area("work", "The work being proposed", { required: true, max: 4000, placeholder: "Replace their WhatsApp-based driver check-in with a web app + OTP + offline queue" }),
      text("timeline", "Realistic timeline", { max: 200, placeholder: "7 weeks" }),
      text("budget", "Budget (leave blank to keep as [ADD])", { max: 200, placeholder: "" }),
    ],
    checks: { headings: 4, minWords: 200 },
    buildSystem: (v) =>
      `You write freelance/agency project proposals that don't create arguments later.
OUTPUT FORMAT:
# Proposal: <project name>
## 1. Problem as we understand it — 3–5 sentences, in the client's words, no flattery
## 2. Approach — short prose + a list of what we build vs what we use
## 3. Deliverables — bulleted, each verifiable ("an endpoint that returns X", not "improved performance")
## 4. Not included — at least 4 explicit exclusions (a real proposal states these)
## 5. Milestones — table: "Week n — <milestone> — <what you get in hand>"
## 6. What can change the estimate — 3–5 named risks with what triggers each
## 7. Terms — payment stages, review rounds included, response-time assumption, validity of the quote. Put [ADD: your amount] where a number is yours to set
## 8. Assumptions — bulleted; each an access/decision/dependency the client must confirm
Tone: plain, confident, no "synergy", no "bespoke solutions". Timeline reference: ${String(v.timeline || "[ADD: timeline]")}. Budget: ${v.budget ? String(v.budget) : "[ADD: total + per-milestone split]"}. Never promise a date you can't see in the input.`,
    buildUser: (v) => `CLIENT: ${String(v.client || "")}\nWORK:\n${String(v.work || "")}`,
  },

  /* ══ Career ════════════════════════════════════════════════ */
  {
    id: "cover-letter",
    name: "Cover Letter",
    category: "Career",
    tagline: "Evidence-led letter, no 'I am passionate'.",
    description:
      "Writes a cover letter that maps two or three of your real achievements to what this role needs, with the number attached and the sentence-level filler removed. Short enough that a recruiter finishes it.",
    feature: "chat",
    maxTokens: 900,
    temperature: 0.55,
    keywords: /\b(cover letter|apply for this job)\b/i,
    fields: [
      area("job", "Role + company + what the posting asks for", { required: true, max: 2500, placeholder: "Senior Frontend @ Zeta — React, design systems, perf budgets, mentors 2 devs" }),
      area("me", "Your relevant experience & wins", { required: true, max: 3000, placeholder: "4 yrs, cut LCP 2.1s→0.9s, built the component lib used by 6 squads…" }),
      text("why", "Why this company (be honest)", { max: 400, placeholder: "I've used their docs at 2am; their engineering blog is the reason I do perf work" }),
    ],
    checks: { minWords: 120, maxChars: 4000 },
    buildSystem: (v) =>
      `You write cover letters that get read to the end (180–280 words).
Structure: greeting → line stating the role and the single most relevant fact about me → 1–2 short paragraphs each pairing one requirement from the posting with one specific achievement (with its number) → a closing sentence with availability/next step → sign-off.
RULES: no "I am writing to express my interest", "passionate about", "team player", "fast-paced environment", "believe I am a strong candidate"; no restating the CV in list form; no invented employers, dates, titles or metrics — if the input has no number for a claim, drop the claim. Use the company's own words for the role title.`,
    buildUser: (v) =>
      `POSTING / ROLE: ${String(v.job || "")}\nMY BACKGROUND:\n${String(v.me || "")}\nWHY THEM: ${String(v.why || "not provided")}`,
  },
  {
    id: "resume-summary",
    name: "Resume Summary",
    category: "Career",
    tagline: "A 3-line profile and 5 rewritten bullets, quantified.",
    description:
      "Turns a raw experience dump into a resume profile plus achievement bullets in the " +
      "action-verb + scope + measured-result" +
      " form. Anything unquantified gets flagged so you go find the number instead of smuggling in a claim.",
    feature: "chat",
    maxTokens: 1000,
    temperature: 0.4,
    keywords: /\b(resume|cv\b|profile summary)\b/i,
    fields: [
      area("exp", "Your experience (paste raw)", { required: true, max: 6000, placeholder: "Led payments team of 5 at Kota Finserv 2021-24, moved UPI retries to a queue, cut failures 4.1%→1.2%" }),
      text("target", "Target role / industry", { max: 200, placeholder: "Staff Engineer, payments or infra" }),
      bool("ats", "Optimise wording for ATS keyword matching", true),
    ],
    checks: { minWords: 45, mustInclude: ["PROFILE:", "BULLETS:"] },
    buildSystem: (v) =>
      `You are a resume writer for a target role: ${String(v.target || "not specified")}.
OUTPUT FORMAT, exactly:
PROFILE:
<3 lines max, ≤ 55 words total: role + years + specialism, then the strongest quantified win, then what they're looking for>
BULLETS:
<5–8 bullets, one per line, each "<past-tense action verb> <what, with scope> — <measured result>". Start with the verb, no personal pronouns, no "Responsible for">
MISSING NUMBERS:
<list each bullet where a number should be and isn't, as "bullet n: <what to measure>" — or "None">
${v.ats ? "Mirror the vocabulary of the target role where it's genuinely true of the experience; never insert keywords that aren't supported." : ""}
Do not invent metrics, employers, dates, titles or technologies. If a result can't be quantified from the input, keep the bullet factual and list it under MISSING NUMBERS.`,
    buildUser: (v) => `EXPERIENCE:\n${String(v.exp || "")}`,
  },
  {
    id: "interview-prep",
    name: "Interview Prep",
    category: "Career",
    tagline: "Likely questions, scored answers, and what to ask them.",
    description:
      "Predicts the questions this specific role will actually ask, drafts STAR answers from your experience, grades each answer against what interviewers listen for, and gives you five questions worth asking at the end.",
    feature: "chat",
    creditCost: 2,
    maxTokens: 2600,
    temperature: 0.5,
    keywords: /\b(interview|prep for round|hr round)\b/i,
    fields: [
      text("role", "Role, level, company type", { required: true, max: 300, placeholder: "Backend, L4, product company doing fintech in India" }),
      area("jd", "The job description / what you know about the loop", { max: 4000, placeholder: "Round 2 system design, round 3 with VP eng, they care about payments idempotency" }),
      area("me2", "What you've done (for STAR answers)", { max: 4000, placeholder: "paste your projects with results" }),
      num("count", "How many questions", 4, 15, 8),
    ],
    checks: { headings: 3, minWords: 150 },
    buildSystem: (v) =>
      `You are an interview coach for a ${String(v.role || "")} candidate.
OUTPUT FORMAT:
## The ${Number(v.count) || 8} questions they'll actually ask
For each: "### Q<n>. <question>" then "What they're really testing: <one line>" then "Strong answer shape: <3 beats>" then "Trap: <the thing that fails>".
## STAR drafts
Up to 4 stories built ONLY from the candidate's stated experience, in Situation/Task/Action/Result lines, ≤ 70 words each, results as they were given.
## Questions for them
5 questions that reveal the real team (not "what's the culture like"), with one line on what a good vs bad answer sounds like.
Never invent experience. If a needed number or outcome isn't in the input, write [ADD: your figure].`,
    buildUser: (v) =>
      `ROLE: ${String(v.role || "")}\nLOOP / JD:\n${String(v.jd || "not provided")}\nMY EXPERIENCE:\n${String(v.me2 || "not provided")}`,
  },

  /* ══ Docs ═════════════════════════════════════════════════ */
  {
    id: "summarizer",
    name: "Content Summarizer",
    category: "Docs",
    tagline: "TL;DR, key points, what it does not say.",
    description:
      "Summarises any text at the length you choose, and separately lists what the document avoids or leaves unresolved — the part normal summarisers skip, which is where bad decisions live. Quotes are verbatim with a marker.",
    feature: "chat",
    maxTokens: 1200,
    temperature: 0.25,
    keywords: /\b(summari[sz]e|tl;?dr\b|key points|condense)\b/i,
    fields: [
      area("doc", "Text to summarise", { required: true, max: 20000, placeholder: "Paste the article, report, policy or transcript." }),
      sel("style", "Shape", [
        ["tldr", "TL;DR — 3 sentences"],
        ["bullets", "6–10 key points"],
        ["exec", "Executive summary — 1 paragraph"],
        ["sections", "Section by section"],
        ["eli5", "Explain like I'm five"],
      ], "bullets"),
      bool("gaps", "Also list what's missing / unresolved", true),
    ],
    checks: { minWords: 20 },
    buildSystem: (v) =>
      `You summarise without editorialising. Rules: only content present in the text; keep every number, name and date exact; never attribute opinions the text doesn't state; if the text is truncated or you can't see the end, say so at the top.
FORMAT by requested style "${String(v.style || "bullets")}":
tldr → exactly 3 sentences, no heading.
bullets → 6–10 lines starting "- ", ordered by importance not by appearance.
exec → one 90–140 word paragraph.
sections → "## <section name>" then ≤ 3 bullets each, in document order.
eli5 → 5 short sentences, no jargon.
${v.gaps ? 'Append "## Not covered" with 2–5 bullets of questions a reader would still have, or "Nothing material is unresolved."' : ""}
Direct quotes, if any, in "quotes" with the source phrase unchanged.`,
    buildUser: (v) => `TEXT:\n${String(v.doc || "")}`,
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes → Actions",
    category: "Docs",
    tagline: "Decisions, owners, deadlines — and the open loops.",
    description:
      "Turns messy notes or a transcript into minutes: what was decided, what wasn't, who owns each action with its date, plus the unresolved disagreements so they don't get lost. Short enough to paste in the chat.",
    feature: "chat",
    maxTokens: 1200,
    temperature: 0.2,
    keywords: /\b(meeting notes|minutes of|action items|standup)\b/i,
    fields: [
      area("raw", "Raw notes / transcript", { required: true, max: 15000, placeholder: "Paste anything — unformatted, Hindi/English mix is fine." }),
      text("when", "Date & meeting name", { max: 150, placeholder: "2026-08-30 — weekly product sync" }),
    ],
    checks: { headings: 3, minWords: 30 },
    buildSystem: (v) =>
      `You turn raw meeting notes into minutes. Do not fill gaps: if an owner, date or figure wasn't said, write "?" — that's more useful than a guess.
OUTPUT FORMAT:
# <meeting name> — <date>
## Decisions
- <decision> (agreed / assumed — say which)
## Actions
- [ ] <task> — owner: <name or ?> — due: <date or ?>
## Open questions
- <question> — <who can answer>
## Blocked / disputed
- <what two things are in tension> (only if present in the notes; else write "None")
Keep it under 250 words unless the notes genuinely need more. Names only as they appear in the notes. No summary of what was already obvious, no "the meeting was productive".`,
    buildUser: (v) => `MEETING: ${String(v.when || "not provided")}\n\nNOTES:\n${String(v.raw || "")}`,
  },
  {
    id: "fact-check",
    name: "Hallucination Check",
    category: "Docs",
    tagline: "Pulls out checkable claims and looks for live sources.",
    description:
      "Scans an AI answer (or your own draft) for statistics, dates, prices and superlatives, then searches the live web for corroboration. Every claim comes back as corroborated or unconfirmed — never as a fake confidence score. Use it before you send anything that could embarrass you.",
    feature: "chat",
    maxTokens: 1,
    temperature: 0,
    engine: "verify",
    keywords: /\b(fact.?check|hallucinat|verify this|is this true)\b/i,
    fields: [
      area("answer", "Answer to check", {
        required: true,
        max: 8000,
        placeholder: "Paste the AI answer or draft. I'll extract the checkable claims and look for live corroboration.",
      }),
    ],
    checks: { minWords: 4 },
    buildSystem: () => "",
    buildUser: (v) => String(v.answer || ""),
  },

  /* ══ Dev ══════════════════════════════════════════════════ */
  {
    id: "code-translator",
    name: "Code Translator",
    category: "Dev",
    tagline: "Faithful port, with the idioms that change.",
    description:
      "Ports code between languages with the target language's idioms, not a line-by-line transliteration. Lists what changes semantically (ownership, error handling, concurrency) and what you must re-test. Compiles-only-if-true: uncertain behaviour is flagged, not hidden.",
    feature: "code",
    creditCost: 2,
    maxTokens: 4096,
    temperature: 0.2,
    keywords: /\b(translate (this )?code|port (this|to)|convert .* to (rust|go|python|ts))/i,
    fields: [
      area("code", "Source code", { required: true, max: 12000, placeholder: "function debounce(fn, ms) { … }" }),
      text("from", "From", { max: 60, placeholder: "JavaScript" }),
      text("to", "To", { required: true, max: 60, placeholder: "Rust" }),
      bool("tests", "Also write a test proving equivalence", true),
    ],
    checks: { codeBlock: true, minWords: 20 },
    buildSystem: (v) =>
      `You port code from ${String(v.from || "the source language")} to ${String(v.to || "the target language")}.
OUTPUT FORMAT:
### ${String(v.to || "Target")}
\`\`\`${String(v.to || "").toLowerCase().replace(/[^a-z0-9+#]/g, "") || "text"}
<the ported code, idiomatic, compiling, with comments only where behaviour differs from the original>
\`\`\`
## What changed and why
- <5 bullets max: the semantic decisions — error handling, ownership, nullability, concurrency, string encoding>
## Re-test before trusting it
- <3–6 bullets: concrete cases that differ; say what to assert>
${v.tests ? `## Equivalence test\n\`\`\`${String(v.to || "").toLowerCase().replace(/[^a-z0-9+#]/g, "")}\n<one test per behaviour listed above>\n\`\`\`\n` : ""}
Rules: no library swaps unless the target genuinely needs one; keep public function names and argument order unless the language convention forbids it; if the source has a bug, port it and point it out above; never silently drop a branch.`,
    buildUser: (v) => `SOURCE:\n${String(v.code || "")}`,
  },
  {
    id: "code-explain",
    name: "Code Explainer",
    category: "Dev",
    tagline: "What it does, where it bites, how it fails.",
    description:
      "Explains unfamiliar code at the level you ask for: what it's for, the flow, the non-obvious parts, and the specific inputs where it breaks. Answers questions about the code only — it won't invent intent the code doesn't show.",
    feature: "code",
    maxTokens: 1800,
    temperature: 0.2,
    keywords: /\b(explain (this|the) code|what does this (code|function) do)\b/i,
    fields: [
      area("code2", "Code", { required: true, max: 12000, placeholder: "paste the function or file" }),
      sel("level", "Explain to", [["junior", "A junior dev"], ["me", "Me — I know the language"], ["pm", "A non-engineer"]], "me"),
      text("focus", "Specific question (optional)", { max: 300, placeholder: "why is the retry inside the lock?" }),
    ],
    checks: { minWords: 40 },
    buildSystem: (v) =>
      `You explain code to ${String(v.level === "pm" ? "a non-engineer, with one analogy max and no syntax terms" : v.level === "junior" ? "a junior developer — define any term you must use" : "an experienced developer — skip basics")}.\nOUTPUT FORMAT:\n**In one line:** <what this code accomplishes>\n**How it runs:** 3–7 numbered steps, each naming the function/line it happens in.\n**Non-obvious:** <up to 3 bullets — the clever/fragile parts, e.g. ordering, mutation, hidden coupling>\n**Where it breaks:** <2–4 concrete inputs or states that produce wrong output, exceptions or a leak>\n${v.focus ? `Answer this first, then the structure: "${String(v.focus)}"` : ""}\nSay only what the code shows. If intent is ambiguous, write "can't tell from this snippet — need <what>". Never invent a caller, a spec, or a bug you can't point at.` +
        (v.level ? "\n" + styleLines(v) : ""),
    buildUser: (v) => `CODE:\n${String(v.code2 || "")}`,
  },
  {
    id: "unit-tests",
    name: "Unit Test Generator",
    category: "Dev",
    tagline: "Behaviour-first tests, edge cases included.",
    description:
      "Writes runnable tests for a function or class: happy path, boundaries, error cases, and property-style checks where they pay. Uses the project's framework when you say which one, and states which assertions are guesses.",
    feature: "code",
    creditCost: 2,
    maxTokens: 3000,
    temperature: 0.2,
    keywords: /\b(unit test|write tests|vitest|jest|pytest)\b/i,
    fields: [
      area("code3", "Code under test", { required: true, max: 10000, placeholder: "the function/class/module" }),
      sel("fw", "Framework", [
        ["vitest", "Vitest"],
        ["jest", "Jest"],
        ["node", "node:test"],
        ["pytest", "pytest"],
        ["gotest", "Go testing"],
        ["junit", "JUnit 5"],
      ], "vitest"),
      bool("mock", "Mock external I/O", true),
      text("names", "Import path / module name", { max: 200, placeholder: "@/lib/pricing" }),
    ],
    checks: { codeBlock: true, minWords: 20 },
    buildSystem: (v) =>
      `You write tests that would catch a real regression${v.names ? ` for ${String(v.names)}` : ""}, using ${String(v.fw || "vitest")} with its conventional file layout.
OUTPUT FORMAT:
### <framework> tests
\`\`\`<correct extension for the framework>
<complete, runnable test file: imports, describe/test blocks, assertions — no pseudo-code, no TODOs in place of assertions>
\`\`\`
## What each test proves
- "<test name>" → <the exact behaviour, and the bug it would catch>
## Not covered / guesses
- <2–4 bullets: behaviour you inferred from the signature or names and could be wrong about, and what to confirm>
${v.mock ? "Mock the network/db/filesystem boundary; do not mock the unit under test." : "Write against real inputs; note in a comment if a test needs isolation."}
Test observable behaviour, not implementation details. Don't assert the number of calls unless call count is the contract.`,
    buildUser: (v) => `CODE UNDER TEST:\n${String(v.code3 || "")}`,
  },
  {
    id: "commit-message",
    name: "Commit Message",
    category: "Dev",
    tagline: "Conventional commits from your actual diff.",
    description:
      "Reads a diff and writes a conventional commit (or a split plan if the diff is doing two things), with a body that explains the why. No restating filenames the reader can already see.",
    feature: "code",
    maxTokens: 700,
    temperature: 0.25,
    keywords: /\b(commit message|conventional commit|git message)\b/i,
    fields: [
      area("diff", "Diff or summary of changes", { required: true, max: 12000, placeholder: "git diff --staged output, or describe the change" }),
      sel("scope", "Convention", [["c9", "Conventional Commits"], ["git", "Plain git (50/72)"], ["emo", "Emoji + conventional"]], "c9"),
      bool("split", "Suggest splitting if the diff is mixed", true),
    ],
    checks: { minWords: 6 },
    buildSystem: (v) =>
      `You write commit messages from diffs.
${v.scope === "c9" ? "FORMAT: `<type>(<optional scope>): <imperative subject ≤ 50 chars>` then a blank line, then a body of ≤ 4 wrapped lines explaining WHY, then refs/co-authored-by only if present in the input." : v.scope === "emo" ? "FORMAT: `<emoji> <type>: <subject ≤ 50>` + body, emoji from the gitmoji list, one only." : "FORMAT: subject ≤ 50 chars in imperative, blank line, body wrapped at 72 explaining why and any risk."}
RULES: subject never ends with a period, never says "updated code", "fix bug", "changes", "wip"; never lists files that are visible in the diff stat; type must match the real change (fix = behaviour was wrong, feat = new capability, refactor = no behaviour change, perf, test, docs, chore, build, ci).${v.split ? "\nIf the diff contains unrelated changes, first line must be `SPLIT RECOMMENDED:` followed by how to split into N commits, then give the message for the first commit only." : ""}
Output the message in a fenced code block, nothing else.` + (v.split ? "" : ""),
    buildUser: (v) => `DIFF / CHANGES:\n${String(v.diff || "")}`,
  },
];

/* ── persona studios (Wave 1: curated tool bundles) ──────── */

export type Studio = {
  slug: string;
  name: string;
  line: string;
  /** tool ids, in the order the studio shows them */
  tools: string[];
};

/**
 * 1min.ai runs "Studio" pages per persona. Ours are honest: each studio is a
 * curated bundle of real tools from the registry, with a shared instruction that
 * the runner appends. Nothing here claims a capability that doesn't exist.
 */
export const STUDIOS: Studio[] = [
  {
    slug: "founder",
    name: "Founder Studio",
    line: "Announce, sell and raise without hiring a copywriter.",
    tools: ["linkedin-post", "x-thread", "press-release", "email-writer", "ad-copy", "slogan", "brand-voice"],
  },
  {
    slug: "marketer",
    name: "Marketer Studio",
    line: "Campaign copy, SEO and reporting in one place.",
    tools: ["blog-post", "ad-copy", "seo-meta", "product-description", "email-writer", "instagram-caption", "tiktok-hooks", "summarizer"],
  },
  {
    slug: "student",
    name: "Student Studio",
    line: "Understand it, then write it yourself.",
    tools: ["summarizer", "essay-writer", "paraphraser", "grammar-checker", "fact-check", "code-explain"],
  },
  {
    slug: "teacher",
    name: "Teacher Studio",
    line: "Explanations, worksheets and parent emails that don't eat your evening.",
    tools: ["article-writer", "summarizer", "email-writer", "grammar-checker", "blog-post"],
  },
  {
    slug: "developer",
    name: "Developer Studio",
    line: "Ship, explain, document, test.",
    tools: ["code-explain", "code-translator", "unit-tests", "commit-message", "blog-post", "proposal"],
  },
  {
    slug: "agency",
    name: "Agency Studio",
    line: "Proposals, brand voice and client comms at margin.",
    tools: ["proposal", "brand-voice", "email-writer", "press-release", "ad-copy", "slogan", "meeting-notes"],
  },
  {
    slug: "executive",
    name: "Executive Studio",
    line: "Read the long thing, write the short thing.",
    tools: ["summarizer", "meeting-notes", "email-writer", "article-writer", "fact-check", "interview-prep"],
  },
];

/* ── lookups ─────────────────────────────────────────────── */

export function findTool(idOrSlug: string): ToolSpec | undefined {
  const key = String(idOrSlug || "").trim().toLowerCase();
  return TOOLS.find((t) => t.id === key);
}

export function toolsByCategory(): { category: string; tools: ToolSpec[] }[] {
  const order = ["Writing", "Social", "Marketing", "Business", "Career", "Docs", "Dev"];
  return order
    .map((category) => ({ category, tools: TOOLS.filter((t) => t.category === category) }))
    .filter((g) => g.tools.length > 0);
}

export function findStudio(slug: string): Studio | undefined {
  return STUDIOS.find((s) => s.slug === String(slug || "").trim().toLowerCase());
}
