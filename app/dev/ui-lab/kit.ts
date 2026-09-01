/**
 * Shared bits for the lab's own cards. They used to be pasted into each lab file, which is
 * the exact duplication the reuse contract in docs/internal/UI_UPGRADE_PLAN.md exists to stop - a dev
 * surface should not model the habit of copying a style string and letting two versions drift.
 */
export const card = "rounded-[var(--radius)] border p-4 ";

export const cardStyle = {
  borderColor: "var(--border)",
  background: "var(--card)",
} as const;

export const smallBtn = "inline-flex h-9 w-9 items-center justify-center rounded-xl border ";

export type Log = (msg: string) => void;
