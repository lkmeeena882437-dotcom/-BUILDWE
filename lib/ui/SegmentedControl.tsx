"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsoLayoutEffect as useLayoutEffect } from "./internal";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/**
 * Segmented control with the sliding indicator (the thing the auth sheet and the
 * pricing page both need and neither had). One implementation, because "pill slides
 * between segments" is exactly the kind of detail that turns into three slightly
 * different animations per page — and then one of them forgets reduced motion.
 *
 * How the indicator works: it is an absolutely positioned child at left:0 whose
 * `transform: translateX()` + `width` are measured from the active button's offsets.
 * Transform/width are what CSS can interpolate cheaply, so the slide is composited;
 * `left`/`right` would relayout on every frame.
 *
 * Re-measured on value change, on container resize (the collapsed sidebar changes
 * segment widths — that is the bug class this hook exists to survive) and once
 * `document.fonts` settles, because Inter arriving late changes text widths after
 * the first measure.
 *
 * Semantics: `role="tablist"` with `role="tab"` + `aria-selected` per segment, roving
 * tabIndex (only the active one is a tab stop) and Arrow/Home/End that move the
 * selection directly — a segmented control activates on arrow, unlike a menu.
 */

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Screen-reader-only suffix, e.g. "Billed monthly". */
  srLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  items: SegmentedItem<T>[];
  /** sm = in a compact bar / mobile; md = on a page. */
  size?: "sm" | "md";
  /** Stretch every segment to the same width (pricing/auth cards). */
  full?: boolean;
  ariaLabel: string;
  /** Sit on a dark surface (a popover) instead of the page background. */
  dark?: boolean;
  className?: string;
  id?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  items,
  size = "md",
  full,
  ariaLabel,
  dark,
  className,
  id,
}: SegmentedControlProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);

  const at = Math.max(0, items.findIndex((i) => i.value === value));

  const measure = useCallback(() => {
    const root = rootRef.current;
    const el = btnRefs.current[at];
    if (!root || !el) return;
    const rr = root.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (!er.width) return; // hidden (a collapsed sidebar, a closed sheet) — retry later
    setInd({ left: er.left - rr.left, width: er.width });
  }, [at]);

  useLayoutEffect(() => {
    measure();
  }, [measure, items.length]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    // The container alone is not enough: a label can change width without the container
    // moving at all (a localized string, an icon appearing). Observing the active button
    // too is what keeps the indicator glued instead of drifting a few px off-centre.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    if (ro) {
      if (rootRef.current) ro.observe(rootRef.current);
      const active = btnRefs.current[at];
      if (active) ro.observe(active);
    }
    // Fonts land after first paint; widths change with them.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    let alive = true;
    fonts?.ready?.then(() => alive && measure());
    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [measure, at]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    if (e.key in keys) {
      e.preventDefault();
      const step = keys[e.key];
      // Walk up to len steps, skipping disabled segments, wrapping by modulo.
      for (let n = 1; n <= items.length; n++) {
        const idx = (((at + step * n) % items.length) + items.length) % items.length;
        const next = items[idx];
        if (next && !next.disabled) {
          onChange(next.value);
          btnRefs.current[idx]?.focus();
          return;
        }
      }
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const idx = e.key === "Home" ? 0 : items.length - 1;
      const it = items[idx];
      if (it && !it.disabled) {
        onChange(it.value);
        btnRefs.current[idx]?.focus();
      }
    }
  };

  return (
    <div
      ref={rootRef}
      id={id}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      data-bw-seg=""
      onKeyDown={onKeyDown}
      className={clsx(
        "bw-seg",
        size === "sm" && "bw-seg--sm",
        full && "bw-seg--full",
        dark && "bw-seg--dark",
        className
      )}
    >
      <span
        className="bw-seg__ind"
        aria-hidden
        style={ind ? { transform: `translateX(${ind.left}px)`, width: `${ind.width}px` } : { opacity: 0 }}
      />
      {items.map((it, i) => {
        const active = it.value === value;
        const Icon = it.icon;
        return (
          <button
            key={it.value}
            ref={(n) => {
              btnRefs.current[i] = n;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={it.srLabel ? `${it.label} — ${it.srLabel}` : undefined}
            disabled={it.disabled}
            tabIndex={active ? 0 : -1}
            data-bw-seg-item={it.value}
            onClick={() => !active && !it.disabled && onChange(it.value)}
            className={clsx("bw-seg__btn", active && "is-active")}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2} /> : null}
            <span className="truncate">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
