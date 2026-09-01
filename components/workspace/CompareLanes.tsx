"use client";

/**
 * CompareLanes — which models a comparison asks, chosen by the user.
 *
 * WHY A PICKER AND NOT THREE FIXED SEATS
 * --------------------------------------
 * The route used to own a hard-coded array of three Groq ids, and the sheet said "ask 3
 * models". So the answer to "can I compare Claude against Llama?" was: no, and you could not
 * even find out what you *were* getting without running it. The lane set is now the caller's
 * choice within a range the server also enforces (`lib/ai/compare-seats.ts`), and the rows here
 * are that projection — `selectable.chat` from `/api/ai/models`, the same list the Models sheet
 * reads. Nothing in this file decides which model exists or whether it can be called.
 *
 * WHAT IT SHOWS FOR A LANE THAT CANNOT RUN
 * ----------------------------------------
 * `available: false` rows stay in the list, disabled, with the server's reason on them and the
 * action that would fix it. Removing them would be the friendlier lie — and the one this app has
 * already spent a step removing from the Models sheet. A row you can read is a row you can act
 * on; a row that vanished is a bug report.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * - No pricing math of its own. `perLane` and the lane range come from `GET /api/ai/compare`, so
 *   the preview cannot disagree with what the POST holds.
 * - No selection of its own: the page owns `selected` and passes `onToggle`, because the run
 *   button, the credit line and the sheet's copy all need the same set.
 */
import clsx from "clsx";
import { Check, KeyRound, Layers } from "lucide-react";
import { Btn } from "@/lib/ui/Btn";
import type { SelectableModel } from "@/lib/client/api";

export type LaneRow = Pick<SelectableModel, "id" | "label" | "provider" | "quality" | "latency" | "available"> &
  Partial<Pick<SelectableModel, "whyNot" | "strengths" | "brand">>;

export function CompareLanes({
  rows,
  selected,
  minLanes,
  maxLanes,
  perLane,
  busy,
  onToggle,
  onConnectKeys,
}: {
  rows: LaneRow[];
  selected: string[];
  minLanes: number;
  maxLanes: number;
  perLane: number;
  busy: boolean;
  onToggle: (id: string) => void;
  /** Only reachable from a disabled row, and only does one thing: opens the BYOK sheet. */
  onConnectKeys: () => void;
}) {
  const atMax = selected.length >= maxLanes;
  const atMin = selected.length <= minLanes;
  const offCount = rows.filter((r) => !r.available).length;

  if (!rows.length) {
    return (
      <p className="rounded-2xl border px-3 py-2.5 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--muted)" }}>
        No model list to pick from yet — this deployment could not read its catalogue.
      </p>
    );
  }

  return (
    <div data-compare-picker>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
          Models to ask
        </span>
        <span className="text-[10px]" style={{ color: "var(--soft)" }}>
          {selected.length} of {minLanes}–{maxLanes} selected
          {offCount > 0 ? ` · ${offCount} need a key` : ""}
        </span>
      </div>

      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1" role="group" aria-label="Models to compare">
        {rows.map((m) => {
          const on = selected.includes(m.id);
          if (!m.available) {
            return (
              <li key={m.id}>
                <div
                  className="rounded-2xl border px-3 py-2"
                  style={{ borderColor: "var(--border)", background: "var(--secondary)" }}
                  aria-disabled="true"
                  data-lane-off={m.id}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                      {m.label}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--border)", color: "var(--muted)" }}>
                      {m.whyNot || `No ${m.provider} key here`}
                    </span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide" style={{ color: "var(--soft)" }}>
                      {m.provider}
                    </span>
                  </div>
                  <Btn size="sm" variant="ghost" className="mt-1.5" onClick={onConnectKeys}>
                    <KeyRound className="h-3.5 w-3.5" /> Connect a key for this one
                  </Btn>
                </div>
              </li>
            );
          }
          // Three reasons a lane is unclickable, each with its own sentence: mid-run, at the top of
          // the range, at the bottom of it. A disabled control that cannot say why is the pattern
          // this app has been removing all week.
          const blocked = busy || (!on && atMax) || (on && atMin);
          const why = busy
            ? "This comparison is running"
            : !on && atMax
              ? `A comparison runs ${maxLanes} models at most`
              : on && atMin
                ? `${minLanes} is the floor — one answer is not a comparison`
                : undefined;
          return (
            <li key={m.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={blocked}
                title={why}
                onClick={() => onToggle(m.id)}
                className={clsx(
                  "flex w-full items-start gap-2.5 rounded-2xl border px-3 py-2 text-left transition",
                  busy && "opacity-60"
                )}
                style={{
                  borderColor: on ? "var(--accent)" : "var(--border)",
                  background: on ? "var(--accent-soft)" : "var(--card)",
                }}
                data-lane={m.id}
                data-lane-on={on ? "1" : undefined}
              >
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--border)",
                    background: on ? "var(--accent)" : "transparent",
                  }}
                  aria-hidden
                >
                  {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold">{m.label}</span>
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--soft)" }}>
                      {m.provider} · {m.latency} · quality {m.quality}/5
                    </span>
                    {!!perLane && (
                      <span className="ml-auto text-[10px] font-bold" style={{ color: on ? "var(--accent)" : "var(--soft)" }} data-lane-cost={m.id}>
                        {perLane} credit{perLane === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  {!!m.strengths?.length && (
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--muted)" }}>
                      {m.strengths.join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-1.5 flex items-start gap-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
        <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--soft)" }} />
        {atMax ? (
          <span>
            {maxLanes} is the most one run asks at once — every lane is a real model call, held against
            your balance before it starts.
          </span>
        ) : atMin && selected.length === minLanes ? (
          <span>{minLanes} is the floor: one answer is not a comparison.</span>
        ) : (
          <span>
            Pick {minLanes}–{maxLanes}. A lane that cannot answer is refunded, so an unavailable model
            costs you nothing — but it also tells you nothing.
          </span>
        )}
      </p>
    </div>
  );
}
