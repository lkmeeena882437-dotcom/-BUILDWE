"use client";

/**
 * CompareResults — what came back, and what you can do with it.
 *
 * WHY IT EXISTS (W3.2)
 * --------------------
 * A comparison used to end at the read: three answers and one combined paragraph, and if you
 * liked two of the three better there was no move left except re-running the whole thing — which
 * asks every model again and costs every lane again. So the results became an input: each answer
 * carries a "use this in the combined answer" toggle, and folding a chosen subset costs **one
 * judge pass**, priced as one lane, because the models are not asked again.
 *
 * THE ONE RULE THIS COMPONENT IS BUILT AROUND
 * ------------------------------------------
 * **Lanes stay visible.** Checking and unchecking changes what the *combined* answer is made of —
 * never what is on the screen. Hiding the lanes you did not pick would turn "which model said
 * what" into a guess, and that is the entire value of the feature.
 *
 * WHAT IT DOES NOT OWN
 * --------------------
 * The answers, the mix history, and the money: those are the page's `compareResult` / `mixes` /
 * wallet state, and the server's hold. This file decides how they read, nothing else.
 */
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, Merge } from "lucide-react";
import { Btn } from "@/lib/ui/Btn";
import type { CompareLane } from "@/lib/client/api";

/** One combined answer: the text, the lanes it was folded from, and what the server said about them. */
export type MixEntry = {
  synthesis: string;
  /** Lane ids this combined answer was built from, in the order the server used. */
  from: string[];
  /** Per-answer detail from a re-mix — how much of each lane actually went in. */
  used?: { id: string; model: string; chars: number; trimmed?: boolean }[];
  /** Set when the judge pass itself could not run. */
  note?: string;
  /** A re-mix costs; the run's own synthesis is bundled. Recorded so the strip can say which is which. */
  paid?: boolean;
};

