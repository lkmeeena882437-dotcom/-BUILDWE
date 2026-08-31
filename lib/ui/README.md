# `lib/ui` — shared popover primitives

Built for Wave 10 (UI plan, Step 1). Everything here exists so that Steps 2–9 (composer
pill, attachment menu, mode picker, sidebar flyout, pricing toggle, auth modal) do not each
invent their own click-away, their own flip logic and their own reduced-motion handling.

There is **no dependency** here and none will be added: the app's bundle size is a feature,
and a headless-UI package would replace ~300 lines we now own with ~30k we don't.

## What is here

| File | What it owns |
|---|---|
| `useDismiss.ts` | Escape, outside-`pointerdown`, focus return, nested-submenu pausing, `menuTriggerProps()` for the ARIA a trigger must expose, `useMenuKeys()` for ↓ ↑ Home End Tab inside a `role="menu"` |
| `Popover.tsx` | Positioning (below/above/right/left), flip and viewport clamp, the dark/light surface, `overflow` scrolling, and — deliberately — the dismissal itself, since it already receives `open` + `onClose` |
| `placement.ts` | The geometry as a pure function. No `window`, no DOM. This is why `tests/ui.mjs` can prove flip/clamp behaviour in a sandbox with no browser |
| `MenuRow.tsx` | One menu row: icon · title · muted hint, `data-action`, `disabled` + `note`, `selected`, `danger`; plus `MenuDivider` / `MenuLabel` |
| `SegmentedControl.tsx` | Sliding indicator (measured, not flex-guessed), roving tabIndex, arrows activate directly, re-measures on container resize and on `document.fonts.ready` |
| `internal.ts` | `useIsoLayoutEffect` (no SSR warning) + `px()` |

## Conventions a caller must keep

- **A closed popover renders nothing.** `Popover` returns `null` when `open` is false, so its
  rows can never be tabbed into or scraped. Do not "optimise" this with `hidden`.
- **One open menu at a time.** That is what lets a parent accept *any*
  `[data-bw-popover-submenu]` as "inside" (`allowSubmenus`) instead of threading a ref
  through the row that opened the child. While a submenu is open the parent passes
  `pause`, so Escape closes one level, not the whole menu.
- **Rows must do something.** `data-action` is on `MenuRow` so `tests/ui.mjs` can assert that
  every row in a shipped menu maps to a handler or route that exists. A row whose backend
  is missing is not added; it waits.
- **No scroll lock.** A popover is not a modal; the page stays scrollable under it.
  (`Sheet` keeps its own lock — that one is a modal.)
- **Colour comes from tokens**, never a hex literal: `--surface-dark*` for the dark surface,
  and hover/divider/groove alpha from `color-mix(in srgb, currentColor N%, transparent)` so the
  same row is correct on a dark flyout and on a light panel.
- **Absolute vs fixed**: use `mode="absolute"` unless the trigger sits in a scroll container
  or next to `overflow-hidden` — then `mode="fixed"` + `anchorRef`. Fixed escapes the clip and
  can flip; absolute is cheaper and never needs a re-measure.

## `app/dev/ui-lab` — why it exists and what happens to it

`/dev/ui-lab` is a real page that mounts these primitives together: a drop-up composer menu, a
fixed flyout anchored inside a clipped box with a cascading Theme submenu, and the segmented
control on both surfaces — each with a *log geometry* button that prints what the DOM actually
did, plus a keyboard-only checklist. It exists because "the types compile" is not evidence that
focus returns or that a panel flips.

It is noindex, unlinked, calls no API and mutates no app state. Steps 2–9 will each take a
shape from it into the real UI; Step 11 decides whether the page survives as a design reference
(one `rm -r app/dev` if not).
