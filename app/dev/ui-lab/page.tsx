/**
 * UI-lab: a real, clickable page that mounts the `lib/ui` primitives together before
 * the app's own surfaces do. It exists so Step 1 of the UI plan can be verified by a
 * person (hover, Escape, focus return, flip near the viewport edge, indicator
 * re-measure) instead of by "the types compile".
 *
 * It is not part of the product: no link points at it, it is noindex, it is 404 in
 * production, and it renders
 * no marketing copy, no API calls and no state outside itself. Steps 2-9 replace it
 * with the real surfaces; it stays until then as the reference for how each primitive
 * is meant to be wired.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lab } from "./Lab";

export const metadata: Metadata = {
  title: "UI lab — BUILDWE",
  robots: { index: false, follow: false },
};

export default function UiLabPage() {
  // A component bench with no product value and no auth in front of it. Serving it in
  // production would publish the internals of `lib/ui` and give crawlers a page to
  // index that the app never links to. `notFound()` rather than a redirect: the URL
  // should look like it does not exist, because for customers it does not.
  if (process.env.NODE_ENV === "production") notFound();
  return <Lab />;
}
