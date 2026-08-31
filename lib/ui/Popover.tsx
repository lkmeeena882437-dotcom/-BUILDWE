"use client";

/**
 * The one popover in the app.
 *
 * Two anchoring modes, because the surfaces that need one are structurally
 * different:
 *  - mode="absolute" (default) sits inside the caller's `relative` wrapper using
 *    Tailwind position classes. No measuring, no reflow listeners — right for a
 *    control in a row that does not clip (the composer's `+`, the mode picker).
 *  - mode="fixed" positions itself from the trigger's viewport rect. Needed for
 *    anything inside a scroll container or beside `overflow-hidden` (the sidebar
 *    profile flyout would otherwise be clipped by the history list), and the only
 *    mode that can flip to the other side when it would leave the screen.
 *
 * Four placements because a cascading submenu opens sideways and a bottom-anchored
 * profile row opens upward; a caller should not re-derive that per site. The math
 * lives in lib/ui/placement.ts — pure, and therefore testable without a browser.
 *
 * Structure: the outer node positions, the inner `.bw-pop__panel` owns background,
 * border, scroll and the entrance animation. Two transforms on one node would
 * fight, so they live on separate elements.
 *
 * Dismissal (Escape, outside pointerdown, focus return) is owned here rather than by
 * the caller: a component that receives `open` + `onClose` can wire its own, which
 * removes the "forgot to pass the ref" class of bug entirely.
 */
import { useRef, useState } from "react";
import clsx from "clsx";
import { useDismiss, useMenuKeys } from "./useDismiss";
import { px, useIsoLayoutEffect as useLayoutEffect } from "./internal";
import { clampViewport, placePanel, type Align, type Placement } from "./placement";

export type PopoverPlacement = Placement;
export type PopoverAlign = Align;

export interface PopoverProps {
  open: boolean;
  /** Called by this component on Escape or an outside pointerdown (see useDismiss). */
  onClose?: () => void;
  /** The trigger element. Required for mode="fixed": it is the anchor rect. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  mode?: "absolute" | "fixed";
  placement?: Placement;
  /** Cross-axis alignment: horizontal for below/above, vertical for right/left. */
  align?: Align;
  /** Gap between trigger and panel, px. */
  offset?: number;
  width?: number | string;
  minWidth?: number;
  /** Preferred max height; clamped to whatever the viewport leaves. */
  maxHeight?: number;
  /** Dark surface = the code-panel idiom (menus). false = light in-page panel. */
  dark?: boolean;
  role?: "menu" | "dialog" | "listbox" | "group";
  id?: string;
  labelledBy?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /** false for non-menu content inside (a form, a calculator): no arrow-key nav. */
  keyboard?: boolean;
  /** true when this panel is a submenu of an open menu — see useDismiss.allowSubmenus. */
  submenu?: boolean;
  /** Parent menus set this while a nested submenu owns Escape and the click. */
  pause?: boolean;
  /** Parent menus set this so a click on their open submenu counts as "inside". */
  allowSubmenus?: boolean;
}

export function Popover({
  open,
  onClose,
  anchorRef,
  mode = "absolute",
  placement: want = "below",
  align = "start",
  offset = 8,
  width = 240,
  minWidth,
  maxHeight = 340,
  dark = true,
  role = "menu",
  id,
  labelledBy,
  className,
  style,
  children,
  keyboard = true,
  submenu,
  pause,
  allowSubmenus,
}: PopoverProps) {
  const isMenu = role === "menu" && keyboard;
  const menu = useMenuKeys(open && isMenu);
  const dismiss = useDismiss({
    open,
    onClose: onClose ?? (() => {}),
    triggerRef: anchorRef,
    pause,
    allowSubmenus,
    ownTriggerSelector: id ? `[aria-controls="${id}"]` : undefined,
  });
  const outerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<ReturnType<typeof placePanel> | null>(null);

  const setRefs = (node: HTMLDivElement | null) => {
    outerRef.current = node;
    if (isMenu) menu.panelRef.current = node;
    dismiss.setPanelRef(node);
  };

  // mode="fixed": measure from the anchor. Re-runs on open, on resize, and on any
  // scroll (capture, so a scroll inside the sidebar or the chat follows the trigger
  // instead of leaving the menu floating over other content).
  useLayoutEffect(() => {
    if (!open || mode !== "fixed") return;
    const anchor = anchorRef?.current;
    if (!anchor) return;

    let raf = 0;
    const measure = () => {
      const panelW = panelRef.current?.offsetWidth || (typeof width === "number" ? width : 240);
      const panelH = panelRef.current?.scrollHeight || 0;
      setPlaced(
        placePanel({
          want,
          align,
          trigger: anchor.getBoundingClientRect(),
          panelW,
          panelH,
          vw: window.innerWidth,
          vh: window.innerHeight,
          offset,
          maxHeight,
        })
      );
    };

    measure();
    const onReflow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    // Rows mount after the first paint (a filtered list, a submenu opening): one extra
    // pass so the flip decision sees the real height instead of 0.
    const t = setTimeout(onReflow, 0);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, mode, anchorRef, want, align, offset, maxHeight, width]);

  // mode="absolute": CSS positions the panel, so the only thing to decide is whether
  // it must give up height. It matters because the composer pill sits near the bottom
  // of a phone viewport, and a long menu would otherwise run off screen with no way to
  // reach its last rows.
  useLayoutEffect(() => {
    if (!open || mode !== "absolute") return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.maxHeight = "";
    const r = panel.getBoundingClientRect();
    const h = clampViewport({
      panelTop: r.top,
      panelBottom: r.bottom,
      vh: window.innerHeight,
      maxHeight,
    });
    if (h) panel.style.maxHeight = `${h}px`;
  }, [open, mode, maxHeight, children]);

  if (!open) return null;

  return (
    <div
      ref={setRefs}
      id={id}
      data-bw-popover={role}
      data-bw-popover-submenu={submenu ? "" : undefined}
      data-placement={placed?.placement ?? want}
      onKeyDown={isMenu ? menu.onKeyDown : undefined}
      role={role}
      aria-orientation={role === "menu" ? "vertical" : undefined}
      aria-labelledby={labelledBy}
      className={clsx(
        "bw-pop",
        mode === "absolute" && "absolute z-50",
        mode === "absolute" && want === "below" && "top-full mt-2",
        mode === "absolute" && want === "above" && "bottom-full mb-2",
        mode === "absolute" && want === "right" && "left-full ml-2",
        mode === "absolute" && want === "left" && "right-full mr-2",
        mode === "absolute" &&
          (want === "below" || want === "above") &&
          (align === "end" ? "right-0" : "left-0"),
        mode === "absolute" &&
          (want === "right" || want === "left") &&
          (align === "end" ? "bottom-0" : "top-0"),
        className
      )}
      style={{
        ...(mode === "fixed"
          ? {
              position: "fixed" as const,
              top: px(placed?.top),
              bottom: px(placed?.bottom),
              left: px(placed?.left),
              right: px(placed?.right),
            }
          : {}),
        ...style,
      }}
    >
      <div
        ref={panelRef}
        className={clsx("bw-pop__panel", dark ? "bw-pop--dark" : "bw-pop--light")}
        style={{
          width: px(width),
          minWidth: px(minWidth),
          maxHeight: px(mode === "fixed" ? placed?.maxH ?? maxHeight : maxHeight),
        }}
      >
        {children}
      </div>
    </div>
  );
}
