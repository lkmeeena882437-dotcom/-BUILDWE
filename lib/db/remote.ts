/**
 * Optional permanent-DB mirror — Supabase REST (no SDK needed).
 *
 * Activates ONLY when both env vars are set:
 *   NEXT_PUBLIC_SUPABASE_URL      e.g. https://xyz.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service role key (server-only!)
 *
 * Three shapes live here:
 *   1. `buildwe_kv` (k='main') — whole-DB snapshot. Pushes now merge with
 *      whatever is already stored so a cold instance cannot erase everyone
 *      else. Still a fallback for collections that are not yet per-row.
 *   2. `buildwe_conversations` — one row per chat, keyed by `user_id`.
 *   3. `buildwe_owned` — one row per account/project/payment/wallet, keyed
 *      by (kind, id) and filtered by `user_id`. This is production billing
 *      and identity; the JSON file is a dev/test fallback only.
 *
 * Types here are structural copies of `store.ts` so this module stays
 * importable (and testable) without pulling the JSON store in.
 */

export type Conversation = {
  id: string;
  userId: string;
  mode: string;
  title: string;
  messages: unknown[];
  projectId?: string | null;
  teamId?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Whole-DB snapshot stored in `buildwe_kv`. Only the keys we merge are typed. */
export type DB = {
  users?: unknown[];
  conversations?: Conversation[];
  generations?: unknown[];
  usage?: unknown[];
  projects?: unknown[];
  projectFiles?: unknown[];
  shares?: unknown[];
  payments?: unknown[];
  wallets?: unknown[];
  creditLedger?: unknown[];
  apiKeys?: unknown[];
  teams?: unknown[];
  passwordResets?: unknown[];
  consumedTokens?: unknown[];
  linkPreviews?: unknown[];
};

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

const REMOTE_MS = 3_000;

function timed(init: RequestInit = {}): RequestInit {
  return { ...init, cache: "no-store", signal: AbortSignal.timeout(REMOTE_MS) };
}

/** Pull the persisted snapshot (null when unavailable). */
export async function pullRemoteDb(): Promise<DB | null> {
  const { url, key, ok } = cfg();
  if (!ok) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_kv?select=v&k=eq.main`,
      timed({ headers: headers(key) })
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

/**
 * Union two snapshots by record id. A cold instance's empty arrays must not
 * replace rows that already exist remotely; a local-only row must not be
 * dropped by an older blob. Conversations keep the message-aware picker.
 */
export function mergeDbSnapshots(left: DB, right: DB): DB {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const out: Record<string, unknown> = { ...(left || {}) };
  for (const k of keys) {
    const a = Array.isArray((left as Record<string, unknown>)?.[k])
      ? ((left as Record<string, unknown>)[k] as Record<string, unknown>[])
      : [];
    const b = Array.isArray((right as Record<string, unknown>)?.[k])
      ? ((right as Record<string, unknown>)[k] as Record<string, unknown>[])
      : [];
    if (k === "conversations") {
      const la = a.map((x) => asConversation(x)).filter(Boolean) as Conversation[];
      const ra = b.map((x) => asConversation(x)).filter(Boolean) as Conversation[];
      out[k] = mergeConversationLists(la, ra).next;
      continue;
    }
    out[k] = mergeRecordLists(k, a, b).next;
  }
  return out as DB;
}

function recordId(col: string, rec: Record<string, unknown>): string {
  if (col === "usage") return `${String(rec.userId || "")}|${String(rec.day || "")}`;
  if (col === "wallets") return String(rec.userId || "");
  if (col === "linkPreviews") return String(rec.key || "");
  const id = rec.id;
  return typeof id === "string" && id ? id : "";
}

function newerStamp(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const at = String(a.updatedAt || a.createdAt || "");
  const bt = String(b.updatedAt || b.createdAt || "");
  return bt > at;
}

export function mergeRecordLists(
  col: string,
  local: Record<string, unknown>[],
  incoming: Record<string, unknown>[]
): { next: Record<string, unknown>[]; changed: boolean } {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of local) {
    const id = recordId(col, r);
    if (id) byId.set(id, r);
  }
  let changed = false;
  for (const r of incoming) {
    const id = recordId(col, r);
    if (!id) continue;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, r);
      changed = true;
      continue;
    }
    if (newerStamp(cur, r)) {
      byId.set(id, r);
      changed = true;
    }
  }
  return { next: Array.from(byId.values()), changed };
}

/** Push the snapshot after merging with whatever Postgres already holds. */
export async function pushRemoteDb(db: DB): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok) return false;
  try {
    const remote = await pullRemoteDb();
    const v = remote ? mergeDbSnapshots(remote, db) : db;
    const res = await fetch(`${url}/rest/v1/buildwe_kv`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ k: "main", v }),
      ...timed(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── Per-user conversations ──────────────────────────────── */

/** Refuse anything that is not a conversation we would dare to merge in. */
export function asConversation(v: unknown): Conversation | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<Conversation>;
  if (typeof c.id !== "string" || !c.id || c.id.length > 80) return null;
  if (typeof c.userId !== "string" || !c.userId || c.userId.length > 80) return null;
  if (typeof c.title !== "string") return null;
  if (typeof c.mode !== "string") return null;
  if (!Array.isArray(c.messages)) return null;
  if (typeof c.createdAt !== "string" || typeof c.updatedAt !== "string") return null;
  return c as Conversation;
}

function messageCount(c: Conversation): number {
  return Array.isArray(c.messages) ? c.messages.length : 0;
}

/**
 * Same id, two copies. An empty local shell (cold start / recreate-on-miss)
 * must not replace a thread that already has turns, even if its `updatedAt`
 * is newer — that is how "New chat" used to look like it erased history.
 * When both sides have turns (or both are empty), the newer `updatedAt` wins
 * so an unpushed local write is not thrown away by an older row.
 */
export function preferConversation(local: Conversation, incoming: Conversation): Conversation {
  const ln = messageCount(local);
  const rn = messageCount(incoming);
  if (ln === 0 && rn > 0) return incoming;
  if (rn === 0 && ln > 0) return local;
  if (String(incoming.updatedAt || "") > String(local.updatedAt || "")) return incoming;
  return local;
}

/**
 * Union by id. When both sides have the same chat, `preferConversation` picks.
 */
export function mergeConversationLists(
  local: Conversation[],
  remote: Conversation[]
): { next: Conversation[]; changed: boolean } {
  const byId = new Map<string, Conversation>();
  for (const c of local) {
    if (c?.id) byId.set(c.id, c);
  }
  let changed = false;
  for (const c of remote) {
    if (!c?.id) continue;
    const cur = byId.get(c.id);
    if (!cur) {
      byId.set(c.id, c);
      changed = true;
      continue;
    }
    const pick = preferConversation(cur, c);
    if (pick !== cur) {
      byId.set(c.id, pick);
      changed = true;
    }
  }
  return { next: Array.from(byId.values()), changed };
}

type ConvRow = { id: string; user_id: string; team_id: string | null; payload: Conversation; updated_at: string };

function toRow(c: Conversation): ConvRow {
  return {
    id: c.id,
    user_id: c.userId,
    team_id: c.teamId ?? null,
    payload: c,
    updated_at: c.updatedAt || new Date().toISOString(),
  };
}

/** True only after a conversations-table call actually succeeded (not a 404 schema miss). */
let conversationsTableOk: boolean | null = null;

export function conversationsTableReady(): boolean {
  return conversationsTableOk === true;
}

function noteConversationsTable(ok: boolean) {
  if (ok) conversationsTableOk = true;
}

export async function upsertRemoteConversation(c: Conversation): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok || !c?.id || !c.userId) return false;
  try {
    const res = await fetch(`${url}/rest/v1/buildwe_conversations`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(toRow(c)),
      ...timed(),
    });
    if (res.ok) noteConversationsTable(true);
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteRemoteConversation(id: string, userId: string): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok || !id || !userId) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_conversations?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      timed({ method: "DELETE", headers: headers(key) })
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteRemoteConversationsForUser(userId: string): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok || !userId) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_conversations?user_id=eq.${encodeURIComponent(userId)}`,
      timed({ method: "DELETE", headers: headers(key) })
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function pullByQuery(query: string): Promise<Conversation[]> {
  const { url, key, ok } = cfg();
  if (!ok) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_conversations?select=payload&${query}&limit=200`,
      timed({ headers: headers(key) })
    );
    if (!res.ok) return [];
    noteConversationsTable(true);
    const rows = (await res.json()) as { payload?: unknown }[];
    if (!Array.isArray(rows)) return [];
    const out: Conversation[] = [];
    for (const row of rows) {
      const c = asConversation(row?.payload);
      if (c) out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Only this owner's chats, plus (optionally) chats sitting on a team they
 * belong to. The filter is in the query: the service role *can* read every
 * row, so we must never `select *` and slice in memory.
 */
export async function pullRemoteConversations(
  userId: string,
  teamIds: string[] = []
): Promise<Conversation[]> {
  if (!userId) return [];
  const own = await pullByQuery(`user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`);
  const teams = teamIds.filter((id) => typeof id === "string" && id && id.length < 80);
  if (!teams.length) return own;
  const shared = await pullByQuery(
    `team_id=in.(${teams.map(encodeURIComponent).join(",")})&order=updated_at.desc`
  );
  const { next } = mergeConversationLists(own, shared);
  return next;
}

/** Guest → account: same conversation ids, new owner. Idempotent. */
export async function reassignRemoteConversations(
  fromUserId: string,
  toUserId: string
): Promise<number> {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
  const rows = await pullRemoteConversations(fromUserId);
  let n = 0;
  for (const c of rows) {
    const next: Conversation = {
      ...c,
      userId: toUserId,
      updatedAt: new Date().toISOString(),
    };
    if (await upsertRemoteConversation(next)) n += 1;
  }
  return n;
}

/* ── Owner-scoped accounts / projects / billing ──────────── */

export type OwnedKind = "user" | "project" | "payment" | "wallet" | "credit";

/**
 * `credit` was added in the DB hardening pass. The credit ledger is the
 * authoritative record of every balance movement — getWallet reconciles the
 * wallet from it — yet it lived only in the last-write-wins kv blob while the
 * wallet it derives from was already per-row. The authoritative record must not
 * be less durable than its own cache.
 */
const OWNED_KINDS: readonly OwnedKind[] = ["user", "project", "payment", "wallet", "credit"];

export function asOwnedKind(v: unknown): OwnedKind | null {
  return OWNED_KINDS.includes(v as OwnedKind) ? (v as OwnedKind) : null;
}

type OwnedRow = {
  kind: OwnedKind;
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  updated_at: string;
};

function ownedIdOk(id: string): boolean {
  return typeof id === "string" && !!id && id.length <= 80;
}

export async function upsertOwnedRecord(
  kind: OwnedKind,
  id: string,
  userId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok || !asOwnedKind(kind) || !ownedIdOk(id) || !ownedIdOk(userId) || !payload) return false;
  const row: OwnedRow = {
    kind,
    id,
    user_id: userId,
    payload,
    updated_at: String(payload.updatedAt || payload.createdAt || new Date().toISOString()),
  };
  try {
    const res = await fetch(`${url}/rest/v1/buildwe_owned`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
      ...timed(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteOwnedRecord(kind: OwnedKind, id: string, userId: string): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok || !asOwnedKind(kind) || !ownedIdOk(id) || !ownedIdOk(userId)) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_owned?kind=eq.${encodeURIComponent(kind)}&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      timed({ method: "DELETE", headers: headers(key) })
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteOwnedForUser(userId: string): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok || !ownedIdOk(userId)) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_owned?user_id=eq.${encodeURIComponent(userId)}`,
      timed({ method: "DELETE", headers: headers(key) })
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullOwnedForUser(
  userId: string,
  kind?: OwnedKind
): Promise<{ kind: OwnedKind; id: string; payload: Record<string, unknown> }[]> {
  const { url, key, ok } = cfg();
  if (!ok || !ownedIdOk(userId)) return [];
  const kindQ = kind ? `&kind=eq.${encodeURIComponent(kind)}` : "";
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_owned?select=kind,id,payload&user_id=eq.${encodeURIComponent(userId)}${kindQ}&limit=400`,
      timed({ headers: headers(key) })
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as { kind?: unknown; id?: unknown; payload?: unknown }[];
    if (!Array.isArray(rows)) return [];
    const out: { kind: OwnedKind; id: string; payload: Record<string, unknown> }[] = [];
    for (const row of rows) {
      const k = asOwnedKind(row.kind);
      if (!k || !ownedIdOk(String(row.id || ""))) continue;
      if (!row.payload || typeof row.payload !== "object") continue;
      out.push({ kind: k, id: String(row.id), payload: row.payload as Record<string, unknown> });
    }
    return out;
  } catch {
    return [];
  }
}

/** Email login on a cold instance: look up the account row, not the whole blob. */
export async function pullOwnedUserByEmail(email: string): Promise<Record<string, unknown> | null> {
  const { url, key, ok } = cfg();
  const e = String(email || "").trim().toLowerCase();
  if (!ok || !e || e.length > 120 || /[^a-z0-9.@_+-]/.test(e)) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/buildwe_owned?select=payload&kind=eq.user&payload->>email=eq.${encodeURIComponent(e)}&limit=1`,
      timed({ headers: headers(key) })
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload?: unknown }[];
    const payload = rows?.[0]?.payload;
    if (!payload || typeof payload !== "object") return null;
    const u = payload as Record<string, unknown>;
    if (typeof u.id !== "string" || typeof u.email !== "string") return null;
    return u;
  } catch {
    return null;
  }
}
