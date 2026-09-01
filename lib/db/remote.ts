/**
 * Optional permanent-DB mirror — Supabase REST (no SDK needed).
 *
 * Activates ONLY when both env vars are set:
 *   NEXT_PUBLIC_SUPABASE_URL      e.g. https://xyz.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service role key (server-only!)
 *
 * Two shapes live here:
 *   1. `buildwe_kv` (k='main') — whole-DB snapshot, last-write-wins. Still
 *      used for users/wallets/everything that is not a chat.
 *   2. `buildwe_conversations` — one row per chat, keyed by `user_id`. This
 *      is what actually keeps a person's history when a serverless instance
 *      recycles, and it is what stops User A's write from erasing User B's
 *      chats (the blob cannot).
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

/** Push the snapshot (best-effort, upsert). */
export async function pushRemoteDb(db: DB): Promise<boolean> {
  const { url, key, ok } = cfg();
  if (!ok) return false;
  try {
    const res = await fetch(`${url}/rest/v1/buildwe_kv`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ k: "main", v: db }),
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

/**
 * Union by id. When both sides have the same chat, the newer `updatedAt` wins
 * so a cold instance's empty store cannot clobber a chat that just landed in
 * Postgres, and an unpushed local write is not thrown away by an older row.
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
    if (String(c.updatedAt || "") > String(cur.updatedAt || "")) {
      byId.set(c.id, c);
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
