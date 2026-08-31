"use client";

/**
 * Shared dismissal + menu-navigation behaviour for every popover in the app.
 *
 * Before this existed each menu hand-rolled its own close logic (a full-screen
 * invisible `<button>` behind the panel, as at app/page.tsx:2910 and :3046). That
 * works, but it does not return focus, does not survive a touch outside the panel
 * cleanly and gives every menu slightly different keyboard behaviour — so each new
 * menu invented its own again. This hook is the one implementation:
 *
 *   - Escape closes, from anywhere (document-level, so focus inside the panel works)
 *   - `pointerdown` outside the panel and outside the trigger closes. pointerdown,
 *     not click: it fires before a panel's own click handler, so a tap outside can
 *     never be swallowed by whatever the click was going to do, and it works on
 *     touch without a fake overlay element.
 *   - focus returns to the trigger on close — but only if focus was inside the
 *     panel. If the user clicked something else (a menu row that moved focus, a
 *     link that navigated), we do not steal it back.
 *   - `role="menu"` arrow-key navigation (Down/Up/Home/End) over
 *     `[data-bw-menu-item]:not([disabled])`.
 *
 * Deliberately *not* a scroll lock: a popover is not a modal, the page must stay
 * scrollable under it (and the sidebar menu sits next to a scrolling list).
 */
import { useCallback, useEffect, useRef } from "react";

export type DismissTarget = HTMLElement | null;

export interface UseDismissOptions {
  open: boolean;
  onClose: () => void;
  /** The element that opens the popover. Optional: pass your own if you already have one. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** Return focus to the trigger when the popover closes. Default true. */
  returnFocus?: boolean;
  /**
   * Close when a pointerdown lands on an element marked with this attribute, even
   * though it is technically inside the trigger (e.g. the trigger is a wrapper that
   * also contains a button with its own action). Default "data-bw-dismiss-now".
   */
  closeNowAttr?: string;
  /**
   * True while a nested submenu owns the keyboard and the click. A cascading menu
   * (Step 6's Theme row) renders its own popover outside this one's DOM, so without
   * this the parent would eat the Escape that belongs to the child and would treat a
   * click on the child as an outside click. The child passes pause:false; the parent
   * passes pause:childOpen and lists the child's panel in `alsoInside`.
   */
  pause?: boolean;
  /** Extra elements to treat as "inside" — e.g. a child panel you hold a ref to. */
  alsoInside?: React.RefObject<HTMLElement | null>[];
  /**
   * Selector for this popover's own trigger, for callers that position with CSS and
   * pass no `triggerRef`. Without it, clicking the trigger of an *open* menu counts as
   * an outside click: the dismiss closes it and the click then re-opens it, so the
   * menu appears to ignore the button it belongs to. Matched on `aria-controls` (which
   * `menuTriggerProps` writes), not on a generic marker, so a click on *another* menu's
   * trigger still closes this one — the one-open-at-a-time rule survives.
   */
  ownTriggerSelector?: string;
  /**
   * Accept *any* open nested submenu (marked `data-bw-popover-submenu`, which is what
   * `<Popover submenu>` does) as inside this menu. Only one menu is ever open at a
   * time, so no identity check is needed, and it saves every caller from threading a
   * ref through the row that opened the child.
   */
  allowSubmenus?: boolean;
}

export interface UseDismissResult {
  /** Attach to the trigger (or its wrapper). */
  triggerRef: React.RefObject<DismissTarget>;
  /** Attach to the panel root (callback form, so it can be merged with other refs). */
  setPanelRef: (node: HTMLElement | null) => void;
  panelRef: React.RefObject<HTMLElement | null>;
  /** true while focus is inside the panel — used to decide whether to hand focus back. */
  isOpenByFocus: () => boolean;
}

