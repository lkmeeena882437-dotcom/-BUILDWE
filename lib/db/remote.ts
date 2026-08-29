/**
 * Optional permanent-DB mirror — Supabase REST (no SDK needed).
 *
 * Activates ONLY when both env vars are set:
 *   NEXT_PUBLIC_SUPABASE_URL      e.g. https://xyz.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service role key (server-only!)
 *
 * One-time SQL (Supabase SQL editor):
 *   create table if not exists buildwe_kv (
 *     k text primary key,
 *     v jsonb not null,
 *     updated_at timestamptz default now()
 *   );
 *   alter table buildwe_kv enable row level security; -- service role bypasses RLS
 *
 * Strategy: whole DB as one JSON document, last-write-wins.
 * Good enough for single-writer / low-traffic deployments; swap for
 * per-table rows when concurrency matters.
 */
import type { DB } from "./store";

function cfg() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key, ok: Boolean(url && key) };
}

export function remoteDbEnabled() {
  return cfg().ok;
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** Pull the persisted snapshot (null when unavailable). */
export async function pullRemoteDb(): Promise<DB | null> {
  const { url, key, ok } = cfg();
  if (!ok) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_kv?select=v&k=eq.main`,
      { headers: headers(key), cache: "no-store" }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { v: DB }[];
    const v = rows?.[0]?.v;
    if (!v || typeof v !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

/** Push the snapshot (best-effort, upsert). */
export async function pushRemoteDb(db: DB): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok) return false;
  try {
    const res = await fetch(`${url}/rest/v1/buildwe_kv`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ k: "main", v: db }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
