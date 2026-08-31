/**
 * Pure geometry for `lib/ui/Popover.tsx`, split out on purpose: "does this panel fit
 * below, should it flip above, how tall may it be" is the whole behaviour of a menu,
 * and it is the part a browser-less test *can* prove. Nothing in this file touches
 * `window` or the DOM — the caller measures a rect and passes numbers in.
 *
 * Two functions:
 *   placePanel()       for mode="fixed" (returns viewport coordinates to apply)
 *   clampViewport()    for mode="absolute" (the panel positions itself with CSS, so
 *                      the only thing to decide is how tall it may get)
 *
 * The rules, in one place so every menu in the app obeys them:
 *   - open where the caller asked, unless the panel would overflow *and* the opposite
 *     side both has room and has more of it;
 *   - never flip for a panel that would not fit either way — a scrolling menu is
 *     better than one that jumps sideways mid-list;
 *   - clamp the cross axis into the viewport with a gutter rather than letting it
 *     hang off the edge;
 *   - give up height, never width: leftover room becomes max-height so the list
 *     scrolls, with MIN_H so a 3-row menu can't be crushed to nothing on a short
 *     viewport.
 */

export type Placement = "below" | "above" | "right" | "left";
export type Align = "start" | "end" | "center";

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface PlaceInput {
  want: Placement;
  align?: Align;
  trigger: Rect;
  panelW: number;
  /** 0 while the panel has not been measured yet — the caller re-runs after paint. */
  panelH: number;
  vw: number;
  vh: number;
  offset?: number;
  gutter?: number;
  maxHeight?: number;
  minH?: number;
}

export interface Placed {
  placement: Placement;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxH: number;
}

export const DEFAULTS = { offset: 8, gutter: 8, maxHeight: 340, minH: 140 } as const;

export const flipOf = (p: Placement): Placement =>
  p === "below" ? "above" : p === "above" ? "below" : p === "right" ? "left" : "right";

/** Free room in direction `p` between the trigger and the viewport edge. */
export function roomFor(p: Placement, t: Rect, vw: number, vh: number, offset: number, gutter: number) {
  switch (p) {
    case "below":
      return vh - t.bottom - offset - gutter;
    case "above":
      return t.top - offset - gutter;
    case "right":
      return vw - t.right - offset - gutter;
    case "left":
      return t.left - offset - gutter;
  }
}

export function placePanel(input: PlaceInput): Placed {
  const {
    want,
    align = "start",
    trigger: t,
    panelW,
    panelH,
    vw,
    vh,
    offset = DEFAULTS.offset,
    gutter = DEFAULTS.gutter,
    maxHeight = DEFAULTS.maxHeight,
    minH = DEFAULTS.minH,
  } = input;

  const room = (p: Placement) => roomFor(p, t, vw, vh, offset, gutter);

  let placement = want;
  if (panelH > room(want)) {
    const other = flipOf(want);
    if (room(other) > room(want) && panelH <= room(other)) placement = other;
  }

  const vertical = placement === "below" || placement === "above";
  const crossSize = vertical ? panelW : panelH;
  const crossStart = vertical
    ? align === "end"
      ? t.right - panelW
      : align === "center"
        ? t.left + t.width / 2 - panelW / 2
        : t.left
    : align === "end"
      ? t.bottom - panelH
      : align === "center"
        ? t.top + t.height / 2 - panelH / 2
        : t.top;

  const out: Placed = { placement, maxH: maxHeight };

  if (placement === "below") out.top = t.bottom + offset;
  if (placement === "above") out.bottom = vh - t.top + offset;
  if (placement === "right") out.left = t.right + offset;
  if (placement === "left") out.right = vw - t.left + offset;

  if (vertical) {
    let left = crossStart;
    if (left + panelW > vw - gutter) left = Math.max(gutter, vw - gutter - panelW);
    if (left < gutter) left = gutter;
    out.left = left;
    out.maxH = Math.max(minH, Math.min(maxHeight, room(placement)));
  } else {
    let top = crossStart;
    if (top + crossSize > vh - gutter) top = Math.max(gutter, vh - gutter - crossSize);
    if (top < gutter) top = gutter;
    out.top = top;
  }

  return out;
}

/**
 * Absolute mode: CSS does the positioning, so the only decision is a height. Returns
 * the max-height to apply, or null when the panel already fits.
 */
export function clampViewport(opts: {
  panelTop: number;
  panelBottom: number;
  vh: number;
  maxHeight?: number;
  gutter?: number;
  minH?: number;
}): number | null {
  const { panelTop, panelBottom, vh } = opts;
  const maxHeight = opts.maxHeight ?? DEFAULTS.maxHeight;
  const gutter = opts.gutter ?? DEFAULTS.gutter;
  if (panelBottom <= vh - gutter) return null;
  const space = vh - panelTop - gutter;
  if (space >= maxHeight) return null; // still fits within its own limit
  // No floor here on purpose: the caller cannot move an absolutely positioned panel,
  // so a cramped viewport means "show the first rows, scroll the rest" — which beats
  // letting the menu hang off the bottom of the screen unreachable.
  return Math.max(0, space);
}
