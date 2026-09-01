"use client";

/**
 * The app's one button, moved verbatim out of app/page.tsx so the extracted composer
 * (and every popover trigger in Steps 4-9) can reuse it instead of hand-rolling a
 * styled <button> per site - which is how a shared control ends up with four different
 * focus states. Added in Step 2: the three ARIA attributes a menu trigger has to
 * expose, typed here so no caller has to invent them again.
 */
import clsx from "clsx";
export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  size = "md",
  className,
  type = "button",
  style,
  title,
  "aria-label": al,
  "aria-expanded": ae,
  "aria-controls": ac,
  "aria-haspopup": ah,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "ink" | "icon" | "soft";
  size?: "sm" | "md" | "lg";
  className?: string;
  type?: "button" | "submit";
  style?: React.CSSProperties;
  title?: string;
  "aria-label"?: string;
  /** Menu triggers must expose these; typed here so every later step can reuse Btn. */
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-haspopup"?: "menu" | "dialog" | "listbox";
}) {
  const base =
    variant === "primary"
      ? { background: "var(--accent)" }
      : variant === "ink"
        ? { background: "var(--ink)", color: "var(--bg)" }
        : variant === "soft"
          ? { background: "var(--accent-soft)", color: "var(--accent)" }
          : variant === "ghost"
            ? {
                borderColor: "var(--border)",
                background: "var(--card)",
                color: "var(--ink)",
              }
            : { color: "var(--muted)" };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={al}
      aria-expanded={ae}
      aria-controls={ac}
      aria-haspopup={ah}
      title={title || al}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "rounded-2xl text-white shadow-sm",
        variant === "ghost" && "rounded-2xl border",
        variant === "ink" && "rounded-2xl",
        variant === "soft" && "rounded-2xl",
        variant === "icon" && "rounded-xl",
        size === "sm" && variant !== "icon" && "h-9 px-3.5 text-sm",
        size === "md" && variant !== "icon" && "h-10 px-4 text-sm",
        size === "lg" && variant !== "icon" && "h-12 px-5 text-[15px]",
        variant === "icon" && (size === "sm" ? "h-8 w-8" : "h-10 w-10"),
        className
      )}
      style={style ? { ...base, ...style } : base}
    >
      {children}
    </button>
  );
}