export function CompareResults({
  lanes,
  mixes,
  view,
  include,
  busy,
  mixBusy,
  mixCost,
  mixShort,
  offlineMessage,
  onToggleInclude,
  onMix,
  onView,
  onCopy,
  onTopUp,
  copied,
}: {
  lanes: CompareLane[];
  mixes: MixEntry[];
  view: number;
  include: string[];
  busy: boolean;
  mixBusy: boolean;
  mixCost: number;
  /** Credits still missing for one more re-mix; 0 when the balance covers it (or is unknown). */
  mixShort: number;
  offlineMessage?: string;
  onToggleInclude: (id: string) => void;
  onMix: () => void;
  onView: (dir: -1 | 1) => void;
  onCopy: (text: string, key: string) => void;
  onTopUp: () => void;
  copied: string | null;
}) {
  const current = mixes[view] || null;
  const live = lanes.filter((l) => l.live && l.reply.trim());
  const byId = new Map(lanes.map((l) => [l.id, l] as const));
  const nameOf = (id: string) => byId.get(id)?.model || id;
  // "Dirty" is the whole UX here: the button only offers work that is not already on screen.
  const dirty =
    !!current &&
    include.length >= 2 &&
    (include.length !== current.from.length || include.some((id) => !current.from.includes(id)));
  const trimmedHere = (current?.used || []).filter((u) => u.trimmed);

  return (
    <div className="space-y-3" data-compare-results>
      {offlineMessage && (
        <p
          className="rounded-2xl border px-3 py-3 text-[12px]"
          style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--muted)" }}
          data-compare-offline
        >
          {offlineMessage}
        </p>
      )}

      {/* Every lane stays in this list while it has an answer, checked or not — see the header. */}
      {!!lanes.length && (
        <div className="grid gap-2">
          {lanes.map((l) => {
            const on = include.includes(l.id);
            const canMix = l.live && Boolean(l.reply.trim());
            return (
              <div
                key={l.id}
                className="rounded-2xl border p-3"
                style={{
                  borderColor: on && canMix ? "var(--accent)" : "var(--border)",
                  background: l.live ? "var(--card)" : "var(--secondary)",
                }}
                data-result-lane={l.id}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wide"
                    style={{ color: l.live ? "var(--accent)" : "var(--muted)" }}
                  >
                    {l.label}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: "var(--soft)" }}>
                      {l.model}
                    </span>
                    {l.live && (
                      <Btn
                        variant="icon"
                        size="sm"
                        aria-label={`Copy ${l.label} (${l.model})`}
                        onClick={() => onCopy(l.reply, `cmp-${l.id}`)}
                      >
                        {copied === `cmp-${l.id}` ? (
                          <Check className="h-3.5 w-3.5" style={{ color: "var(--ok)" }} />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Btn>
                    )}
                  </span>
                </div>
                <p
                  className="max-h-44 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed"
                  style={{ color: "var(--muted)" }}
                >
                  {l.reply.trim() ? l.reply : l.note || "— this lane did not answer —"}
                </p>
                {canMix && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={busy || mixBusy}
                    onClick={() => onToggleInclude(l.id)}
                    className="mt-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition disabled:opacity-50"
                    style={{
                      borderColor: on ? "var(--accent)" : "var(--border)",
                      background: on ? "var(--accent-soft)" : "transparent",
                      color: on ? "var(--accent)" : "var(--muted)",
                    }}
                    data-mix-toggle={l.id}
                  >
                    <span
                      className="flex h-3 w-3 items-center justify-center rounded-[4px] border"
                      style={{
                        borderColor: on ? "var(--accent)" : "var(--soft)",
                        background: on ? "var(--accent)" : "transparent",
                      }}
                      aria-hidden
                    >
                      {on ? <Check className="h-2 w-2 text-white" strokeWidth={4} /> : null}
                    </span>
                    {on ? "In the combined answer" : "Add to the combined answer"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {live.length >= 2 && (
        <p className="text-[10px]" style={{ color: "var(--soft)" }}>
          {include.length} of {live.length} answers go into the combined one. Unchecking keeps the
          answer on the screen — it only takes it out of the mix.
        </p>
      )}

      {current && (
        <div
          className="rounded-2xl border p-3"
          style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
              Combined answer
            </span>
            {mixes.length > 1 && (
              <span className="flex items-center gap-0.5">
                <Btn
                  variant="icon"
                  size="sm"
                  aria-label="Previous combined answer"
                  disabled={view <= 0}
                  onClick={() => onView(-1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Btn>
                <span className="text-[10px] tabular-nums" style={{ color: "var(--muted)" }}>
                  {view + 1}/{mixes.length}
                </span>
                <Btn
                  variant="icon"
                  size="sm"
                  aria-label="Next combined answer"
                  disabled={view >= mixes.length - 1}
                  onClick={() => onView(1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Btn>
              </span>
            )}
            {current.synthesis.trim() && (
              <Btn
                variant="icon"
                size="sm"
                className="ml-auto"
                aria-label="Copy the combined answer"
                onClick={() => onCopy(current.synthesis, "cmp-synthesis")}
              >
                {copied === "cmp-synthesis" ? (
                  <Check className="h-3.5 w-3.5" style={{ color: "var(--ok)" }} />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Btn>
            )}
          </div>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
            {current.from.length
              ? `From ${current.from.map(nameOf).join(" + ")}`
              : "Nothing was folded into this one."}
            {current.paid ? ` · re-mix, ${mixCost} credit${mixCost === 1 ? "" : "s"}` : " · included in the run"}
          </p>
          <p
            className={clsx(
              "mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed",
              mixBusy && "opacity-60"
            )}
          >
            {current.synthesis ||
              current.note ||
              "No model answered the combined pass — the lanes above are all there is."}
          </p>
          {!!trimmedHere.length && (
            <p className="mt-1 text-[10px]" style={{ color: "var(--soft)" }}>
              {trimmedHere.map((u) => `${u.model} was read down to ${u.chars} characters`).join(", ")} — the
              run only keeps that much of each answer, so the mix sees the same text this screen does.
            </p>
          )}
        </div>
      )}

      {dirty && (
        <div className="flex flex-wrap items-center gap-2">
          <Btn size="sm" onClick={onMix} disabled={busy || mixBusy || include.length < 2 || mixShort > 0}>
            {mixBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
            {mixBusy
              ? "Combining…"
              : `Combine these ${include.length} answers · ${mixCost} credit${mixCost === 1 ? "" : "s"}`}
          </Btn>
          {mixShort > 0 && (
            <span className="flex items-center gap-2 text-[11px]" style={{ color: "var(--err)" }}>
              {mixShort} short — this needs a top-up first.
              <Btn size="sm" variant="soft" onClick={onTopUp}>
                Top up
              </Btn>
            </span>
          )}
        </div>
      )}

      {/* Only once there is an answer to distrust: on a run where nothing answered, that sentence
          is just noise on top of an error. */}
      {!!mixes.length && (
        <p className="text-center text-[10px]" style={{ color: "var(--soft)" }}>
          Model agreement is not proof — verify important facts with the ✓ Verify button.
        </p>
      )}
    </div>
  );
}
