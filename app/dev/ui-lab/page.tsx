/**
 * UI-lab: a real, clickable page that mounts the `lib/ui` primitives together before
 * the app's own surfaces do. It exists so Step 1 of the UI plan can be verified by a
 * person (hover, Escape, focus return, flip near the viewport edge, indicator
 * re-measure) instead of by "the types compile".
 *
 * It is not part of the product: no link points at it, it is noindex, and it renders
 * no marketing copy, no API calls and no state outside itself. Steps 2-9 replace it
 * with the real surfaces; it stays until then as the reference for how each primitive
 * is meant to be wired.
 */
import type { Metadata } from "next";
import { Lab } from "./Lab";

export const metadata: Metadata = {
  title: "UI lab — BUILDWE",
  robots: { index: false, follow: false },
};

export default function UiLabPage() {
  return <Lab />;
}
