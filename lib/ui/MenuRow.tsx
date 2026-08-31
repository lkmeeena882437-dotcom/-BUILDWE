"use client";

import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/**
 * One row inside a popover menu: 16px icon · title · optional muted subtitle, with a
 * grey hover, a selected mark, and the hooks the keyboard layer looks for
 * (`data-bw-menu-item`). Icon-first and title-on-one-line is the shape the brief
 * asked for; the two-line form is for rows whose meaning is not obvious from the
 * label alone (attach → "reads it with vision").
 *
 * Deliberately not a `<li>`/`<div role=button>`: a real `<button>` keeps Enter/Space,
 * `:disabled` styling and form semantics free. With `href` it becomes a link, so a
 * row that navigates is not faked with onClick + router.push.
 *
 * Colour comes from the surface it is dropped into (currentColor), never a fixed
 * palette: the same row works on the dark flyout and on a light panel.
 */

/** React 18-friendly ref callback for a `RefObject<HTMLElement | null>` prop. */
function intoRowRef(rowRef?: React.RefObject<HTMLElement | null>) {
  return (node: HTMLElement | null) => {
    if (rowRef) (rowRef as { current: HTMLElement | null }).current = node;
  };
}

export interface MenuRowProps {
  title: string;
  /** Small muted second line. */
  hint?: string;
  icon?: LucideIcon;
  /** Anything rendered at the right edge (a count, a shortcut, a chevron). */
  right?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  /** Render a check mark and set aria-current. */
  selected?: boolean;
  /** Destructive action (Log out, Delete) — tinted with --err. */
  danger?: boolean;
  disabled?: boolean;
  /** Kept visible, not clickable: for "not available on your plan" rows. */
  note?: string;
  type?: "button" | "submit";
  className?: string;
  /**
   * Role of the row itself. `menuitem` inside a `role="menu"` popover; `option` when a
   * caller reuses these rows as a listbox (then `ariaChecked` is legal, and only then —
   * aria-checked on a menuitem is an ARIA violation the linter rightly flags).
   */
  rowRole?: "menuitem" | "option" | "button";
  /** Selected mark for `rowRole="option"`. */
  ariaChecked?: boolean;
  /**
   * Asserted by tests: every row in a real menu maps to a handler or a route that
   * exists, so a dead row cannot ship (the brief's "no row that does nothing", made
   * checkable by `grep data-action`).
   */
  dataAction?: string;
  /** Needed when the row anchors a submenu (a `Popover mode="fixed"` wants its rect). */
  rowRef?: React.RefObject<HTMLElement | null>;
}

export function MenuRow({
  title,
  hint,
  icon: Icon,
  right,
  onClick,
  href,
  selected,
  danger,
  disabled,
  note,
  type = "button",
  className,
  rowRole = "menuitem",
  ariaChecked,
  dataAction,
  rowRef,
}: MenuRowProps) {
  const inner = (
    <>
      {Icon ? (
        <span className="bw-menu-row__icon" aria-hidden>
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{title}</span>
        {(hint || note) && (
          <span className="mt-0.5 block truncate text-[11px] leading-snug opacity-55">
            {disabled && note ? note : hint}
          </span>
        )}
      </span>
      {selected ? (
        <svg
          className="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : right ? (
        <span className="ml-auto shrink-0 pl-2 text-[11px] opacity-50">{right}</span>
      ) : null}
    </>
  );

  const cls = clsx("bw-menu-row", danger && "bw-menu-row--danger", disabled && "is-disabled", className);

  if (href && !disabled) {
    return (
      <a
        href={href}
        ref={intoRowRef(rowRef)}
        className={cls}
        data-action={dataAction}
        data-bw-menu-item
        role="menuitem"
        aria-current={selected ? "true" : undefined}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type={type}
      ref={intoRowRef(rowRef)}
      className={cls}
      data-action={dataAction}
      data-bw-menu-item
      role={rowRole}
      // aria-disabled, not the attribute: a row that is switched off must still be
      // focusable, or the `note` explaining WHY (plan limit, nothing attached) is the
      // one thing a keyboard or screen-reader user can never read.
      aria-disabled={disabled || undefined}
      aria-current={selected && rowRole !== "option" ? "true" : undefined}
      aria-selected={selected && rowRole === "option" ? true : undefined}
      aria-checked={rowRole === "option" ? !!ariaChecked || !!selected : undefined}
      title={disabled && note ? note : undefined}
      onClick={disabled ? undefined : onClick}
    >
      {inner}
    </button>
  );
}

/** 1px separator between menu groups. Follows the surface it sits on. */
export function MenuDivider({ className }: { className?: string }) {
  return <div role="separator" aria-hidden className={clsx("bw-menu-divider", className)} />;
}

/** Group heading inside a menu ("Workspace", "Account") — not focusable, not a row. */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="bw-menu-label">{children}</div>;
}
