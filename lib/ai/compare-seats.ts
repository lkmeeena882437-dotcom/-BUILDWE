/**
 * The compare lane contract: which models a comparison may ask, which one it asks by
 * default, and what each of those choices costs.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * Three surfaces have to agree about the same list or the user is lied to:
 *   • the picker, which must not offer a lane that cannot answer;
 *   • the POST, which has to decide what to hold credits for *before* it runs;
 *   • the run report, which has to say what actually ran and what was given back.
 * When the seats were a hard-coded array inside the route, the first two could not exist:
 * "which models?" was only discoverable by running it. One owner, read by all three.
 *
 * THE RULES
 * ---------
 * - A lane is a **catalog chat row**. Not "a string that looks like a model id": the catalog is
 *   what lets the lane name itself truthfully (see `modelDetailLabel`), and an id nobody can name
 *   is a lane that prints a brand where a name belongs.
 * - Between MIN_LANES and MAX_LANES of them. One model is not a comparison, and past six the run
 *   stops being about the answers and starts being about our bill. A caller asking for seven gets
 *   a refusal, never a silent four.
 * - Operator overrides (`COMPARE_SEATS`) are not held to the catalog, because a deployment may
 *   front a private model id through a proxy — but they are still clamped into the lane range,
 *   and a seat the catalog does not know is labelled with the raw id rather than a guess.
 * - A model whose provider has no key is not rejected. An outage is not the user's mistake, and
 *   the lane reports `live: false` and is refunded, so a refused lane costs nothing either way.
 */

import { CREDITS } from "@/lib/config";
import { MODEL_CATALOG, modelDetailLabel, type CatalogModel } from "@/lib/ai/models-catalog";
import { providerAvailable, type ProviderKeys } from "@/lib/ai/provider-registry";

export const MIN_LANES = 2;
export const MAX_LANES = 6;

/**
 * The three we run when nobody chooses. `gemma2-9b-it` used to be one of them and is a retired
 * Groq model, so that lane failed on every single run (audit A4) — which is exactly why this
 * list is asserted against the catalog by `tests/tools.mjs` instead of being trusted.
 */
export const DEFAULT_SEAT_IDS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
];

/** Chat rows, in catalog order. The only ids a lane may take. */
const CHAT_ROWS: CatalogModel[] = MODEL_CATALOG.filter((m) => m.capability === "chat");
const CHAT_BY_ID = new Map(CHAT_ROWS.map((m) => [m.id, m] as const));

export const chatSeatIds = (): string[] => CHAT_ROWS.map((m) => m.id);

const clamp = (n: number) => Math.min(MAX_LANES, Math.max(MIN_LANES, n));

/** `Model A`, `Model B`, … — a stable name for the row, independent of which model sits in it. */
export function seatLabel(i: number): string {
  return `Model ${String.fromCharCode(65 + (i % 26))}`;
}

export type Lane = { id: string; label: string; model: string };

/** What one lane will be called, and what it will be called *by*. */
export function laneFor(id: string, i: number): Lane {
  return { id, label: seatLabel(i), model: modelDetailLabel(id, "chat") };
}

/** How many lanes a deployment wants by default, honouring the operator's knob but never
 *  outside the range: `COMPARE_SEAT_COUNT=1` used to produce a "comparison" of one model. */
function wantedCount(fallback: number): number {
  const raw = Number(process.env.COMPARE_SEAT_COUNT ?? "");
  return Number.isFinite(raw) && raw > 0 ? clamp(Math.floor(raw)) : clamp(fallback);
}

/**
 * The default set. Env wins when set; otherwise the built-in three. If a deployment asks for
 * more seats than the built-in list has, the rest are filled from the catalog — reachable
 * providers first, then the better-quality rows — because an operator who sets
 * `COMPARE_SEAT_COUNT=6` and silently gets three lanes is being lied to by their own config.
 */
