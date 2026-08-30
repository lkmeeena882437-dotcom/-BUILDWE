import { LIMITS } from "@/lib/config";
import { bumpUsage, getUsage, getMonthlyUsage, type Plan } from "@/lib/db/store";

/**
 * Server-side usage enforcement (Update #1 §6).
 *
 * All limits live here and are checked on the server before any paid work
 * happens — the client cannot bypass them by editing state (§6.7).
 *
 * Free  → daily windows (resets each day, keeps the free tier usable).
 * PRO   → genuine MONTHLY windows. Previously PRO's "monthly" ceilings were
 *         compared against today's counter only, so e.g. PRO_CODE_MONTHLY_LIMIT
 *         =500 actually allowed 500 per DAY (~15,000/month). Now a real
 *         calendar-month total is summed (§6.2).
 */

export type Feature = "chat" | "code" | "image" | "audio";

/** Daily fair-use ceiling for chat (high — chat is the core experience). */
const CHAT_DAILY = { free: 400, pro: 2000 } as const;

export function checkLimit(
  userId: string,
  plan: Plan,
  feature: Feature
): {
  ok: boolean;
  used: number;
  max: number;
  message?: string;
  window?: "day" | "month";
} {
  // Chat: soft daily fair-use for both plans.
  if (feature === "chat") {
    const u = getUsage(userId);
    const max = plan === "pro" ? CHAT_DAILY.pro : CHAT_DAILY.free;
    if (u.chat >= max) {
      return {
        ok: false,
        used: u.chat,
        max,
        window: "day",
        message:
          plan === "pro"
            ? "You've hit today's PRO chat pace. It resets tomorrow."
            : "You've hit today's free chat pace. Come back tomorrow — or go PRO for more room.",
      };
    }
    return { ok: true, used: u.chat, max, window: "day" };
  }

  if (plan === "pro") {
    // Real calendar-month window for PRO allowances.
    const max =
      feature === "code"
        ? LIMITS.pro.codeMonthly
        : feature === "image"
          ? LIMITS.pro.imageMonthly
          : LIMITS.pro.audioMonthly;
    const used = getMonthlyUsage(userId)[feature];
    if (used >= max) {
      return {
        ok: false,
        used,
        max,
        window: "month",
        message:
          "You've used this month's PRO allowance for this tool. It resets on the 1st.",
      };
    }
    return { ok: true, used, max, window: "month" };
  }

  // Free: daily windows.
  const u = getUsage(userId);
  const max =
    feature === "code"
      ? LIMITS.free.codeDaily
      : feature === "image"
        ? LIMITS.free.imageDaily
        : LIMITS.free.audioDaily;
  const used = u[feature];
  if (used >= max) {
    return {
      ok: false,
      used,
      max,
      window: "day",
      message: `Free plan daily limit reached for this tool. PRO unlocks higher volume.`,
    };
  }
  return { ok: true, used, max, window: "day" };
}

export function recordUsage(userId: string, feature: Feature) {
  return bumpUsage(userId, feature, 1);
}
