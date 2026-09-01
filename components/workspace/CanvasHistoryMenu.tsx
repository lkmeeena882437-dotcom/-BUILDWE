"use client";

/**
 * CanvasHistoryMenu — the code panel's list of saved versions.
 *
 * Two changes at once, and the second is the reason it exists:
 *
 * 1. It used to be a hand-rolled overlay with a full-screen invisible close button, so it
 *    could be dismissed by mouse only. It is now a `Popover` on the dark surface, which
 *    brings Escape, arrow keys and focus return — and, since the code panel is dark,
 *    `dark` rather than the light in-page panel style (the same choice the profile flyout's
 *    submenu made in Step 6).
 *
 * 2. The rows are now `MenuRow`s, which means each one is a real `<button>` in a `role="menu"`
 *    — the old markup was a scrollable div of buttons with no menu semantics, so a screen
 *    reader announced "History" followed by an unlabeled list.
 *
 * Restoring is the page's job (`onRestore`), because the page owns the canvas, its language
 * and its version list — a second owner of that would be a second behaviour. What the page
 * does on restore matters enough to be written down here: it snapshots the current canvas
 * *before* replacing it, so "go back to version 4" is itself undoable. It was not: the
 * content you were looking at simply left the list.
 */
import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import clsx from "clsx";
import { MenuLabel, MenuRow, Popover, menuTriggerProps } from "@/lib/ui";

export type CanvasVersion = { ts: number; code: string; lang: string };

export const CANVAS_HISTORY_MENU_ID = "bw-canvas-history-menu";

/** `12:04:31` on a chip is noise; `12:04` reads, and a day boundary is worth a word. */
function when(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function CanvasHistoryMenu({
  versions,
  currentCode,
  onRestore,
}: {
  versions: CanvasVersion[];
  currentCode: string;
  onRestore: (v: CanvasVersion) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  if (versions.length < 2) return null;

  return (
    <div ref={anchorRef} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition",
          open ? "bg-white/15 text-white" : "text-white/45 hover:bg-white/10"
        )}
        {...menuTriggerProps(open, CANVAS_HISTORY_MENU_ID)}
      >
        <RotateCcw className="h-3 w-3" /> History · {versions.length}
      </button>
      <Popover
        id={CANVAS_HISTORY_MENU_ID}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        mode="absolute"
        placement="below"
        align="start"
        width={244}
        maxHeight={232}
        dark
        label="Canvas versions"
      >
        <MenuLabel>Newest first — restoring keeps this one</MenuLabel>
        {versions.map((v, i) => {
          const isCurrent = v.code === currentCode;
          return (
            <MenuRow
              key={v.ts}
              title={isCurrent ? "Current" : `Version ${versions.length - i}`}
              right={<span className="text-[10px] opacity-60">{when(v.ts)}</span>}
              selected={isCurrent}
              disabled={isCurrent}
              note="Already showing this one"
              onClick={() => {
                setOpen(false);
                if (v.code === currentCode) return;
                onRestore(v);
              }}
            />
          );
        })}
      </Popover>
    </div>
  );
}
