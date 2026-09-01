import { Btn } from "@/lib/ui/Btn";

/**
 * The state where a list has nothing in it yet.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Three surfaces in this app could show "nothing", and each handled it differently: the sidebar's
 * history list and the phone drawer's copy of it showed *literally nothing* — a blank column, no
 * sentence, no hint that the thing you just did (sending a message) is what fills it — and the
 * creations panel showed a bordered paragraph. A blank pane next to a working app reads as "broken",
 * which is the one thing an empty state must not communicate. So: one layout, one drawing style,
 * three surfaces, and each surface keeps its own words, because "no chats yet", "nothing matches
 * that search" and "this project is empty" are three different truths.
 *
 * WHY INLINE SVG AND NO IMAGE FILE
 * --------------------------------
 * No new dependency and no asset: the drawings are ~15 strokes of `currentColor`, so they follow the
 * theme (light, dark, the dark sheet) with no second copy of any colour, they stay crisp at any
 * pixel ratio, and they cost the page nothing over the wire — a PNG of the same thing would be a
 * network request inside a panel that is only visible when you have *no* data. It also means the art
 * can be reviewed in the diff instead of as a binary.
 *
 * The drawing is `aria-hidden`: a screen reader gets the sentence, and a decorative shape announced
 * as "image" is noise in exactly the situation where someone most needs the sentence to be clean.
 */

export type EmptyArt = "chats" | "creations" | "files";

const ART: Record<EmptyArt, React.ReactNode> = {
  /* A thread: one bubble answered by another. The faint one sits behind on purpose — an empty chat
     list is about the *reply*, not about an input box. */
  chats: (
    <>
      <rect x="40.5" y="7.5" width="52" height="25" rx="8" opacity="0.28" />
      <rect x="27.5" y="24.5" width="66" height="32" rx="10" />
      <path d="M40 56.5v7l8-7" opacity="0.6" />
      <path d="M38 36h44M38 44h28" opacity="0.55" />
    </>
  ),
  /* Three kinds, one row each — the same list the panel filters by. The waveform is bars rather
     than a squiggle so it still reads at 120px wide. */
  creations: (
    <>
      <rect x="6.5" y="9.5" width="34" height="26" rx="6" />
      <path d="M12 28l6-7 5 5 4-4 6 6" opacity="0.55" />
      <rect x="46.5" y="9.5" width="24" height="26" rx="6" opacity="0.28" />
      <path d="M52 19v7M57 15v15M62 21v4" opacity="0.5" />
      <rect x="76.5" y="9.5" width="38" height="26" rx="6" opacity="0.28" />
      <path d="M83 18h25M83 25h16" opacity="0.5" />
      <path d="M14 45h92" opacity="0.22" />
      <path d="M22 53h76" opacity="0.16" />
    </>
  ),
  /* A page lifted out of a folder: the project files panel's whole job in two shapes. */
  files: (
    <>
      <path d="M28 46h58a6 6 0 0 0 6-6V22a6 6 0 0 0-6-6H46l-6-6H28a6 6 0 0 0-6 6v24a6 6 0 0 0 6 6Z" opacity="0.3" />
      <path d="M46 18h32a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H46a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5Z" />
      <path d="M50 30h24M50 37h16" opacity="0.5" />
    </>
  ),
};

export interface EmptyStateProps {
  art: EmptyArt;
  /** What is missing, in one line. Written by the caller: only it knows which of its states this is. */
  title: string;
  /** Why, or what to do — the difference between an empty state and a shrug. */
  children?: React.ReactNode;
  /** The one action that fixes it, on the shared `Btn` so it is a real button everywhere. */
  action?: { label: string; onClick: () => void };
  /** For panels on the dark surface, which has no `--card` to sit on. */
  dark?: boolean;
  /** Narrow columns (the sidebar, the drawer): smaller drawing, no border. */
  compact?: boolean;
  /** Rendered as `data-empty`, the marker the suites assert on — a surface's own name. */
  marker?: string;
}

export function EmptyState({ art, title, children, action, dark, compact, marker }: EmptyStateProps) {
  return (
    <div
      data-empty={marker}
      className={compact ? "px-2 py-5 text-center" : "mt-4 rounded-2xl border p-4 text-center"}
      /* The dark variant reads the `--surface-dark-*` tokens rather than inventing rgba: those are
         what step 6's lesson was about — a panel on the dark surface must not inherit the page's
         light-theme values from the DOM, and hard-coded white alphas are the same mistake twice. */
      style={{
        borderColor: dark ? "var(--surface-dark-border)" : "var(--border)",
        color: dark ? "var(--surface-dark-muted)" : "var(--muted)",
      }}
    >
      <svg
        viewBox="0 0 120 68"
        className={compact ? "mx-auto h-10 w-auto" : "mx-auto h-14 w-auto"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {ART[art]}
      </svg>
      <p className={`${compact ? "mt-2 text-[11px]" : "mt-2.5 text-xs"} font-semibold`} style={{ color: dark ? "var(--surface-dark-fg)" : "var(--ink)" }}>
        {title}
      </p>
      {children ? (
        <p className={`mx-auto ${compact ? "mt-1 max-w-[220px] text-[10.5px]" : "mt-1 max-w-[34ch] text-[11px]"} leading-snug`}>{children}</p>
      ) : null}
      {action ? (
        <div className="mt-2.5">
          <Btn size="sm" variant={dark ? "ghost" : "soft"} onClick={action.onClick}>
            {action.label}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
