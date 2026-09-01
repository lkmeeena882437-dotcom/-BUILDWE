"use client";

/**
 * The one dialog surface of the workspace: nine sheets (auth, plans, profile, teams, keys,
 * skills, models, compare, creations) are this component with different children. It used to
 * live inside app/page.tsx, which is why it had no focus handling: a modal that does not move
 * the caret into itself is not a modal — a keyboard user keeps tabbing through the page behind
 * it, and a screen reader announces nothing but an unnamed `role="dialog"`.
 *
 * WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
 * -------------------------------------------------
 *   • focus lands on the panel (not on a control), so Escape and Tab both mean something from
 *     the first keypress, and the dialog is named by its own title;
 *   • Tab cycles inside the panel while it is open;
 *   • closing returns focus to whatever opened it — otherwise the caret is dumped on <body> and
 *     a keyboard user has to walk the whole sidebar again to get back to the row they left;
 *   • NO focus-trap library and no `inert` on the app behind it. The backdrop is already a
 *     full-screen button, so a pointer cannot reach the page underneath; with the cycle above,
 *     neither can a keyboard. `inert` would need an app-root element to sit on, and in an App
 *     Router tree there is none — the portal-to-body version of this also loses the sheet's
 *     place in the tree for no gain. That is a step of its own if a second dialog system ever
 *     needs it.
 *
 * The Escape listener is on `window`, not the panel: the first keypress after opening belongs
 * to no element inside the dialog, and an `onKeyDown` on the panel would miss it.
 */

import clsx from "clsx";
import { ChevronLeft, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

/** Anything Tab should stop on, in DOM order. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Sheet({
  children,
  onClose,
  title,
  wide,
}: {
  children: React.ReactNode;
  /** Required on purpose: `role="dialog"` with no accessible name is the bug this component
   *  shipped with, and nine call sites already pass one — the type is what keeps a tenth from
   *  forgetting, rather than a comment asking politely. */
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  /* Every caller passes an inline lambda. If the trap below depended on `onClose` the effect
     would tear down and re-arm on each parent render — which re-focuses the panel and steals the
     caret out of the field someone is typing in. One ref, one subscription. */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = panel.current;
    const back = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetWidth || el.offsetHeight || el === document.activeElement
      );
      if (!items.length) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = Boolean(active) && node.contains(active as Node);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("lock-scroll");
    node?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("lock-scroll");
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" data-sheet>
      <button type="button" className="absolute inset-0 bg-black/35" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className={clsx(
          "relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border p-5 shadow-2xl outline-none sm:rounded-3xl",
          wide ? "max-w-lg" : "max-w-md"
        )}
        style={{
          borderColor: "var(--border)",
          background: "var(--card)",
          color: "var(--ink)",
          paddingBottom: "calc(18px + var(--safe-b))",
        }}
      >
        <div className="mb-3 flex justify-center sm:hidden">
          <span className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} />
        </div>
        <div className="mb-4 flex items-center gap-2">
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: "var(--muted)" }} aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 id={titleId} className="flex-1 text-base font-semibold tracking-tight">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: "var(--muted)" }} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
