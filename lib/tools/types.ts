/**
 * Tool framework types (Wave 1).
 *
 * A tool is DATA + two prompt builders. Nothing about a tool is hardcoded in
 * the UI: the form, the validation, the enforcement contract and the API all
 * come from the same spec, so a tool cannot exist in the menu but be fake
 * behind the counter (which is exactly what the audit found in the marketing
 * pages this replaces).
 *
 * Two halves, deliberately:
 *  • `ToolSpec`   — server-only. Contains the prompt builders. NEVER sent to
 *                   the browser: if it were, a client could rewrite the system
 *                   prompt and the runner would obey it.
 *  • `PublicTool` — what `/api/tools/[id]` returns. Plain JSON: fields,
 *                   limits, checks. The browser renders a form from it.
 */

export type ToolFieldKind = "text" | "textarea" | "select" | "number" | "checkbox";

export type ToolField = {
  key: string;
  label: string;
  kind: ToolFieldKind;
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** max characters accepted for a text/textarea (hard, server-enforced) */
  max?: number;
  /** select only */
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  min?: number;
  max_value?: number;
};

/**
 * Output contract the runner enforces for real.
 *
 * `qualityGate` (lib/ai/quality.ts) is generic; these are the per-tool rules
 * that make "it wrote me a blog post" a verifiable claim instead of a vibe.
 * A failing check triggers exactly one corrective regeneration, and the final
 * verdict is shown to the user — never silently swallowed.
 */
export type ToolChecks = {
  minWords?: number;
  maxWords?: number;
  /** hard character ceiling (tweets/captions) */
  maxChars?: number;
  /** minimum number of `##`/`###` headings */
  headings?: number;
  /** minimum bullet/numbered list items */
  bullets?: number;
  /** these strings must appear (case-insensitive) */
  mustInclude?: string[];
  /** the answer must NOT contain any of these (case-insensitive) */
  mustNotInclude?: string[];
  /** expected number of top-level variants, e.g. 10 headline options */
  variants?: [min: number, max: number];
  /** must be one block of fenced code */
  codeBlock?: boolean;
};

export type ToolResolution = {
  ok: true;
  values: Record<string, string | number | boolean>;
  notes: string[];
} | { ok: false; error: string; fields?: string[] };

export type ToolSpec = {
  id: string;
  name: string;
  category: ToolCategory;
  tagline: string;
  /** long description for the tool page + SEO */
  description: string;
  /** how this tool is metered — maps onto lib/ai/limits.ts Feature */
  feature: "chat" | "code";
  fields: ToolField[];
  checks?: ToolChecks;
  /** sampling budget; long-form tools need headroom, hooks do not */
  maxTokens: number;
  temperature: number;
  /** phrasings that should suggest this tool in the composer */
  keywords?: RegExp;
  /**
   * Execution engine. "llm" (default) generates through the model chain.
   * "verify" runs the claim-extractor + live web search (lib/ai/verify) — a
   * real pipeline, not a model call, so it must not be billed or checked like
   * a generation.
   */
  engine?: "llm" | "verify";
  /** extra instruction appended when the user is in a persona studio */
  studioHint?: string;
  /** UI affordance after a successful run (e.g. save the brand voice) */
  afterRun?: "save-brand-voice";
  buildSystem: (v: Values) => string;
  buildUser: (v: Values) => string;
};

export type Values = Record<string, string | number | boolean>;

export type PublicTool = {
  id: string;
  name: string;
  category: ToolCategory;
  tagline: string;
  description: string;
  feature: "chat" | "code";
  fields: ToolField[];
  checks?: ToolChecks;
  afterRun?: "save-brand-voice";
  example: Values;
};

export const TOOL_CATEGORIES = [
  "Writing",
  "Social",
  "Marketing",
  "Business",
  "Career",
  "Docs",
  "Dev",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Everything a tool page needs to render, minus the prompt builders. */
export function publicTool(spec: ToolSpec): PublicTool {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    tagline: spec.tagline,
    description: spec.description,
    feature: spec.feature,
    fields: spec.fields,
    ...(spec.checks ? { checks: spec.checks } : {}),
    ...(spec.afterRun ? { afterRun: spec.afterRun } : {}),
    example: sampleValues(spec),
  };
}

/**
 * Example input, taken from the field placeholders/defaults. Shown in the UI
 * as a one-click "Fill example" and used by the tests. If a field has no
 * placeholder the registry author gets a loud error at import time, because an
 * example-less tool can't be smoke-tested.
 */
function sampleValues(spec: ToolSpec): Values {
  const out: Values = {};
  for (const f of spec.fields) {
    if (f.kind === "checkbox") {
      out[f.key] = f.default === true;
      continue;
    }
    if (f.kind === "select") {
      out[f.key] = String(f.default ?? f.options?.[0]?.value ?? "");
      continue;
    }
    if (f.kind === "number") {
      out[f.key] = Number(f.default ?? f.min ?? 1);
      continue;
    }
    const sample = String(f.placeholder ?? f.default ?? "");
    if (f.required && !sample.trim()) {
      throw new Error(
        `tool "${spec.id}" field "${f.key}" is required but has no example placeholder`
      );
    }
    out[f.key] = sample;
  }
  return out;
}
