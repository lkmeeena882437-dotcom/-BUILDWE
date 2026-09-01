/**
 * BUILDWE command palette — the parts that need no browser.
 *
 * WHY THE LOGIC LIVES HERE
 * ------------------------
 * A palette is a filter over a list plus a keyboard layer, and both halves are easy to get
 * quietly wrong: an item list maintained by hand in the component drifts from the sheets that
 * actually exist (this repo has been bitten by that twice — the theme picker and the model
 * catalogue were each a second copy of something), and a ranking that "feels fine" in review
 * ranks `abcd` above `abc d`. So the rows, the scoring and the caps are pure functions in this
 * file, compiled and run by `npm run test:ui` the same way `lib/client/groupHistory.ts` is.
 * The component is left with rendering and focus.
 *
 * ONE RULE EVERY ROW OBEYS
 * ------------------------
 * A row either calls a handler the page already has or links to a route that already renders.
 * There is no third kind: "coming soon" rows, disabled rows with no reason, and rows that open
 * a second copy of a form are all the same bug wearing different clothes. `kind` is a closed
 * union so `app/page.tsx`'s `onPick` has to cover it — the compiler is the thing that keeps a
 * tenth action from being added without wiring.
 *
 * The tool/studio rows come from `GET /api/tools`, which is the registry's own projection: this
 * file must not import `lib/tools/registry`, or the workspace bundle would carry 31 tool specs
 * (schemas, prompts, examples) to fill a menu.
 */

export type PaletteGroup = "Recent" | "Session" | "Go to" | "Preferences" | "Tools" | "Studios";

/** Closed on purpose: adding a kind means adding a case in the page, not a silent no-op. */
export type PaletteKind = "new" | "stop" | "modal" | "mode" | "theme" | "chat" | "tool" | "studio";

export type PaletteRow = {
  /** Unique across the whole list, and stable while typing — used as the React key. */
  key: string;
  group: PaletteGroup;
  title: string;
  /** Muted second line: what the row will actually do. */
  hint?: string;
  kind: PaletteKind;
  /** The conversation id / mode id / modal key / theme pref / tool id / studio slug. */
  value: string;
  /** Rows that navigate rather than call a handler. */
  href?: string;
};

/** Order the groups appear in while the query is empty. */
export const GROUP_ORDER: PaletteGroup[] = ["Recent", "Session", "Go to", "Preferences", "Tools", "Studios"];

/**
 * The sheets the workspace already owns, in the order the sidebar reaches them. If a sheet is
 * renamed or removed, this list is the thing to edit — and the page's `onPick` still has to
 * recognise the key, so a typo lands in a type error rather than in a dead row.
 */
export const MODAL_TARGETS: { key: string; title: string; hint: string }[] = [
  { key: "creations", title: "Your creations", hint: "Every image, clip and file this account made" },
  { key: "compare", title: "Compare models", hint: "One prompt, every live model side by side" },
  { key: "models", title: "Models", hint: "What this workspace can call right now" },
  { key: "skills", title: "Skills & Mind", hint: "Standing instructions a prompt may carry" },
  { key: "teams", title: "Team workspaces", hint: "Create, join by invite, share a folder" },
  { key: "byok", title: "Your API keys", hint: "Bring your own Groq or OpenRouter key" },
  { key: "plans", title: "Plans & credits", hint: "PRO, top-ups, what your balance covers" },
  { key: "profile", title: "Profile", hint: "The account behind this workspace" },
  { key: "settings", title: "Settings", hint: "Theme, your data, delete this account" },
];

export const THEME_TARGETS: { key: string; title: string; hint: string }[] = [
  { key: "system", title: "Theme: follow the system", hint: "Light in the day, dark at night, no decision to make" },
  { key: "light", title: "Theme: light", hint: "Cream, always" },
  { key: "dark", title: "Theme: dark", hint: "Low light, same layout" },
];

/**
 * Per group, while the query is empty — a launcher, not an index. Per *group* and not in total on
 * purpose: capped globally, the ten "Go to" rows would push every recent chat off the list, which
 * is the one thing a person reaches for a palette for.
 */
export const IDLE_CAP_PER_GROUP = 7;
/** Total, once there is a query — the point of typing is that the list gets shorter. */
export const QUERY_CAP = 12;

export type PaletteMode = { id: string; label: string; blurb?: string };
export type PaletteChat = { id: string; title: string; mode?: string };
export type PaletteTool = { id: string; name: string; tagline?: string; creditCost?: number };
export type PaletteStudio = { slug: string; name: string; line?: string };

