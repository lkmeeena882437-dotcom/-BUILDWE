/**
 * BUILDWE durable rate limiting — shared counters across every instance.
 *
 * WHY
 * ---
 * `lib/rate-limit/memory.ts` keeps buckets in a process-local Map. That is
 * fine for one long-lived server, but on serverless every instance gets its
 * own Map, so a caller spreading requests across instances multiplies their
 * effective limit, and every deploy or cold start resets everyone's counters.
 *
 * NO SECOND SERVICE NEEDED
 * ------------------------
 * The usual answer is Redis (Upstash), but that is another vendor and another
 * bill. If Supabase is configured we already have a Postgres, so the counter
 * lives there via an atomic `buildwe_rate_hit()` function — the whole
 * check-and-increment happens in one statement, which is what makes it
 * correct when two requests arrive at once.
 *
 * DEGRADES SAFELY
 * ---------------
 * With no Supabase configured, or if the database is briefly unreachable,
 * this transparently falls back to the in-memory limiter. Rate limiting must
 * never be the reason a request fails, so the fallback is fail-open to the
 * local counter rather than fail-closed.
 */

import { rateLimit as memoryRateLimit } from "./memory";

type Result = { ok: boolean; remaining: number; retryAfterMs?: number };

function cfg() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key, ok: Boolean(url && key) };
}

export function durableRateLimitAvailable(): boolean {
  return cfg().ok;
}

/**
 * Shared-counter rate limit. Same signature as the in-memory limiter so call
 * sites can switch with no other changes.
 */
export async function rateLimitDurable(
  key: string,
  limit: number,
  windowMs: number
): Promise<Result> {
  const { url, key: serviceKey, ok } = cfg();

  if (!ok) return memoryRateLimit(key, limit, windowMs);

  try {
    const res = await fetch(`${url}/rest/v1/rpc/buildwe_rate_hit`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_key: key.slice(0, 200),
        p_limit: limit,
        p_window_ms: windowMs,
      }),
      cache: "no-store",
      // A rate limiter must be fast or irrelevant — never let it add latency.
      signal: AbortSignal.timeout(2_000),
    });

    if (!res.ok) return memoryRateLimit(key, limit, windowMs);

    const rows = (await res.json()) as
      | { allowed: boolean; remaining: number; reset_at: string }[]
      | { allowed: boolean; remaining: number; reset_at: string };

    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || typeof row.allowed !== "boolean") {
      return memoryRateLimit(key, limit, windowMs);
    }

    const retryAfterMs = Math.max(
      0,
      new Date(row.reset_at).getTime() - Date.now()
    );

    return {
      ok: row.allowed,
      remaining: Math.max(0, row.remaining ?? 0),
      ...(row.allowed ? {} : { retryAfterMs }),
    };
  } catch {
    // Network hiccup, timeout, cold database — fall back rather than 500.
    return memoryRateLimit(key, limit, windowMs);
  }
}