export function defaultLaneIds(userKeys?: ProviderKeys): string[] {
  const raw = (process.env.COMPARE_SEATS || "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const want = fromEnv.length ? fromEnv : [...DEFAULT_SEAT_IDS];
  const count = wantedCount(want.length);
  const ids = Array.from(new Set(want)).slice(0, count);
  if (ids.length >= count) return ids;
  const fill = CHAT_ROWS.filter((m) => !ids.includes(m.id))
    .sort(
      (a, b) =>
        Number(providerAvailable(b.provider, userKeys)) -
          Number(providerAvailable(a.provider, userKeys)) || b.quality - a.quality
    )
    .map((m) => m.id);
  for (const id of fill) {
    if (ids.length >= count) break;
    ids.push(id);
  }
  return ids;
}

/** What the picker needs from the server: the range, the price, and the starting selection.
 *  The rows themselves come from `/api/ai/models`, which owns the model projection. */
export function laneContract(userKeys?: ProviderKeys) {
  const ids = defaultLaneIds(userKeys);
  return {
    minLanes: MIN_LANES,
    maxLanes: MAX_LANES,
    /** One live lane costs this much; the combined-answer pass over the lanes is included. */
    perLane: CREDITS.cost.compareLane,
    /** A re-mix is one judge pass over answers already paid for, so it is priced as one lane. */
    mixCost: CREDITS.cost.compareLane,
    lanes: ids.length,
    defaults: ids.map((id, i) => laneFor(id, i)),
    note:
      "A lane is held before it runs and refunded if it cannot answer. Pick 2–6 models, and re-mixing the answers costs one lane.",
  };
}

/**
 * How much of one lane's answer is kept — for the run's report *and* for the text a re-mix is
 * allowed to hand the judge. The same number has to cover both or a re-mix could send the
 * synthesiser more text than the run that produced it did, which is how a "cap" becomes a joke.
 */
export const LANE_REPLY_CHARS = 2400;

export type LanePlan = { ok: true; ids: string[]; defaulted: boolean };
export type LaneRejection = {
  ok: false;
  status: number;
  body: { error: string; code: string; hint: string; [key: string]: unknown };
};

/**
 * The rules every lane list is held to, whether it arrives as `models` (what to ask) or as the
 * ids inside `lanes` (what to re-mix). Kept in one function because the two must not drift: a
 * caller who can smuggle an image model into a mix but not into a run has found a bug, not a
 * feature.
 *
 * Refusals carry a code (so a client can branch) and a hint (so a human does not have to read
 * this file to fix a typo).
 */
function validateLaneIds(
  rawIds: string[],
  opts: { field: string; emptyMeansDefault?: boolean }
): { ok: true; ids: string[] } | LaneRejection {
  const { field } = opts;
  const ids = Array.from(new Set(rawIds.map((v) => String(v ?? "").trim()).filter(Boolean)));
  if (!ids.length) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Pick at least two models to compare.",
        code: "TOO_FEW_LANES",
        hint: `"${field}" needs ${MIN_LANES}–${MAX_LANES} distinct ids from GET /api/ai/models (selectable.chat).`,
      },
    };
  }
  if (ids.length > MAX_LANES) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `A comparison runs ${MAX_LANES} models at most — ${ids.length} were asked for.`,
        code: "TOO_MANY_LANES",
        hint: `Each lane is a real model call, held against your balance before it runs. Trim "${field}" to ${MAX_LANES}.`,
        requested: ids.length,
      },
    };
  }
  const wrong = ids.filter((id) => !CHAT_BY_ID.has(id));
  if (wrong.length) {
    // "not a chat model" and "not a model at all" get different sentences, because the fixes are
    // different: one is a copy-paste from the wrong list, the other is a typo.
    const known = wrong
      .map((id) => {
        const row = MODEL_CATALOG.find((m) => m.id === id);
        return row ? `${id} is a ${row.capability} model` : `${id} is not in the catalog`;
      })
      .join("; ");
    const onlyKnown = wrong.every((id) => MODEL_CATALOG.some((m) => m.id === id));
    return {
      ok: false,
      status: 400,
      body: {
        error: onlyKnown
          ? `Compare asks text models: ${known}.`
          : `Unknown model id: ${known}.`,
        code: onlyKnown ? "LANE_NOT_A_CHAT_MODEL" : "LANE_NOT_IN_CATALOG",
        hint: onlyKnown
          ? "Image, audio and transcription models cannot answer a comparison prompt."
          : `Valid ids for this deployment: ${chatSeatIds().join(", ")}.`,
        rejected: wrong,
        valid: chatSeatIds(),
      },
    };
  }
  if (ids.length < MIN_LANES) {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          ids.length === 1
            ? "One model is an answer, not a comparison."
            : "Pick at least two models to compare.",
        code: "TOO_FEW_LANES",
        hint: `"${field}" needs ${MIN_LANES}–${MAX_LANES} distinct ids.`,
        received: ids,
      },
    };
  }
  return { ok: true, ids };
}

