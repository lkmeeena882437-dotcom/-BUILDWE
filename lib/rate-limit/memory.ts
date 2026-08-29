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

export function clientIp(req: Request): string {
  const h = req.headers;
  const xf = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xf || h.get("x-real-ip") || "unknown";
}
