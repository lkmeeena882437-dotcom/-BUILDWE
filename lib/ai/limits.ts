import { LIMITS } from "@/lib/config";
import { bumpUsage, getUsage, type Plan } from "@/lib/db/store";

export function checkLimit(
  userId: string,
  plan: Plan,
  feature: "chat" | "code" | "image" | "audio"
): { ok: boolean; used: number; max: number; message?: string } {
  const u = getUsage(userId);

  // Chat: soft fair-use only (high ceiling)
  if (feature === "chat") {
    const max = plan === "pro" ? 2000 : 400;
    if (u.chat >= max) {
      return {
        ok: false,
        used: u.chat,
        max,
        message: "You've hit today's free chat pace. Come back tomorrow — or go PRO for more room.",
      };
    }
    return { ok: true, used: u.chat, max };
  }

  if (plan === "pro") {
    const max =
      feature === "code"
        ? LIMITS.pro.codeMonthly
        : feature === "image"
          ? LIMITS.pro.imageMonthly
          : LIMITS.pro.audioMonthly;
    const used = u[feature];
    // monthly treated as daily*soft for free file db simplicity — still generous
    if (used >= max) {
      return { ok: false, used, max, message: "You've hit today's PRO pace. Try again tomorrow." };
    }
    return { ok: true, used, max };
  }

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
      message: `Free plan daily limit reached for this tool. PRO unlocks higher volume.`,
    };
  }
  return { ok: true, used, max };
}

export function recordUsage(
  userId: string,
  feature: "chat" | "code" | "image" | "audio"
) {
  return bumpUsage(userId, feature, 1);
}