export type PaletteSource = {
  modes: PaletteMode[];
  history: PaletteChat[];
  /** The active mode: its row is the one that says "Already the mode you are in". */
  activeMode?: string;
  /** What is running, if anything — the palette can stop either, and says which. */
  running?: "answer" | "agent" | null;
  /** Signed-out accounts get one extra row, because "log in" is the action they need. */
  signedIn?: boolean;
  tools?: PaletteTool[];
  studios?: PaletteStudio[];
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Chat titles come from the first line of the first prompt, so they are long and unpunctuated.
 * Two clauses, then an ellipsis — enough to tell six of them apart.
 */
function clip(s: string, max = 46) {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/[\s,;:]+$/, "")}…`;
}

/** Rows that exist whatever the person is looking at. */
export function buildFixedRows(src: PaletteSource): PaletteRow[] {
  const rows: PaletteRow[] = [
    { key: "new", group: "Session", title: "New chat", hint: "Start a blank conversation in this project", kind: "new", value: "" },
  ];
  // "Stop" on its own would be ambiguous: an answer and an agent run are different aborts with
  // different buttons on screen, and the row names the one that will actually happen.
  if (src.running) {
    const agent = src.running === "agent";
    rows.push({
      key: "stop",
      group: "Session",
      title: agent ? "Stop the agent run" : "Stop this answer",
      hint: agent ? "Cancel the plan; the files it already wrote stay" : "End the stream and keep what arrived",
      kind: "stop",
      value: "",
    });
  }
  for (const m of src.modes) {
    rows.push({
      key: `mode:${m.id}`,
      group: "Go to",
      title: `${m.label} mode`,
      hint: m.blurb || "Switch what the composer sends",
      kind: "mode",
      value: m.id,
    });
  }
  for (const t of MODAL_TARGETS) {
    rows.push({ key: `modal:${t.key}`, group: "Go to", title: t.title, hint: t.hint, kind: "modal", value: t.key });
  }
  for (const t of THEME_TARGETS) {
    rows.push({ key: `theme:${t.key}`, group: "Preferences", title: t.title, hint: t.hint, kind: "theme", value: t.key });
  }
  if (!src.signedIn) {
    rows.push({
      key: "modal:auth",
      group: "Preferences",
      title: "Log in or create an account",
      hint: "History, creations and projects need an account",
      kind: "modal",
      value: "auth",
    });
  }
  return rows;
}

/**
 * Recent first, capped: this is a jump surface, and the sidebar already holds the whole list.
 * `Recent` is its own group rather than rows inside "Go to" precisely so the per-group cap below
 * cannot crowd them out — the first version of this file put them in "Go to", where 14 sheets and
 * modes meant zero chats showed up until you typed.
 */
export function chatRows(history: PaletteChat[]): PaletteRow[] {
  return history.map((h) => ({
    key: `chat:${h.id}`,
    group: "Recent" as const,
    title: clip(h.title || "Untitled chat"),
    hint: h.mode ? `Open · ${h.mode}` : "Open this conversation",
    kind: "chat" as const,
    value: h.id,
  }));
}

/** The registry's public projection, one row per tool. Navigates — the form lives on that page. */
export function toolRows(tools: PaletteTool[] = []): PaletteRow[] {
  return tools.map((t) => ({
    key: `tool:${t.id}`,
    group: "Tools" as const,
    title: t.name,
    hint: [t.tagline, typeof t.creditCost === "number" ? `${t.creditCost} credit${t.creditCost === 1 ? "" : "s"}` : ""]
      .filter(Boolean)
      .join(" · "),
    kind: "tool" as const,
    value: t.id,
    href: `/tools/${t.id}`,
  }));
}

export function studioRows(studios: PaletteStudio[] = []): PaletteRow[] {
  return studios.map((s) => ({
    key: `studio:${s.slug}`,
    group: "Studios" as const,
    title: s.name,
    hint: s.line || "Open the studio",
    kind: "studio" as const,
    value: s.slug,
    href: `/studios/${s.slug}`,
  }));
}

/** Every row the palette may show, in declaration order. */
export function buildRows(src: PaletteSource): PaletteRow[] {
  return [
    ...buildFixedRows(src),
    ...chatRows(src.history),
    ...toolRows(src.tools),
    ...studioRows(src.studios),
  ];
}

/**
 * 0 means "not a match". Otherwise: a title prefix beats a word start, which beats a substring,
 * which beats a hint match — and every query token has to land somewhere, or the row is out.
 * A word start counts on `/`, `·`, `-` and spaces because tool names are written like
 * "Email · subject line" and "Resume — bullets".
 */
export function scoreRow(query: string, row: PaletteRow): number {
  const q = norm(query);
  if (!q) return 1;
  const title = norm(row.title);
  const hint = norm(row.hint || "");
  let total = 0;
  for (const token of q.split(" ")) {
    if (!token) continue;
    let score = 0;
    if (title.startsWith(token)) score = 100;
    else if (new RegExp(`(^|[\\s/·-])${escapeRe(token)}`).test(title)) score = 80;
    else if (title.includes(token)) score = 60;
    else if (hint.includes(token)) score = 30;
    if (!score) return 0;
    total += score;
  }
  return total;
}

/**
 * The visible list. `hidden` is what the caps dropped — the component shows it, because a
 * launcher that quietly truncates teaches people to stop trusting it.
 */
export function filterRows(
  rows: PaletteRow[],
  query: string,
  opts: { idleCap?: number; queryCap?: number } = {}
): { rows: PaletteRow[]; hidden: number } {
  const idleCap = opts.idleCap ?? IDLE_CAP_PER_GROUP;
  const queryCap = opts.queryCap ?? QUERY_CAP;
  const scored = rows
    .map((row, at) => ({ row, at, score: scoreRow(query, row) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const ga = GROUP_ORDER.indexOf(a.row.group);
      const gb = GROUP_ORDER.indexOf(b.row.group);
      if (ga !== gb) return ga - gb;
      return a.at - b.at;
    })
    .map((x) => x.row);

  if (query.trim()) {
    return { rows: scored.slice(0, queryCap), hidden: Math.max(0, scored.length - queryCap) };
  }
  const seen: Record<string, number> = {};
  const kept: PaletteRow[] = [];
  for (const row of scored) {
    seen[row.group] = (seen[row.group] || 0) + 1;
    if (seen[row.group] > idleCap) continue;
    kept.push(row);
  }
  return { rows: kept, hidden: scored.length - kept.length };
}

/**
 * Group headers for a filtered list: consecutive rows of one group share a header, and the order
 * is the order the rows arrived in — so a `Go to` hit that outranks `Tools` stays above it rather
 * than being dragged back by its group.
 */
export function sectionize(rows: PaletteRow[]): { group: PaletteGroup; rows: PaletteRow[] }[] {
  const out: { group: PaletteGroup; rows: PaletteRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else out.push({ group: row.group, rows: [row] });
  }
  return out;
}