/**
 * Turn whatever the caller sent into the set to run — or into an error that says what to send
 * instead. Omitting the list is not a guess: it means this deployment's default lanes, which
 * `GET /api/ai/compare` publishes so a client never has to.
 */
export function resolveLanes(raw: unknown, userKeys?: ProviderKeys): LanePlan | LaneRejection {
  if (raw === undefined || raw === null || raw === "") {
    const ids = defaultLaneIds(userKeys);
    return { ok: true, ids, defaulted: true };
  }
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : null;
  if (!list) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "`models` must be a list of model ids.",
        code: "BAD_LANE_LIST",
        hint: `Send "models": ["${DEFAULT_SEAT_IDS[0]}", "${DEFAULT_SEAT_IDS[1]}"] — between ${MIN_LANES} and ${MAX_LANES} ids from GET /api/ai/models (selectable.chat).`,
      },
    };
  }
  const checked = validateLaneIds(list, { field: "models" });
  if (!checked.ok) return checked;
  return { ok: true, ids: checked.ids, defaulted: false };
}

/**
 * One answer the caller wants folded into a fresh combined answer.
 *
 * A re-mix does NOT re-ask the models — that is the whole point. The lanes a run already paid for
 * are on the caller's screen; choosing a different subset of them needs one judge pass, priced as
 * one lane, and nothing else. So this takes the answers back in, keeps each one to the same
 * `LANE_REPLY_CHARS` the run published it at (a re-mix can never be a bigger prompt than the run
 * that came before it), and refuses anything the run could not have produced.
 */
export type MixLane = { id: string; label: string; model: string; reply: string; chars: number; trimmed: boolean };
export type MixPlan = { ok: true; lanes: MixLane[] } | LaneRejection;

export function resolveMix(raw: unknown): MixPlan {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "`lanes` must be a list of { id, reply } pairs.",
        code: "BAD_MIX_LIST",
        hint: `Send "lanes": [{"id":"${DEFAULT_SEAT_IDS[0]}","reply":"…"}] with ${MIN_LANES}–${MAX_LANES} entries — the answers a comparison already returned.`,
      },
    };
  }
  const entries = raw
    .map((r) => ({
      id: String((r as { id?: unknown })?.id ?? "").trim(),
      reply: String((r as { reply?: unknown })?.reply ?? "").trim(),
    }))
    .filter((r) => r.id);
  const checked = validateLaneIds(entries.map((e) => e.id), { field: "lanes" });
  if (!checked.ok) return checked;
  const byId = new Map(entries.map((e) => [e.id, e.reply] as const));
  const missing = checked.ids.filter((id) => !byId.get(id));
  if (missing.length) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `No answer to mix for: ${missing.join(", ")}.`,
        code: "MIX_ANSWER_MISSING",
        hint: "A re-mix folds answers a comparison already returned — send each lane's `reply` with it.",
        missing,
      },
    };
  }
  return {
    ok: true,
    lanes: checked.ids.map((id, i) => {
      const full = byId.get(id) || "";
      const reply = full.slice(0, LANE_REPLY_CHARS);
      return {
        ...laneFor(id, i),
        reply,
        chars: reply.length,
        // Said out loud rather than silently cut: a combined answer built from a trimmed lane is
        // a different fact from one built from the whole thing.
        trimmed: full.length > LANE_REPLY_CHARS,
      };
    }),
  };
}

/**
 * Why a lane did not answer, in the caller's terms. Distinguishing "this deployment has no key
 * for that vendor" from "the vendor did not reply" is the difference between an error the user
 * can fix in Settings and one they have to wait out.
 */
export function laneNote(id: string, userKeys?: ProviderKeys): string {
  const row = CHAT_BY_ID.get(id);
  if (row && !providerAvailable(row.provider, userKeys)) {
    return `No ${row.provider} key connected — this lane had nothing to call.`;
  }
  return "The model did not answer, so this lane was not charged.";
}