export function useDismiss(opts: UseDismissOptions): UseDismissResult {
  const {
    open,
    onClose,
    returnFocus = true,
    closeNowAttr = "data-bw-dismiss-now",
    pause = false,
    alsoInside,
    allowSubmenus = false,
    ownTriggerSelector,
  } = opts;
  const ownTriggerRef = useRef<DismissTarget>(null);
  const triggerRef = opts.triggerRef ?? ownTriggerRef;
  const panelRef = useRef<HTMLElement | null>(null);
  const setPanelRef = useCallback((node: HTMLElement | null) => {
    panelRef.current = node;
  }, []);
  // Remember who was focused when the panel opened, so a close can give focus back
  // even if the trigger unmounts its own reference in the same tick.
  const focusBefore = useRef<DismissTarget>(null);

  useEffect(() => {
    if (!open) return;
    focusBefore.current = triggerRef.current;
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;

    const isInPanel = (node: Node | null) =>
      !!node &&
      (!!panelRef.current && panelRef.current.contains(node)) ||
      (alsoInside || []).some((r) => !!r?.current && r.current.contains(node)) ||
      (allowSubmenus && !!(node as HTMLElement).closest?.("[data-bw-popover-submenu]"));
    const isInTrigger = (node: Node | null) =>
      !!node && !!triggerRef.current && triggerRef.current.contains(node);

    const onPointerDown = (e: PointerEvent) => {
      if (pause) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`[${closeNowAttr}]`)) {
        onClose();
        return;
      }
      if (isInPanel(target) || isInTrigger(target)) return;
      if (ownTriggerSelector && target.closest(ownTriggerSelector)) return;
      onClose();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pause) {
        // Only close if nobody else already handled this Escape. A nested submenu
        // (Step 6's theme row) stops propagation so the parent stays open.
        if (e.defaultPrevented) return;
        onClose();
      }
    };

    // capture:true so a panel that stops propagation on its own click cannot keep
    // the menu open after an outside tap.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocus && focusBefore.current && isInPanel(document.activeElement)) {
        focusBefore.current.focus();
      }
      focusBefore.current = null;
    };
    // panelRef/triggerRef are stable refs; deps are the behaviour, not the nodes.
  }, [open, onClose, returnFocus, closeNowAttr, pause, alsoInside, allowSubmenus, ownTriggerSelector, triggerRef]);

  const isOpenByFocus = useCallback(() => {
    return !!panelRef.current && panelRef.current.contains(document.activeElement);
  }, []);

  return { triggerRef, panelRef, setPanelRef, isOpenByFocus };
}

/**
 * Keyboard navigation for a `role="menu"` panel. Returns an onKeyDown handler to put
 * on the panel; the panel is expected to contain `[data-bw-menu-item]` elements
 * (MenuRow does this for you).
 */
export function useMenuKeys(open: boolean) {
  const panelRef = useRef<HTMLElement | null>(null);
  const setPanelRef = useCallback((node: HTMLElement | null) => {
    panelRef.current = node;
  }, []);

  const items = useCallback(() => {
    if (!panelRef.current) return [] as HTMLElement[];
    return Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        "[data-bw-menu-item]:not([disabled]):not([aria-disabled='true'])"
      )
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    // First item on open, unless the caller already moved focus (typeahead menus).
    const raf = requestAnimationFrame(() => {
      const list = items();
      if (list.length && panelRef.current && !panelRef.current.contains(document.activeElement)) {
        list[0].focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, items]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const list = items();
      if (!list.length) return;
      const at = list.indexOf(document.activeElement as HTMLElement);
      const go = (n: number) => {
        e.preventDefault();
        list[(n + list.length) % list.length]?.focus();
      };
      if (e.key === "ArrowDown") go(at < 0 ? 0 : at + 1);
      else if (e.key === "ArrowUp") go(at < 0 ? list.length - 1 : at - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(list.length - 1);
      else if (e.key === "Tab") onCloseFromTab(list, e);
    },
    [items]
  );

  return { panelRef, onKeyDown };
}

/** Tab wraps inside the menu instead of escaping into the page behind it. */
function onCloseFromTab(list: HTMLElement[], e: React.KeyboardEvent<HTMLDivElement>) {
  const first = list[0];
  const last = list[list.length - 1];
  const el = document.activeElement as HTMLElement | null;
  if (!el) return;
  if (!e.shiftKey && el === last) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && el === first) {
    e.preventDefault();
    last.focus();
  }
}

/**
 * Small helper for callers: the three ARIA props a menu trigger needs. Keeps
 * `aria-expanded` honest (it must reflect `open`, not "hovered").
 */
export function menuTriggerProps(open: boolean, panelId?: string) {
  return {
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    ...(panelId ? { "aria-controls": panelId } : {}),
  };
}
