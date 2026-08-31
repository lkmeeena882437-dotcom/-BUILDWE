/**
 * Identity-aware throttling for the endpoints that must not be farmed.
 *
 * WHY THIS EXISTS (audit C3, 2026-08-31)
 * --------------------------------------
 * Signup used to be limited by `rateLimit(`reg:${clientIp(req)}`, 10, 60_000)`
 * and `clientIp` trusted the FIRST value of `x-forwarded-for` — a header the
 * caller controls. 26 signups in a row all returned 201 because every request
 * just claimed a new fake IP, and only 1 of 30 was ever blocked. An open
 * signup form with no working flood brake is a bot farm with our bill on it.
 *
 * THE RULE
 * --------
 * An IP is only a usable identity when it comes from something we control.
 *  • Behind Vercel/Cloudflare (1 trusted hop) the platform sets the header, so
 *    the FIRST entry is the real client — trust it.
 *  • With no trusted proxy (`TRUST_PROXY_HOPS=0`, the default for a bare
 *    Node/nginx deploy) the header is whatever the client typed. We then fall
 *    back to `x-real-ip` only if the operator said nginx sets it, and
 *    otherwise treat every request as the SAME anonymous bucket, which is
 *    strict but unforgeable.
 *
 * And for anything that has a credential (email, api key, session id), the
 * credential is the primary key — rotating an IP must never buy quota.
 */

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { TRUST_PROXY_HOPS } from "@/lib/config";
import { clientIp } from "./memory";
import { rateLimitDurable } from "./durable";

/** Stable, non-reversible bucket label for an email. */
export function emailKey(email: string): string {
  const norm = email.trim().toLowerCase();
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

/** IP as seen through a proxy chain we control; "anon" when unforgeable-only. */
export function safeIp(req: Request): string {
  if (TRUST_PROXY_HOPS > 0) return clientIp(req) || "anon";
  // No trusted proxy: x-forwarded-for is attacker-chosen. x-real-ip is set by
  // a well-configured nginx, so it is usable; otherwise don't key on IP at all.
  return req.headers.get("x-real-ip")?.trim() || "anon";
}

type Verdict = { ok: true } | { ok: false; error: string; hint: string };

function deny(retryAfterMs?: number, what = "attempts"): Verdict {
  const secs = Math.max(1, Math.ceil((retryAfterMs || 60_000) / 1000));
  return {
    ok: false,
    error: `Too many ${what} from here — please wait about ${secs}s.`,
    hint: `This limit exists to stop automated account creation${
      what === "password attempts" ? " and password guessing" : ""
    }. If it keeps happening, contact us and we'll sort it out.`,
  };
}

/**
 * Signup: per-email (2/day), per-IP (5/hour), and one global counter so a
 * distributed bot-net still hits a wall. Limits are generous for a human.
 */
function num(name: string, fallback: number): number {
  const v = Number(process.env[name] || "");
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export async function limitSignup(req: NextRequest, email: string): Promise<Verdict> {
  const ip = safeIp(req);
  const day = new Date().toISOString().slice(0, 10);
  const checks = await Promise.all([
    rateLimitDurable(
      `reg:email:${emailKey(email)}`,
      num("SIGNUPS_PER_EMAIL_PER_DAY", 2),
      24 * 3600_000
    ),
    rateLimitDurable(`reg:ip:${ip}`, num("SIGNUPS_PER_IP_PER_HOUR", 25), 3600_000),
    rateLimitDurable(
      `reg:global:${day}`,
      num("SIGNUPS_PER_DAY_MAX", 500),
      24 * 3600_000
    ),
  ]);
  const bad = checks.find((c) => !c.ok);
  return bad ? deny(bad.retryAfterMs) : { ok: true };
}

/** Login: the account is the primary key, so an IP rotation cannot unlock throttling. */
export async function limitLogin(req: NextRequest, email: string): Promise<Verdict> {
  const ip = safeIp(req);
  const checks = await Promise.all([
    rateLimitDurable(
      `login:email:${emailKey(email)}`,
      num("LOGIN_ATTEMPTS_PER_ACCOUNT_15MIN", 12),
      15 * 60_000
    ),
    rateLimitDurable(`login:ip:${ip}`, num("LOGIN_ATTEMPTS_PER_IP_MIN", 40), 60_000),
  ]);
  const bad = checks.find((c) => !c.ok);
  return bad ? deny(bad.retryAfterMs, "password attempts") : { ok: true };
}

/**
 * AI work: keyed on the account/guest identity, never on the IP. `limit` is
 * per window, and `burst` (optional) caps concurrent fan-out routes.
 */
export async function limitAi(
  scope: string,
  identity: string,
  limit: number,
  windowMs: number
): Promise<Verdict> {
  const rl = await rateLimitDurable(`ai:${scope}:${identity}`, limit, windowMs);
  return rl.ok ? { ok: true } : deny(rl.retryAfterMs);
}

export { rateLimitDurable };
