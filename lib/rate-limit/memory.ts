/** Simple in-memory rate limit — free, no Redis required. */

type Bucket = { count: number; reset: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; remaining: number; retryAfterMs?: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: b.reset - now };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count };
}

/**
 * Legacy helper — kept for logging and for `safeIp()` in ./guard.ts.
 *
 * Do NOT build a rate-limit key from this on its own: the first
 * `x-forwarded-for` entry is attacker-controlled whenever no trusted proxy
 * normalises it, which is exactly how the old `reg:${ip}` bucket was evaded
 * (audit C3). Use `safeIp()`/`limitSignup()`/`limitLogin()` instead.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const xf = h.get("x-forwarded-for")?.split(",");
  if (!xf?.length) return h.get("x-real-ip")?.trim() || "unknown";
  // With N trusted proxy hops, the Nth entry from the RIGHT is the last thing
  // our own infrastructure appended. From the left it is whatever the client
  // typed. Reverse-chain reading is what makes rotation useless.
  const hops = Number(process.env.TRUST_PROXY_HOPS || (process.env.VERCEL === "1" ? 1 : 0));
  if (!hops) return "anon";
  const idx = Math.max(0, xf.length - hops);
  return xf[idx]?.trim() || "anon";
}
