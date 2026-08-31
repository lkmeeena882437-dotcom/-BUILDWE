"use client";

/**
 * `useLayoutEffect` prints a warning when it runs during server rendering — and
 * Next renders these client components on the server first, so every popover would
 * add a console warning to every page load. Swap it for `useEffect` when there is no
 * DOM. (Same shape as the idiom in useFloating/popper libraries, five lines here.)
 */
import { useEffect, useLayoutEffect } from "react";

export const useIsoLayoutEffect: typeof useLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Numeric px for a CSS length, so callers can pass `240` or `"min(90vw,320px)"`. */
export function px(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? `${v}px` : v;
}
