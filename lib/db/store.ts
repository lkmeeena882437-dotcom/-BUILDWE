/**
 * BUILDWE store — works on Vercel serverless + local dev.
 *
 * Vercel: filesystem under project root is read-only.
 * We write to /tmp when possible, else pure in-memory (per-instance).
 * For permanent multi-instance auth later: swap to Supabase/Turso.
 */
import fs from "fs";
import path from "path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import {
  asConversation,
  conversationsTableReady,
  deleteOwnedForUser,
  deleteOwnedRecord,
  deleteRemoteConversation,
  deleteRemoteConversationsForUser,
  mergeConversationLists,
  mergeDbSnapshots,
  pullOwnedForUser,
  pullOwnedUserByEmail,
  pullRemoteConversations,
  pullRemoteDb,
  pushRemoteDb,
  reassignRemoteConversations,
  remoteDbEnabled,
  upsertOwnedRecord,
  upsertRemoteConversation,
  type OwnedKind,
} from "./remote";
import { CREDITS } from "@/lib/config";

export type Plan = "free" | "pro";

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: Plan;
  skills: string[];
  /** encrypted user-provided provider keys (BYOK) */
  byok?: { groq?: string; openrouter?: string };
  /** OAuth linkage (additive — email/password users have neither) */
  provider?: "email" | "google" | "github";
  oauthId?: string;
  emailVerified?: boolean;
  /**
   * Seats paid for on a Business order. Absent or 1 means a personal PRO, which is
   * what every account created before this field had — hence optional, and read
   * through `planSeatsOf` rather than defaulted at each call site.
   */
  planSeats?: number;
  createdAt: string;
  updatedAt: string;
};

export type PasswordReset = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string | null;
  createdAt: string;
};

export type ApiKey = {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  userId: string;
  mode: "auto" | "chat" | "code" | "image" | "audio";
  title: string;
  messages: Message[];
  projectId?: string | null;
  teamId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
};

/**
 * A file inside a project — gives the Coding Agent real, persistent project
 * context instead of a single throwaway canvas buffer (Update #1 section 3).
 */
export type ProjectFile = {
  id: string;
  userId: string;
  projectId: string;
  /** relative path, e.g. "src/app.js" */
  path: string;
  content: string;
  lang: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  userId: string;
  email?: string;
  name?: string;
  role: "owner" | "member";
  joinedAt: string;
};

export type Team = {
  id: string;
  name: string;
  ownerId: string;
  members: TeamMember[];
  invites: { code: string; createdAt: string }[];
  createdAt: string;
};

export type Share = {
  id: string;
  /**
   * Null on a share created from one artifact rather than a whole chat — the two kinds
   * are mutually exclusive by construction (a generation has no messages to snapshot,
   * a conversation has no output of its own), so one nullable pair beats a `kind` string
   * the readers would each have to switch on.
   */
  conversationId: string | null;
  artifactId?: string | null;
  /**
   * Set on a link that shares ONE answer rather than the whole conversation. The conversation
   * id still rides along so deleting the chat deletes these too (`deleteSharesForConversation`
   * filters by it), and re-sharing the same answer refreshes this row instead of minting a
   * second public page for it — the same rule `createArtifactShare` follows.
   */
  messageId?: string | null;
  userId: string;
  title: string;
  mode: Conversation["mode"];
  messages: Message[];
  views: number;
  createdAt: string;
};

export type Payment = {
  id: string;
  userId: string;
  orderId: string;
  /** what the money was for. `pro` flips the plan, `pack` mints credits. */
  kind?: "pro" | "pack";
  packId?: string;
  credits?: number;
  /**
   * PRO orders only: the seat multiplier that was charged. The verify path reads
   * *this* (our ledger) to work out what should have been paid, never the client,
   * so a forged `seats` in a verify request cannot buy three seats for the price of one.
   */
  seats?: number;
  paymentId?: string;
  amount: number;
  /** What the payment gateway reported as actually captured, in the smallest
   *  currency unit. Written only from the server-side verify path. */
  amountPaid?: number;
  currency: string;
  status: "created" | "paid" | "failed";
  /** Only ever set by builds before 2026-08-31, which could record a demo order. */
  demo?: boolean;
  createdAt: string;
};

/** A user's credit balance. Money in, work out — see lib/credits.ts. */
export type Wallet = {
  userId: string;
  balance: number;
  /** when the signup grant was minted — once per account, never per session */
  welcomeAt?: string | null;
  /** "YYYY-MM" of the last PRO monthly grant, so it can't be farmed */
  proGrantPeriod?: string | null;
  updatedAt: string;
};

/**
 * Immutable money trail. Every balance change writes one row, so a disputed
 * "I had credits yesterday" is answerable, and a double-credit bug is visible
 * instead of being an invisible number.
 */
export type CreditRow = {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  /** idempotency key: the same refId can only ever be granted once */
  refId?: string | null;
  balanceAfter: number;
  createdAt: string;
};

/**
 * One-time-use tokens (email verification). A signed token is otherwise
 * replayable for its whole validity window, so a leaked link in an inbox
 * preview stays dangerous for 48 hours — the hash lands here on first use.
 */
export type ConsumedToken = {
  id: string;
  scope: string;
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

/**
 * One cached link preview.
 *
 * `key` is the SHA-256 of the normalised URL and **the URL is not stored**: a cache
 * of "what our users clicked" is a profile of their reading, and nothing downstream
 * needs it — the card renders the host plus whatever that page said about itself, and
 * a hit requires already knowing the exact URL. So the worst case for someone who
 * steals the store is "the public title of a page they already have the link to".
 *
 * Failures are cached too (`ok: false`, short TTL) on purpose: without that, a
 * message mentioning one dead host re-requests it on every render, which is how a
 * preview feature turns into low-grade self-inflicted DDoS.
 */
export type LinkPreviewRow = {
  key: string;
  host: string;
  ok: boolean;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  /** Present when `ok` is false — passed through so the client can be told *why*. */
  code?: string;
  fetchedAt: number;
  expiresAt: number;
};

export type Generation = {
  id: string;
  userId: string;
  /**
   * `text` is an answer the owner promoted out of a chat (UI step 13). It is its own type
   * rather than a `code` row because the menu a `code` row earns is the wrong menu for prose:
   * "copy the code", "open in canvas", "apply to file". Nothing about the storage differs —
   * `outputText` was already there.
   */
  type: "image" | "audio" | "code" | "text";
  prompt: string;
  outputUrl?: string;
  outputText?: string;
  meta?: Record<string, unknown>;
  /**
   * A name the owner gave this output. Absent means "show the prompt", which is what
   * every row written before the creations panel looked like — so nothing had to be
   * back-filled, and `ARTIFACT_TITLE_MAX` is enforced at the API rather than clamped.
   */
  title?: string;
  /** Kept at the top of the creations list. Optional because that is the old shape. */
  pinned?: boolean;
  createdAt: string;
};

export type UsageRow = {
  userId: string;
  day: string;
  chat: number;
  code: number;
  image: number;
  audio: number;
};

export type DB = {
  users: User[];
  conversations: Conversation[];
  generations: Generation[];
  usage: UsageRow[];
  projects: Project[];
  projectFiles: ProjectFile[];
  shares: Share[];
  payments: Payment[];
  wallets: Wallet[];
  creditLedger: CreditRow[];
  apiKeys: ApiKey[];
  teams: Team[];
  passwordResets: PasswordReset[];
  consumedTokens: ConsumedToken[];
  linkPreviews: LinkPreviewRow[];
};

const emptyDb = (): DB => ({
  users: [],
  conversations: [],
  generations: [],
  usage: [],
  projects: [],
  projectFiles: [],
  shares: [],
  payments: [],
  wallets: [],
  creditLedger: [],
  apiKeys: [],
  teams: [],
  passwordResets: [],
  consumedTokens: [],
  linkPreviews: [],
});

/** Process-local fallback when disk is unavailable */
let memoryDb: DB = emptyDb();
let resolvedPath: string | null | undefined;
let writable = false;

/**
 * JSON on disk is allowed when a test/dev directory is named, or when we are
 * not on a serverless production host. Vercel `/tmp` is not a database.
 */
export function jsonStoreAllowed(): boolean {
  if (process.env.BUILDWE_DATA_DIR) return true;
  if (process.env.VERCEL === "1") return false;
  if (process.env.NODE_ENV === "production" && remoteDbEnabled()) return false;
  return true;
}

function candidatePaths(): string[] {
  if (!jsonStoreAllowed()) return [];
  const list: string[] = [];
  if (process.env.BUILDWE_DATA_DIR) {
    list.push(path.join(process.env.BUILDWE_DATA_DIR, "buildwe.json"));
  }
  // Local / VPS writable tmp — never used on Vercel (jsonStoreAllowed is false).
  list.push(path.join("/tmp", "buildwe-data", "buildwe.json"));
  // Local project data folder
  list.push(path.join(process.cwd(), "data", "buildwe.json"));
  return list;
}

function tryInitPath(file: string): boolean {
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(emptyDb()), "utf8");
    } else {
      // touch-read to ensure readable
      fs.readFileSync(file, "utf8");
    }
    // prove write
    const cur = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, cur, "utf8");
    return true;
  } catch {
    return false;
  }
}

function getPath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  for (const p of candidatePaths()) {
    if (tryInitPath(p)) {
      resolvedPath = p;
      writable = true;
      return p;
    }
  }
  resolvedPath = null;
  writable = false;
  return null;
}

function read(): DB {
  const file = getPath();
  bootRemote();
  if (!file) return memoryDb;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as DB;
    memoryDb = {
      users: parsed.users || [],
      conversations: parsed.conversations || [],
      generations: parsed.generations || [],
      usage: parsed.usage || [],
      projects: parsed.projects || [],
      projectFiles: parsed.projectFiles || [],
      shares: parsed.shares || [],
      payments: parsed.payments || [],
      wallets: parsed.wallets || [],
      creditLedger: parsed.creditLedger || [],
      apiKeys: parsed.apiKeys || [],
      teams: parsed.teams || [],
      passwordResets: parsed.passwordResets || [],
      consumedTokens: parsed.consumedTokens || [],
      // A store written before previews existed simply has no cache yet.
      linkPreviews: parsed.linkPreviews || [],
    };
    lastReadRaw = raw;
    return memoryDb;
  } catch {
    lastReadRaw = null;
    return memoryDb;
  }
}

/* ── Cross-process write safety (audit C4 stopgap) ──────────
 *
 * The JSON store is a whole-file read-modify-write. Inside ONE process that is
 * safe (JS is single-threaded and no mutator awaits between read() and
 * write()), but two server processes (or a `next dev` worker plus a script)
 * clobber each other: B reads before A writes, then B's write erases A.
 *
 * Two mechanisms, both contained here so no call site changes:
 *  1. a lock file with stale takeover, so read→write is serialised across
 *     processes;
 *  2. a three-way merge on write — if the file changed since our read, our
 *     record-level *diff* (base = what we read, ours = this db) is applied on
 *     top of the other writer's content instead of overwriting it.
 *
 * This is a stopgap, not a database: two processes editing the SAME record
 * still resolve last-writer-wins. The real fix is Postgres as primary store
 * (docs/internal/BUILD_PLAN.md W6.1).
 */

let lastReadRaw: string | null = null;
export let dbLockingAvailable = true;

/**
 * Another writer holds the store, or the file could not be read while we held the lock, so the
 * only safe answer is "not now". Thrown instead of writing anyway: an unlocked write whose merge
 * base is stale erases the other process's records, and a signup that vanishes is not something a
 * retry can undo. `tests/store-concurrency.mjs` holds the lock on purpose to prove this path.
 */
export class StoreBusyError extends Error {
  readonly code = "STORE_BUSY";
  constructor(what: string) {
    super(`The workspace is busy (${what}) — nothing was saved. Try that again in a moment.`);
    this.name = "StoreBusyError";
  }
}

function sleepSync(ms: number) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* no SharedArrayBuffer — busy-check instead */
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }
}

function acquireLock(file: string): string | null {
  const lock = `${file}.lock`;
  // Long enough that a healthy writer (one file, a few ms) is always waited out, short enough that
  // a wedged one is not a hung request. A crashed holder is taken over after 3 000 ms by the check
  // below, so this ceiling is only reached by writers that are alive and slow.
  const deadline = Date.now() + 8_000;
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      dbLockingAvailable = true;
      return lock;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        // Locks cannot be taken here (read-only fs, no perms). Keep working
        // with the merge path only and report it, rather than failing writes.
        dbLockingAvailable = false;
        return null;
      }
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 3_000) {
          fs.unlinkSync(lock); // crashed holder — take over
          continue;
        }
      } catch {
        /* vanished between stat and unlink: retry */
        continue;
      }
      if (Date.now() > deadline) {
        // Was `dbLockingAvailable = false; return null;` — i.e. carry on without the lock. Under a
        // 12-account burst on a loaded machine that is exactly how one signup disappeared: the
        // merge then runs against a base read outside any lock, so the last writer wins and the
        // other's rows are gone. EEXIST at deadline means "somebody is in there", not
        // "locking is impossible here" — those two cases must not share an outcome.
        throw new StoreBusyError("another write is in flight");
      }
      sleepSync(20);
    }
  }
}

function releaseLock(lock: string) {
  try {
    fs.unlinkSync(lock);
  } catch {
    /* already gone */
  }
}

/** Identity of a record inside a collection. `usage` is keyed per user+day. */
function recordKey(col: string, rec: Record<string, unknown>): string {
  if (col === "usage") return `${String(rec.userId)}|${String(rec.day)}`;
  const id = rec.id;
  return typeof id === "string" && id ? id : JSON.stringify(rec);
}

function parseDb(raw: string): DB {
  const parsed = JSON.parse(raw) as Partial<DB>;
  const base = emptyDb();
  for (const k of Object.keys(base) as (keyof DB)[]) {
    const v = parsed[k];
    if (Array.isArray(v)) (base[k] as unknown[]) = v;
  }
  return base;
}

/** Apply our diff (base → ours) onto `theirs`, record by record. */
function mergeOnto(theirs: DB, base: DB, ours: DB): DB {
  const out = { ...theirs } as DB;
  (Object.keys(ours) as (keyof DB)[]).forEach((col) => {
    const theirRows = theirs[col] as Record<string, unknown>[];
    const baseRows = base[col] as Record<string, unknown>[];
    const ourRows = ours[col] as Record<string, unknown>[];
    const baseJson: Record<string, string> = {};
    baseRows.forEach((r) => {
      baseJson[recordKey(col, r)] = JSON.stringify(r);
    });
    const patch: Record<string, Record<string, unknown> | null> = {};
    ourRows.forEach((r) => {
      const k = recordKey(col, r);
      if (baseJson[k] !== JSON.stringify(r)) patch[k] = r; // added or changed
    });
    Object.keys(baseJson).forEach((k) => {
      if (!ourRows.some((r) => recordKey(col, r) === k)) patch[k] = null; // deleted
    });

    const merged: Record<string, unknown>[] = [];
    const placed: Record<string, boolean> = {};
    theirRows.forEach((r) => {
      const k = recordKey(col, r);
      const p = patch[k];
      if (p === undefined) {
        merged.push(r);
        placed[k] = true;
      } else if (p !== null) {
        merged.push(p);
        placed[k] = true;
      }
      // p === null → we deleted it, so it is dropped
    });
    ourRows.forEach((r) => {
      const k = recordKey(col, r);
      if (patch[k] !== undefined && !placed[k]) merged.push(r);
    });
    (out[col] as unknown[]) = merged;
  });
  return out;
}

function write(db: DB, opts?: { mirror?: boolean; touchBoot?: boolean }) {
  // A local write happened. If bootRemote() is still awaiting its pull, this
  // tells it to abandon the adopt rather than overwrite what we just wrote.
  // Hydrating one user's chats from Postgres is not a local write in that
  // sense — it must not block adopting users/wallets from the blob, and it
  // must not push a partial snapshot that would erase everyone else.
  if (opts?.touchBoot !== false) localWriteSinceBoot = true;
  const prevOwned = lastReadRaw ? parseDb(lastReadRaw) : emptyDb();
  const file = getPath();
  if (file && writable) {
    const lock = acquireLock(file);
    try {
      // If another process wrote since our read, merge instead of overwrite.
      let current = db;
      let blind = false;
      try {
        const onDisk = fs.readFileSync(file, "utf8");
        if (lastReadRaw !== null && onDisk !== lastReadRaw) {
          current = mergeOnto(parseDb(onDisk), parseDb(lastReadRaw), db);
        }
      } catch {
        // "Unreadable, so write what we hold" is only ever right when there is no lock to have —
        // with the lock in our hands, an unreadable file means a rename mid-flight or an ill
        // volume, and overwriting it with a stale snapshot destroys records we never saw.
        if (lock) blind = true;
      }
      if (blind) throw new StoreBusyError("the store could not be read before writing");
      // Compact JSON: pretty-print doubled the write and the parse on every mutation.
      const out = JSON.stringify(current);
      // atomic: never leave a half-written store behind
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, out, "utf8");
      fs.renameSync(tmp, file);
      memoryDb = current;
      lastReadRaw = out;
      db = current;
    } catch (e) {
      // A busy store is a real answer to give the caller; disabling writes for the rest of the
      // process because one write was refused is not.
      if (e instanceof StoreBusyError) throw e;
      writable = false;
    } finally {
      if (lock) releaseLock(lock);
    }
  }
  memoryDb = db;
  if (opts?.mirror !== false) {
    scheduleRemotePush(db);
    scheduleOwnedSync(prevOwned, db);
  }
}

/** Chat mutations already upsert a row. Skip the whole-blob push once that table is live. */
function writeConversations(db: DB) {
  write(db, { mirror: !conversationsTableReady() });
}

/* ── Optional Supabase mirror (permanent DB) ─────────────── */

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let latestDb: DB | null = null;
let bootedRemote = false;
/** Set by write(); blocks a late remote adopt from clobbering local data. */
let localWriteSinceBoot = false;
let bootPromise: Promise<void> | null = null;

function scheduleRemotePush(db: DB) {
  if (!remoteDbEnabled()) return;
  latestDb = db;
  if (pushTimer) return; // debounced — one push per quiet window
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    const snapshot = latestDb;
    latestDb = null;
    if (snapshot) await pushRemoteDb(snapshot);
  }, 1500);
}

type OwnedPending = { kind: OwnedKind; id: string; userId: string; payload: Record<string, unknown> };
let ownedTimer: ReturnType<typeof setTimeout> | null = null;
let ownedQueue: OwnedPending[] = [];

function jsonOf(rec: unknown): string {
  try {
    return JSON.stringify(rec);
  } catch {
    return "";
  }
}

function ownedDiff(prev: DB, next: DB): OwnedPending[] {
  const out: OwnedPending[] = [];
  const push = (kind: OwnedKind, id: string, userId: string, payload: Record<string, unknown>) => {
    if (!id || !userId) return;
    out.push({ kind, id, userId, payload });
  };
  const prevUsers = new Map(prev.users.map((u) => [u.id, u]));
  for (const u of next.users) {
    if (jsonOf(prevUsers.get(u.id)) !== jsonOf(u)) push("user", u.id, u.id, u as unknown as Record<string, unknown>);
  }
  const prevProj = new Map(prev.projects.map((p) => [p.id, p]));
  for (const p of next.projects) {
    if (jsonOf(prevProj.get(p.id)) !== jsonOf(p)) push("project", p.id, p.userId, p as unknown as Record<string, unknown>);
  }
  const prevPay = new Map(prev.payments.map((p) => [p.id, p]));
  for (const p of next.payments) {
    if (jsonOf(prevPay.get(p.id)) !== jsonOf(p)) push("payment", p.id, p.userId, p as unknown as Record<string, unknown>);
  }
  const prevWal = new Map(prev.wallets.map((w) => [w.userId, w]));
  for (const w of next.wallets) {
    if (jsonOf(prevWal.get(w.userId)) !== jsonOf(w)) {
      push("wallet", w.userId, w.userId, w as unknown as Record<string, unknown>);
    }
  }
  return out;
}

function scheduleOwnedSync(prev: DB, next: DB) {
  if (!remoteDbEnabled()) return;
  const diff = ownedDiff(prev, next);
  if (!diff.length) return;
  ownedQueue.push(...diff);
  if (ownedTimer) return;
  ownedTimer = setTimeout(async () => {
    ownedTimer = null;
    const batch = ownedQueue;
    ownedQueue = [];
    const seen = new Set<string>();
    for (let i = batch.length - 1; i >= 0; i--) {
      const row = batch[i];
      const k = `${row.kind}:${row.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      try {
        await upsertOwnedRecord(row.kind, row.id, row.userId, row.payload);
      } catch (e) {
        console.error("[bw] owned upsert", e);
      }
    }
  }, 200);
}

/**
 * One-time boot: adopt the remote snapshot when local storage is fresh.
 *
 * The pull is async, so writes can land while it is in flight. Before the
 * `localWriteSinceBoot` guard, a signup during that window was silently
 * destroyed: the adopt overwrote memoryDb with the older remote snapshot, the
 * account vanished, and the next push persisted the loss. Only adopt if the
 * process still hasn't written anything by the time the snapshot arrives.
 */
function bootRemote() {
  if (bootedRemote || !remoteDbEnabled()) return;
  bootedRemote = true;
  bootPromise = (async () => {
    const localHadData =
      memoryDb.users.length > 0 || memoryDb.conversations.length > 0;
    if (localHadData) return; // local wins on warm starts
    const remote = await pullRemoteDb();
    if (!remote) return;
    // Re-check AFTER the await — this is the race the guard exists for.
    // A signup in flight still wins outright. Hydrated chats do not: they
    // merge with the blob so users/wallets still arrive on a cold start.
    if (localWriteSinceBoot && memoryDb.users.length > 0) return;
    const merged = mergeDbSnapshots(remote, memoryDb);
    const base = emptyDb();
    memoryDb = {
      users: (merged.users as User[]) || base.users,
      conversations: (merged.conversations as Conversation[]) || base.conversations,
      generations: (merged.generations as Generation[]) || base.generations,
      usage: (merged.usage as UsageRow[]) || base.usage,
      projects: (merged.projects as Project[]) || base.projects,
      projectFiles: (merged.projectFiles as ProjectFile[]) || base.projectFiles,
      shares: (merged.shares as Share[]) || base.shares,
      payments: (merged.payments as Payment[]) || base.payments,
      wallets: (merged.wallets as Wallet[]) || base.wallets,
      creditLedger: (merged.creditLedger as CreditRow[]) || base.creditLedger,
      apiKeys: (merged.apiKeys as ApiKey[]) || base.apiKeys,
      teams: (merged.teams as Team[]) || base.teams,
      passwordResets: (merged.passwordResets as PasswordReset[]) || base.passwordResets,
      consumedTokens: (merged.consumedTokens as ConsumedToken[]) || base.consumedTokens,
      linkPreviews: (merged.linkPreviews as LinkPreviewRow[]) || base.linkPreviews,
    };
    const file = getPath();
    if (file && writable) {
      try {
        fs.writeFileSync(file, JSON.stringify(memoryDb), "utf8");
      } catch {
        /* */
      }
    }
  })();
}

/**
 * Login/register must not look up an account until the remote snapshot has had
 * a chance to land. `bootRemote` is fire-and-forget for ordinary reads; a
 * password check against an empty cold store is a false "invalid password".
 */
export async function waitForRemoteBoot() {
  if (!remoteDbEnabled()) return;
  bootRemote();
  if (bootPromise) {
    try {
      await bootPromise;
    } catch {
      /* login still runs against whatever is local */
    }
  }
}

function preferUserRow(a: User, b: User): User {
  const aT = String(a.updatedAt || a.createdAt || "");
  const bT = String(b.updatedAt || b.createdAt || "");
  if (bT !== aT) return bT > aT ? b : a;
  // Same stamp: do not promote plan just because one copy says PRO — a cancel
  // that landed with an equal timestamp must be allowed to stick.
  return a;
}

function applyOwnedPayload(db: DB, kind: string, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const rec = payload as Record<string, unknown>;
  if (kind === "user") {
    const id = typeof rec.id === "string" ? rec.id : "";
    const email = typeof rec.email === "string" ? rec.email.trim().toLowerCase() : "";
    if (!id || !email) return false;
    const next = rec as unknown as User;
    const i = db.users.findIndex((u) => u.id === id || u.email === email);
    if (i < 0) {
      db.users.push(next);
      return true;
    }
    const pick = preferUserRow(db.users[i], next);
    if (pick === db.users[i]) return false;
    db.users[i] = pick;
    return true;
  }
  if (kind === "project") {
    const id = typeof rec.id === "string" ? rec.id : "";
    const userId = typeof rec.userId === "string" ? rec.userId : "";
    if (!id || !userId) return false;
    if (db.projects.some((p) => p.id === id)) return false;
    db.projects.push(rec as unknown as Project);
    return true;
  }
  if (kind === "payment") {
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) return false;
    const i = db.payments.findIndex((p) => p.id === id);
    if (i < 0) {
      db.payments.push(rec as unknown as Payment);
      return true;
    }
    const cur = db.payments[i];
    if (cur.status !== "paid" && rec.status === "paid") {
      db.payments[i] = rec as unknown as Payment;
      return true;
    }
    return false;
  }
  if (kind === "wallet") {
    const userId = typeof rec.userId === "string" ? rec.userId : "";
    if (!userId) return false;
    const i = db.wallets.findIndex((w) => w.userId === userId);
    if (i < 0) {
      db.wallets.push(rec as unknown as Wallet);
      return true;
    }
    const a = db.wallets[i];
    const b = rec as unknown as Wallet;
    if (String(b.updatedAt || "") > String(a.updatedAt || "")) {
      db.wallets[i] = b;
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Cold login/register/oauth: pull this email's account (and its billing rows)
 * from `buildwe_owned` into the in-process store. Does not push — a partial
 * snapshot must not erase anyone else.
 */
export async function hydrateAccountByEmail(email: string): Promise<void> {
  if (!remoteDbEnabled()) return;
  const e = String(email || "").trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
  try {
    const payload = await pullOwnedUserByEmail(e);
    if (!payload) return;
    const db = read();
    let changed = applyOwnedPayload(db, "user", payload);
    const uid = typeof payload.id === "string" ? payload.id : "";
    if (uid) {
      const rest = await pullOwnedForUser(uid);
      for (const row of rest) {
        if (row.kind === "user") continue;
        changed = applyOwnedPayload(db, row.kind, row.payload) || changed;
      }
    }
    if (changed) write(db, { mirror: false, touchBoot: false });
  } catch (err) {
    console.error("[bw] hydrate account", err);
  }
}

/**
 * What the data is actually persisted to, in order of durability.
 *
 * "supabase" means the Postgres mirror is configured, so the data survives a
 * serverless instance being recycled. "disk" is a local JSON file — fine for
 * a VPS, lost on most serverless platforms. "memory" means even the file
 * isn't writable and everything dies with the process.
 *
 * The health endpoint reports this so an operator can tell at a glance
 * whether their deployment is actually durable, instead of assuming it is.
 */
export function storageMode(): "supabase" | "disk" | "memory" {
  getPath();
  if (remoteDbEnabled()) return "supabase";
  return writable && resolvedPath ? "disk" : "memory";
}

export function uid(prefix = "id") {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const hashBuf = Buffer.from(hash, "hex");
    const test = scryptSync(password, salt, 64);
    return hashBuf.length === test.length && timingSafeEqual(hashBuf, test);
  } catch {
    return false;
  }
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Users ───────────────────────────────────────────────── */

export function findUserByEmail(email: string) {
  const e = email.trim().toLowerCase();
  return read().users.find((u) => u.email === e) || null;
}

export function findUserById(id: string) {
  return read().users.find((u) => u.id === id) || null;
}

export function createUser(input: {
  email: string;
  name: string;
  password: string;
}) {
  const db = read();
  const email = input.email.trim().toLowerCase();
  if (db.users.some((u) => u.email === email)) {
    throw new Error("Email already registered");
  }
  const now = new Date().toISOString();
  const user: User = {
    id: uid("usr"),
    email,
    name: input.name.trim() || email.split("@")[0],
    passwordHash: hashPassword(input.password),
    plan: "free",
    skills: [],
    createdAt: now,
    updatedAt: now,
  };
  db.users.push(user);
  // The signup grant is minted in the SAME write as the account, so there is no
  // window where a user exists with no wallet to spend from.
  const welcome = CREDITS.welcome;
  if (welcome > 0) {
    db.wallets.push({
      userId: user.id,
      balance: welcome,
      welcomeAt: now,
      proGrantPeriod: null,
      updatedAt: now,
    });
    db.creditLedger.unshift({
      id: uid("crl"),
      userId: user.id,
      delta: welcome,
      reason: "welcome",
      refId: `welcome:${user.id}`,
      balanceAfter: welcome,
      createdAt: now,
    });
  }
  write(db);
  return user;
}

export function updateUser(
  id: string,
  patch: Partial<
    Pick<
      User,
      // An allow-list, and `planSeats` joins it for the same reason `plan` is in it
      // rather than being free-for-all: only the two paths that have confirmed money at
      // the gateway (checkout verify, and the signed webhook) may set either.
      "name" | "plan" | "planSeats" | "skills" | "byok" | "emailVerified" | "provider" | "oauthId"
    >
  >
) {
  const db = read();
  const i = db.users.findIndex((u) => u.id === id);
  if (i < 0) return null;
  db.users[i] = {
    ...db.users[i],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  write(db);
  return db.users[i];
}

/* ── OAuth users ─────────────────────────────────────────── */

export function findOrCreateOauthUser(input: {
  provider: "google" | "github";
  oauthId: string;
  email?: string;
  name?: string;
}) {
  const db = read();
  const email = (input.email || "").trim().toLowerCase();
  let u = db.users.find(
    (x) => x.provider === input.provider && x.oauthId === input.oauthId
  );
  if (u) return u;

  // link by verified email (no password conflict: keep existing hash)
  if (email) {
    u = db.users.find((x) => x.email === email);
    if (u) {
      u.provider = input.provider;
      u.oauthId = input.oauthId;
      u.emailVerified = true;
      u.updatedAt = new Date().toISOString();
      write(db);
      return u;
    }
  }

  const now = new Date().toISOString();
  const user: User = {
    id: uid("usr"),
    email: email || `${input.provider}_${input.oauthId}@users.buildwe.online`,
    name: (input.name || "").trim() || input.provider[0].toUpperCase() + " user",
    passwordHash: hashPassword(randomBytes(24).toString("hex")), // unusable random
    plan: "free",
    skills: [],
    provider: input.provider,
    oauthId: input.oauthId,
    emailVerified: Boolean(email),
    createdAt: now,
    updatedAt: now,
  };
  db.users.push(user);
  write(db);
  return user;
}

/* ── Password reset ──────────────────────────────────────── */

export function createPasswordReset(userId: string) {
  const db = read();
  const token = randomBytes(24).toString("hex");
  const row: PasswordReset = {
    id: uid("rst"),
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
    usedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.passwordResets.unshift(row);
  db.passwordResets = db.passwordResets.slice(0, 100);
  write(db);
  return token;
}

export function consumePasswordReset(token: string, newPassword: string) {
  const db = read();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db.passwordResets.find((r) => r.tokenHash === tokenHash);
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) {
    return null;
  }
  const u = db.users.find((x) => x.id === row.userId);
  if (!u) return null;
  u.passwordHash = hashPassword(newPassword);
  u.updatedAt = new Date().toISOString();
  row.usedAt = new Date().toISOString();
  write(db);
  return u;
}

/* ── Account deletion (full cascade) ─────────────────────── */

export function deleteUserCascade(userId: string) {
  const db = read();
  const ownedTeamIds = db.teams
    .filter((t) => t.ownerId === userId)
    .map((t) => t.id);
  db.teams = db.teams.filter((t) => t.ownerId !== userId);
  // detach chats from dissolved teams; remove membership from others
  for (const c of db.conversations) {
    if (c.teamId && ownedTeamIds.includes(c.teamId)) c.teamId = null;
  }
  for (const t of db.teams) {
    t.members = t.members.filter((m) => m.userId !== userId);
  }
  db.users = db.users.filter((u) => u.id !== userId);
  db.conversations = db.conversations.filter((c) => c.userId !== userId);
  db.generations = db.generations.filter((g) => g.userId !== userId);
  db.usage = db.usage.filter((u) => u.userId !== userId);
  db.projects = db.projects.filter((p) => p.userId !== userId);
  db.projectFiles = db.projectFiles.filter((f) => f.userId !== userId);
  db.shares = db.shares.filter((s) => s.userId !== userId);
  db.payments = db.payments.filter((p) => p.userId !== userId);
  db.wallets = db.wallets.filter((w) => w.userId !== userId);
  db.creditLedger = db.creditLedger.filter((c) => c.userId !== userId);
  db.apiKeys = db.apiKeys.filter((k) => k.userId !== userId);
  db.passwordResets = db.passwordResets.filter((r) => r.userId !== userId);
  write(db);
  void deleteRemoteConversationsForUser(userId);
  void deleteOwnedForUser(userId);
  return true;
}

/* ── Conversations ───────────────────────────────────────── */

export function listConversations(userId: string) {
  return read()
    .conversations.filter((c) => c.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(id: string, userId: string) {
  return (
    read().conversations.find((x) => x.id === id && x.userId === userId) || null
  );
}

export function createConversation(input: {
  userId: string;
  mode: Conversation["mode"];
  title: string;
  messages?: Message[];
  projectId?: string | null;
  teamId?: string | null;
}) {
  const db = read();
  const now = new Date().toISOString();
  const c: Conversation = {
    id: uid("conv"),
    userId: input.userId,
    mode: input.mode,
    title: input.title.slice(0, 80) || "New chat",
    messages: input.messages || [],
    projectId: input.projectId || null,
    teamId: input.teamId || null,
    createdAt: now,
    updatedAt: now,
  };
  db.conversations.unshift(c);
  void upsertRemoteConversation(c);
  // Keep memory bounded PER USER, never globally.
  //
  // This used to be `db.conversations.slice(0, 200)` across the whole table,
  // which meant one busy user (or 200 visitors) silently deleted everyone
  // else's chats — proven in testing: a user's chat vanished after 205 other
  // conversations were created. Trimming per owner keeps the table bounded
  // without ever touching another account's data.
  trimPerUser(db, input.userId);
  writeConversations(db);
  return c;
}

/** Per-owner retention limits — bounded storage without cross-user deletion. */
const RETENTION = {
  conversationsPerUser: 200,
  generationsPerUser: 300,
  sharesPerUser: 50,
  paymentsPerUser: 100,
  creditLedgerPerUser: 500,
  /** messages inside a single conversation */
  messagesPerConversation: 400,
} as const;

function trimPerUser(db: DB, userId: string) {
  const mine = db.conversations.filter((c) => c.userId === userId);
  if (mine.length <= RETENTION.conversationsPerUser) return;
  // Oldest-first removal, and only from this owner's rows.
  const keep = new Set(
    mine
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, RETENTION.conversationsPerUser)
      .map((c) => c.id)
  );
  const dropped = mine.filter((c) => !keep.has(c.id));
  db.conversations = db.conversations.filter(
    (c) => c.userId !== userId || keep.has(c.id)
  );
  for (const c of dropped) void deleteRemoteConversation(c.id, userId);
}

export function appendMessages(
  conversationId: string,
  userId: string,
  messages: Message[],
  title?: string
) {
  const db = read();
  let i = db.conversations.findIndex(
    (c) => c.id === conversationId && c.userId === userId
  );
  if (i < 0) {
    // team conversation — any member may append into it
    i = db.conversations.findIndex(
      (c) =>
        c.id === conversationId &&
        c.teamId &&
        isTeamMember(c.teamId, userId)
    );
  }
  if (i < 0) {
    // The id exists but this caller may not write it. Recreating a shell under
    // the caller's userId used to mint a second row with the same id — so a
    // guessed conversationId became "your" chat, and get-by-id returned whichever
    // row came first. Refuse instead. A truly missing id (cold start / lost
    // memory) still gets a shell so the owner can keep talking.
    if (db.conversations.some((c) => c.id === conversationId)) return null;
    const now = new Date().toISOString();
    db.conversations.unshift({
      id: conversationId,
      userId,
      mode: "chat",
      title: title?.slice(0, 80) || "Chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
    i = 0;
  }
  db.conversations[i].messages.push(...messages);
  // Bound a single conversation (F3): without this one long-running chat grows
  // without limit, and since every write serialises the whole store, that one
  // chat slows down every request for every user. Oldest turns drop first —
  // the model already works from a compressed window of recent turns.
  const msgs = db.conversations[i].messages;
  if (msgs.length > RETENTION.messagesPerConversation) {
    db.conversations[i].messages = msgs.slice(
      msgs.length - RETENTION.messagesPerConversation
    );
  }
  db.conversations[i].updatedAt = new Date().toISOString();
  if (title) db.conversations[i].title = title.slice(0, 80);
  writeConversations(db);
  void upsertRemoteConversation(db.conversations[i]);
  return db.conversations[i];
}

export function deleteConversation(id: string, userId: string) {
  const db = read();
  const owned = db.conversations.some((c) => c.id === id && c.userId === userId);
  if (!owned) return false;
  db.conversations = db.conversations.filter((c) => c.id !== id);
  db.shares = db.shares.filter((s) => s.conversationId !== id);
  write(db);
  void deleteRemoteConversation(id, userId);
  return true;
}

/* ── Projects ────────────────────────────────────────────── */

export function listProjects(userId: string) {
  return read()
    .projects.filter((p) => p.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * One owner's project names are kept short because they live in sidebar chips, not
 * because 40 is a storage limit. It is exported, and `/api/projects` answers with it, so
 * the input that enforces it reads the number from the server instead of copying it and
 * drifting the day somebody edits one of them.
 */
export const PROJECT_NAME_MAX = 40;

export function createProject(userId: string, name: string) {
  const db = read();
  const p: Project = {
    id: uid("proj"),
    userId,
    name: name.trim().slice(0, PROJECT_NAME_MAX) || "New project",
    createdAt: new Date().toISOString(),
  };
  db.projects.push(p);
  write(db);
  return p;
}

export function renameProject(id: string, userId: string, name: string) {
  const db = read();
  const p = db.projects.find((x) => x.id === id && x.userId === userId);
  if (!p) return null;
  p.name = name.trim().slice(0, PROJECT_NAME_MAX) || p.name;
  write(db);
  return p;
}

export function getProject(id: string, userId: string) {
  return read().projects.find((p) => p.id === id && p.userId === userId) || null;
}

export function deleteProject(id: string, userId: string) {
  const db = read();
  const owned = db.projects.some((p) => p.id === id && p.userId === userId);
  if (!owned) return false;
  db.projects = db.projects.filter((p) => p.id !== id);
  // Only this owner's chats — a guessed id must not unlink someone else's folder.
  for (const c of db.conversations) {
    if (c.projectId === id && c.userId === userId) c.projectId = null;
  }
  db.projectFiles = db.projectFiles.filter(
    (f) => !(f.projectId === id && f.userId === userId)
  );
  write(db);
  void deleteOwnedRecord("project", id, userId);
  return true;
}

/* ── Project files — Coding Agent context (Update #1 §3) ──── */

const MAX_FILES_PER_PROJECT = 60;
const MAX_FILE_CHARS = 120_000;

export function normalizeFilePath(raw: string): string | null {
  const p = String(raw || "").trim().replace(/\\/g, "/");

  // Reject traversal, absolute paths, drive letters and control characters.
  // These never touch the real filesystem (files live in the JSON store), but
  // rejecting them keeps paths honest: "/etc/shadow" should fail loudly rather
  // than be silently rewritten into a lookalike project file.
  if (!p || p.length > 200) return null;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  if (p.includes("..") || /[\0<>:"|?*]/.test(p)) return null;

  const cleaned = p.replace(/^\.\//, "");
  if (!cleaned) return null;
  if (cleaned.split("/").some((seg) => !seg || seg === "." || seg === "..")) {
    return null;
  }
  return cleaned;
}

function guessLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    php: "php", cs: "csharp", cpp: "cpp", c: "c", swift: "swift", kt: "kotlin",
    html: "html", htm: "html", css: "css", scss: "scss",
    json: "json", md: "markdown", yml: "yaml", yaml: "yaml", sql: "sql",
    sh: "bash", txt: "text",
  };
  return map[ext] || "text";
}

export function listProjectFiles(projectId: string, userId: string) {
  return read()
    .projectFiles.filter((f) => f.projectId === projectId && f.userId === userId)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function getProjectFile(id: string, userId: string) {
  return (
    read().projectFiles.find((f) => f.id === id && f.userId === userId) || null
  );
}

/** Why a project file write was refused. `code` for callers, `error` for the human. */
export type SaveFileErrorCode =
  | "INVALID_PATH"
  | "FILE_TOO_LARGE"
  | "PROJECT_NOT_FOUND"
  | "FILE_LIMIT";

/** Create or update a file by path (upsert), scoped to one owner + project. */
export function saveProjectFile(input: {
  userId: string;
  projectId: string;
  path: string;
  content: string;
  lang?: string;
}): { file: ProjectFile } | { error: string; code: SaveFileErrorCode } {
  /**
   * Every refusal carries a code as well as a sentence, because two callers now show
   * this message — the files tab, and the "Apply to file" button on a chat answer — and
   * a UI that can only grep prose cannot tell "path is invalid" from "you have 40 files".
   */
  const path = normalizeFilePath(input.path);
  if (!path) return { error: "Invalid file path.", code: "INVALID_PATH" };

  const content = String(input.content ?? "");
  if (content.length > MAX_FILE_CHARS) {
    return { error: "File too large — keep it under 120,000 characters.", code: "FILE_TOO_LARGE" };
  }

  const db = read();
  const project = db.projects.find(
    (p) => p.id === input.projectId && p.userId === input.userId
  );
  if (!project) return { error: "Project not found.", code: "PROJECT_NOT_FOUND" };

  const now = new Date().toISOString();
  const existing = db.projectFiles.find(
    (f) =>
      f.projectId === input.projectId &&
      f.userId === input.userId &&
      f.path === path
  );

  if (existing) {
    existing.content = content;
    existing.lang = input.lang || existing.lang || guessLang(path);
    existing.updatedAt = now;
    write(db);
    return { file: existing };
  }

  const count = db.projectFiles.filter(
    (f) => f.projectId === input.projectId && f.userId === input.userId
  ).length;
  if (count >= MAX_FILES_PER_PROJECT) {
    return { error: `Project file limit reached (${MAX_FILES_PER_PROJECT}).`, code: "FILE_LIMIT" };
  }

  const file: ProjectFile = {
    id: uid("file"),
    userId: input.userId,
    projectId: input.projectId,
    path,
    content,
    lang: input.lang || guessLang(path),
    createdAt: now,
    updatedAt: now,
  };
  db.projectFiles.push(file);
  write(db);
  return { file };
}

export function deleteProjectFile(id: string, userId: string) {
  const db = read();
  const before = db.projectFiles.length;
  db.projectFiles = db.projectFiles.filter(
    (f) => !(f.id === id && f.userId === userId)
  );
  const removed = db.projectFiles.length < before;
  if (removed) write(db);
  return removed;
}

/**
 * `buildProjectContext` used to live here. Formatting a project into a prompt block is
 * not storage, and it needed statistics (what was cut, what was omitted) that a returned
 * string cannot carry — so it is `formatProjectContext` in `lib/ai/workspace-context.ts`,
 * which takes rows from `listProjectFiles` and is testable without a store.
 */

export function setConversationProject(
  conversationId: string,
  userId: string,
  projectId: string | null
) {
  const db = read();
  const c = db.conversations.find(
    (x) => x.id === conversationId && x.userId === userId
  );
  if (!c) return null;
  if (projectId && !db.projects.some((p) => p.id === projectId && p.userId === userId)) {
    return null;
  }
  c.projectId = projectId;
  c.updatedAt = new Date().toISOString();
  write(db);
  void upsertRemoteConversation(c);
  return c;
}

/* ── Shares (public read-only links) ─────────────────────── */

export function createShare(conversationId: string, userId: string) {
  const db = read();
  const c = db.conversations.find(
    (x) => x.id === conversationId && x.userId === userId
  );
  if (!c) return null;
  // reuse an existing share for the same conversation
  const existing = db.shares.find((s) => s.conversationId === conversationId);
  if (existing) {
    existing.messages = c.messages;
    existing.title = c.title;
    existing.mode = c.mode;
    write(db);
    return existing;
  }
  const s: Share = {
    id: randomBytes(8).toString("base64url"),
    conversationId,
    userId,
    title: c.title,
    mode: c.mode,
    messages: c.messages,
    views: 0,
    createdAt: new Date().toISOString(),
  };
  db.shares.unshift(s);
  capSharesPerOwner(db, userId);
  write(db);
  return s;
}

/**
 * Per-owner cap (was a global slice that evicted other users' share links). Both share
 * creators call this: a cap that only one of two entry points honours is not a cap.
 */
function capSharesPerOwner(db: DB, userId: string) {
  const mineShares = db.shares.filter((x) => x.userId === userId);
  if (mineShares.length > RETENTION.sharesPerUser) {
    const keep = new Set(
      mineShares.slice(0, RETENTION.sharesPerUser).map((x) => x.id)
    );
    db.shares = db.shares.filter((x) => x.userId !== userId || keep.has(x.id));
  }
}

export function getShare(id: string) {
  return read().shares.find((s) => s.id === id) || null;
}

/**
 * One view, counted. Returns the number to show, so a client that could not reach this
 * keeps displaying the count the page rendered with instead of inventing one.
 */
export function bumpShareViews(id: string): { ok: boolean; views: number } {
  const db = read();
  const s = db.shares.find((x) => x.id === id);
  if (!s) return { ok: false, views: 0 };
  s.views += 1;
  write(db);
  return { ok: true, views: s.views };
}

export function deleteSharesForConversation(conversationId: string) {
  const db = read();
  db.shares = db.shares.filter((s) => s.conversationId !== conversationId);
  write(db);
}

/* ── Payments ────────────────────────────────────────────── */

export function addPayment(input: Omit<Payment, "id" | "createdAt">) {
  const db = read();
  const row: Payment = {
    ...input,
    id: uid("pay"),
    createdAt: new Date().toISOString(),
  };
  db.payments.unshift(row);
  // Per-owner cap — a payment record is a financial trail; one user's
  // activity must never evict another user's receipts.
  const minePay = db.payments.filter((x) => x.userId === input.userId);
  if (minePay.length > RETENTION.paymentsPerUser) {
    const keep = new Set(
      minePay.slice(0, RETENTION.paymentsPerUser).map((x) => x.id)
    );
    db.payments = db.payments.filter(
      (x) => x.userId !== input.userId || keep.has(x.id)
    );
  }
  write(db);
  return row;
}

export function findPaymentByOrder(orderId: string) {
  return read().payments.find((p) => p.orderId === orderId) || null;
}

/**
 * Compare-and-swap the payment status. Only the caller that flips `created`
 * to the target status owns the consequence (granting PRO), which is what
 * makes a replayed verify harmless. Returns null when nothing was flipped.
 */
export function markPaymentPaidIfPending(
  id: string,
  paymentId: string | null,
  status: "paid" | "failed",
  amountPaid?: number,
  currency?: string
): Payment | null {
  const db = read();
  const i = db.payments.findIndex((p) => p.id === id);
  if (i < 0 || db.payments[i].status !== "created") return null;
  db.payments[i] = {
    ...db.payments[i],
    status,
    ...(paymentId ? { paymentId } : {}),
    ...(typeof amountPaid === "number" ? { amountPaid } : {}),
    ...(currency ? { currency } : {}),
  };
  write(db);
  return db.payments[i];
}

/* ── Credits (Wave 2) ─────────────────────────────────────
 *
 * The whole economy in four primitives: `grant`, `spend`, `refund`, `balance`.
 * A grant with a `refId` is **idempotent** — that single rule is what makes a
 * replayed Razorpay verify (or a webhook plus a client both landing) credit
 * once instead of twice.
 *
 * The balance lives on the wallet row and every movement is mirrored into
 * `creditLedger`. If those two ever disagree, the ledger wins and the wallet is
 * rebuilt: a user's money must not depend on a cache that a crashed write left
 * behind.
 */

export function getWallet(userId: string): Wallet {
  const db = read();
  const w = db.wallets.find((x) => x.userId === userId);
  if (w) return w;
  return {
    userId,
    balance: 0,
    welcomeAt: null,
    proGrantPeriod: null,
    updatedAt: new Date().toISOString(),
  };
}

export function getBalance(userId: string): number {
  return getWallet(userId).balance;
}

function upsertWallet(db: DB, userId: string, patch: Partial<Wallet>): Wallet {
  const i = db.wallets.findIndex((w) => w.userId === userId);
  const now = new Date().toISOString();
  if (i < 0) {
    const row: Wallet = {
      userId,
      balance: 0,
      welcomeAt: null,
      proGrantPeriod: null,
      updatedAt: now,
      ...patch,
    };
    db.wallets.push(row);
    return row;
  }
  db.wallets[i] = { ...db.wallets[i], ...patch, updatedAt: now };
  return db.wallets[i];
}

function pushCreditRow(
  db: DB,
  row: Omit<CreditRow, "id" | "createdAt">
): CreditRow {
  const full: CreditRow = { ...row, id: uid("crl"), createdAt: new Date().toISOString() };
  db.creditLedger.unshift(full);
  const mine = db.creditLedger.filter((c) => c.userId === row.userId);
  if (mine.length > RETENTION.creditLedgerPerUser) {
    const keep = new Set(
      mine.slice(0, RETENTION.creditLedgerPerUser).map((c) => c.id)
    );
    db.creditLedger = db.creditLedger.filter(
      (c) => c.userId !== row.userId || keep.has(c.id)
    );
  }
  return full;
}

/**
 * Mint credits. `refId` makes it once-only: the welcome grant, a paid top-up
 * and the PRO monthly grant all rely on this.
 */
export function grantCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  refId?: string;
}) {
  const amount = Math.floor(Number(input.amount) || 0);
  if (amount <= 0) return { ok: false as const, error: "amount must be positive", row: null };
  const db = read();
  if (input.refId) {
    const dupe = db.creditLedger.find(
      (c) => c.userId === input.userId && c.refId === input.refId
    );
    if (dupe) {
      return { ok: false as const, error: "already granted", row: dupe, duplicate: true };
    }
  }
  const w = db.wallets.find((x) => x.userId === input.userId);
  const balance = (w?.balance ?? 0) + amount;
  upsertWallet(db, input.userId, { balance });
  const row = pushCreditRow(db, {
    userId: input.userId,
    delta: amount,
    reason: input.reason,
    refId: input.refId || null,
    balanceAfter: balance,
  });
  write(db);
  return { ok: true as const, error: undefined, row, balance, duplicate: false };
}

/**
 * Spend credits. Fails closed: not enough balance, or no wallet at all.
 * A refund must carry the same `refId` with a `:refund` suffix so a retry can't
 * double-refund either.
 */
export function spendCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  refId?: string;
}): { ok: boolean; balance: number; needed: number; row: CreditRow | null } {
  const amount = Math.max(1, Math.floor(Number(input.amount) || 1));
  const db = read();
  const w = db.wallets.find((x) => x.userId === input.userId);
  const balance = w?.balance ?? 0;
  if (balance < amount) {
    return { ok: false, balance, needed: amount, row: null };
  }
  const next = balance - amount;
  upsertWallet(db, input.userId, { balance: next });
  const row = pushCreditRow(db, {
    userId: input.userId,
    delta: -amount,
    reason: input.reason,
    refId: input.refId || null,
    balanceAfter: next,
  });
  write(db);
  return { ok: true, balance: next, needed: amount, row };
}

/** Give credits back for work that did not happen. */
export function refundCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  refId?: string;
}) {
  const refundRef = input.refId ? `${input.refId}:refund` : undefined;
  if (refundRef) {
    const db = read();
    if (db.creditLedger.some((c) => c.userId === input.userId && c.refId === refundRef)) {
      return { ok: false as const, error: "already refunded" };
    }
  }
  return grantCredits({
    userId: input.userId,
    amount: input.amount,
    reason: input.reason,
    ...(refundRef ? { refId: refundRef } : {}),
  });
}

/** Signup grant — once per account, keyed on the user id. */
export function grantWelcomeCredits(userId: string, amount: number) {
  const w = getWallet(userId);
  if (w.welcomeAt) return { ok: false as const, reason: "already granted", balance: w.balance };
  const res = grantCredits({
    userId,
    amount,
    reason: "welcome",
    refId: `welcome:${userId}`,
  });
  if (res.ok) {
    const db = read();
    upsertWallet(db, userId, { welcomeAt: new Date().toISOString() });
    write(db);
  }
  return {
    ok: res.ok,
    reason: res.ok ? "granted" : res.error,
    balance: res.ok ? res.balance : getWallet(userId).balance,
  };
}

/**
 * PRO's monthly allowance. Driven by reads of the wallet rather than a cron
 * job, because this deployment has no scheduler: the period key means at most
 * one grant per calendar month per account, whichever request happens to
 * arrive first.
 */
/** The seat multiplier on this account's paid plan. 1 for guests and for every pre-seats account. */
export function planSeatsOf(userId: string): number {
  const n = Math.floor(findUserById(userId)?.planSeats || 1);
  return n > 1 ? n : 1;
}

export function maybeGrantProMonthly(userId: string, plan: Plan, amount: number) {
  if (plan !== "pro" || amount <= 0) return { granted: 0, balance: getBalance(userId) };
  const period = new Date().toISOString().slice(0, 7);
  const w = getWallet(userId);
  if (w.proGrantPeriod === period) return { granted: 0, balance: w.balance };
  const res = grantCredits({
    userId,
    amount,
    reason: `pro-monthly:${period}`,
    refId: `pro:${period}:${userId}`,
  });
  if (res.ok) {
    const db = read();
    upsertWallet(db, userId, { proGrantPeriod: period });
    write(db);
    return { granted: amount, balance: res.balance };
  }
  return { granted: 0, balance: getBalance(userId) };
}

export function listCreditLedger(userId: string, limit = 40) {
  return read()
    .creditLedger.filter((c) => c.userId === userId)
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

/**
 * Rebuild a wallet from its ledger. Only used when the two disagree — which is
 * the state a crashed or merged write can leave this JSON store in, and the
 * moment to trust the audit trail rather than the cache.
 */
export function reconcileWallet(userId: string) {
  const db = read();
  const rows = db.creditLedger.filter((c) => c.userId === userId);
  if (!rows.length) return { ok: true, balance: db.wallets.find((w) => w.userId === userId)?.balance ?? 0, rows: 0 };
  const sum = rows.reduce((n, r) => n + (Number(r.delta) || 0), 0);
  const w = db.wallets.find((x) => x.userId === userId);
  if (w && w.balance === sum) return { ok: true, balance: sum, rows: rows.length };
  upsertWallet(db, userId, { balance: sum });
  write(db);
  return { ok: false, balance: sum, rows: rows.length };
}

/**
 * Claim a one-time token. True the first time a (scope, token) pair is seen,
 * false on every replay or after expiry.
 */
export function consumeTokenOnce(
  scope: string,
  token: string,
  userId: string,
  ttlMs = 7 * 24 * 3600_000
): boolean {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = read();
  if (db.consumedTokens.some((t) => t.scope === scope && t.tokenHash === tokenHash)) {
    return false;
  }
  const now = Date.now();
  db.consumedTokens = db.consumedTokens.filter((t) => t.expiresAt > now);
  db.consumedTokens.unshift({
    id: uid("tok"),
    scope,
    tokenHash,
    userId,
    expiresAt: now + ttlMs,
  });
  // Bound the ledger of spent tokens — it is a security log, not a archive.
  if (db.consumedTokens.length > 5_000) {
    db.consumedTokens = db.consumedTokens.slice(0, 5_000);
  }
  write(db);
  return true;
}

export function updatePayment(
  id: string,
  patch: Partial<Pick<Payment, "status" | "paymentId">>
) {
  const db = read();
  const i = db.payments.findIndex((p) => p.id === id);
  if (i < 0) return null;
  db.payments[i] = { ...db.payments[i], ...patch };
  write(db);
  return db.payments[i];
}

/* ── API keys (developer platform) ───────────────────────── */

export function listApiKeys(userId: string) {
  return read()
    .apiKeys.filter((k) => k.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addApiKey(input: Omit<ApiKey, "id" | "createdAt">) {
  const db = read();
  const row: ApiKey = {
    ...input,
    id: uid("key"),
    createdAt: new Date().toISOString(),
  };
  db.apiKeys.unshift(row);
  if (db.apiKeys.filter((k) => k.userId === input.userId).length > 10) {
    // keep newest 10 per user
    const mine = db.apiKeys.filter((k) => k.userId === input.userId);
    const oldest = mine[mine.length - 1];
    db.apiKeys = db.apiKeys.filter((k) => k.id !== oldest.id);
  }
  write(db);
  return row;
}

export function deleteApiKey(id: string, userId: string) {
  const db = read();
  const before = db.apiKeys.length;
  db.apiKeys = db.apiKeys.filter((k) => !(k.id === id && k.userId === userId));
  if (db.apiKeys.length === before) return false;
  write(db);
  return true;
}

export function findApiKeyByHash(keyHash: string) {
  return read().apiKeys.find((k) => k.keyHash === keyHash) || null;
}

export function touchApiKey(id: string) {
  const db = read();
  const k = db.apiKeys.find((x) => x.id === id);
  if (k) {
    k.lastUsedAt = new Date().toISOString();
    write(db);
  }
}

/* ── Teams (workspaces) ──────────────────────────────────── */

export function listTeams(userId: string) {
  return read()
    .teams.filter((t) => t.members.some((m) => m.userId === userId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getTeam(id: string) {
  return read().teams.find((t) => t.id === id) || null;
}

export function isTeamMember(teamId: string, userId: string) {
  const t = getTeam(teamId);
  return Boolean(t?.members.some((m) => m.userId === userId));
}

export function createTeam(input: {
  userId: string;
  name: string;
  email?: string;
  userName?: string;
}) {
  const db = read();
  const now = new Date().toISOString();
  const team: Team = {
    id: uid("team"),
    name: input.name.trim().slice(0, 40) || "New team",
    ownerId: input.userId,
    members: [
      {
        userId: input.userId,
        email: input.email,
        name: input.userName,
        role: "owner",
        joinedAt: now,
      },
    ],
    invites: [],
    createdAt: now,
  };
  db.teams.push(team);
  write(db);
  return team;
}

export function findTeamByInviteCode(code: string) {
  const c = code.trim().toUpperCase();
  return read().teams.find((t) => t.invites.some((i) => i.code === c)) || null;
}

export function joinTeamByCode(
  code: string,
  member: { userId: string; email?: string; name?: string }
) {
  const db = read();
  const c = code.trim().toUpperCase();
  // look up inside the SAME db object we later write (avoid stale-reference bug)
  const team = db.teams.find((t) => t.invites.some((i) => i.code === c));
  if (!team) return { error: "Invalid or expired invite code." as const };
  if (team.members.some((m) => m.userId === member.userId)) {
    return { error: "You are already in this team." as const };
  }
  team.members.push({
    userId: member.userId,
    email: member.email,
    name: member.name,
    role: "member",
    joinedAt: new Date().toISOString(),
  });
  write(db);
  return { team };
}

export function newTeamInvite(teamId: string, userId: string) {
  const db = read();
  const team = db.teams.find(
    (t) => t.id === teamId && t.members.some((m) => m.userId === userId)
  );
  if (!team) return null;
  // reuse the freshest invite if one exists
  if (team.invites.length) return team.invites[team.invites.length - 1].code;
  const code = randomBytes(4).toString("hex").toUpperCase();
  team.invites.push({ code, createdAt: new Date().toISOString() });
  team.invites = team.invites.slice(-3);
  write(db);
  return code;
}

export function leaveTeam(teamId: string, userId: string) {
  const db = read();
  const team = db.teams.find((t) => t.id === teamId);
  if (!team) return { error: "Team not found." as const };
  if (!team.members.some((m) => m.userId === userId)) {
    return { error: "You are not in this team." as const };
  }
  if (team.ownerId === userId) {
    // owner leaving dissolves the team; team chats stay with their creators
    db.teams = db.teams.filter((t) => t.id !== teamId);
    for (const c of db.conversations) {
      if (c.teamId === teamId) c.teamId = null;
    }
    write(db);
    return { dissolved: true as const };
  }
  team.members = team.members.filter((m) => m.userId !== userId);
  write(db);
  return { left: true as const };
}

export function setConversationTeam(
  conversationId: string,
  userId: string,
  teamId: string | null
) {
  const db = read();
  const c = db.conversations.find((x) => x.id === conversationId);
  if (!c) return null;
  // only the chat owner (or same-team member) may move it
  const isOwner = c.userId === userId;
  const isSameTeam = c.teamId ? isTeamMember(c.teamId, userId) : false;
  if (!isOwner && !isSameTeam) return null;
  if (teamId && !isTeamMember(teamId, userId)) return null;
  c.teamId = teamId;
  c.updatedAt = new Date().toISOString();
  write(db);
  void upsertRemoteConversation(c);
  return c;
}

/** Sidebar list cap — the rail cannot usefully show 200 full threads. */
export const HISTORY_LIST_CAP = 80;

export type ConversationSummary = {
  id: string;
  title: string;
  mode: Conversation["mode"];
  updatedAt: string;
  preview: string;
  messageCount: number;
  projectId: string | null;
  teamId: string | null;
  mine: boolean;
};

export function summarizeConversation(c: Conversation, viewerId: string): ConversationSummary {
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id,
    title: c.title,
    mode: c.mode,
    updatedAt: c.updatedAt,
    preview: String(last?.content || "").replace(/\s+/g, " ").slice(0, 100),
    messageCount: c.messages.length,
    projectId: c.projectId ?? null,
    teamId: c.teamId ?? null,
    mine: c.userId === viewerId,
  };
}

/**
 * Whether this viewer may use a conversation id.
 * `forbidden` means the row exists and is not theirs — callers must 404, not
 * recreate a shell, or the store grows a duplicate id.
 */
export function conversationAccess(
  id: string,
  userId: string
): "ok" | "missing" | "forbidden" {
  const c = read().conversations.find((x) => x.id === id);
  if (!c) return "missing";
  if (c.userId === userId) return "ok";
  if (c.teamId && isTeamMember(c.teamId, userId)) return "ok";
  return "forbidden";
}

/**
 * Same as `conversationAccess`, but a cold instance hydrates this owner's
 * rows first so a conversationId the client still holds is not treated as
 * missing (and then recreated as an empty shell that hides the real thread).
 */
export async function ensureConversationAccess(
  id: string,
  userId: string
): Promise<"ok" | "missing" | "forbidden"> {
  const first = conversationAccess(id, userId);
  if (first !== "missing") return first;
  await hydrateConversationsForUser(userId);
  return conversationAccess(id, userId);
}

/** One chat, if this viewer may see it. Does not scan every other thread. */
export function getVisibleConversation(id: string, userId: string) {
  const db = read();
  const c = db.conversations.find((x) => x.id === id) || null;
  if (!c) return null;
  if (c.userId === userId) return c;
  if (c.teamId && isTeamMember(c.teamId, userId)) return c;
  return null;
}

/** Conversations visible to a user: own + their teams' */
export function listVisibleConversations(userId: string) {
  const db = read();
  const teamIds = new Set(
    db.teams
      .filter((t) => t.members.some((m) => m.userId === userId))
      .map((t) => t.id)
  );
  return db.conversations
    .filter(
      (c) => c.userId === userId || (c.teamId && teamIds.has(c.teamId))
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listVisibleConversationSummaries(
  userId: string,
  cap = HISTORY_LIST_CAP
) {
  const all = listVisibleConversations(userId);
  const n = Math.max(1, Math.min(Math.floor(cap) || HISTORY_LIST_CAP, HISTORY_LIST_CAP));
  return {
    conversations: all.slice(0, n).map((c) => summarizeConversation(c, userId)),
    total: all.length,
    capped: all.length > n,
  };
}

/**
 * Pull this owner's chats (and their teams') from Postgres and merge them
 * into the in-process store. History GET awaits this so a cold serverless
 * instance still has the thread the user left yesterday.
 *
 * Does not push the JSON blob: a partial snapshot would erase everyone else.
 */
export async function hydrateConversationsForUser(userId: string): Promise<void> {
  if (!remoteDbEnabled() || !userId) return;
  try {
    const db = read();
    const teamIds = db.teams
      .filter((t) => t.members.some((m) => m.userId === userId))
      .map((t) => t.id);
    const remote = await pullRemoteConversations(userId, teamIds);
    if (!remote.length) return;
    const fresh = read();
    const visible = (c: Conversation) =>
      c.userId === userId || (c.teamId != null && teamIds.includes(c.teamId));
    // `remote.Conversation.mode` is a loose string (whatever the row holds);
    // the store's is a union. Narrow at this boundary so a row written by an
    // older/newer version cannot smuggle an unknown mode into the store.
    const MODES: Conversation["mode"][] = ["auto", "chat", "code", "image", "audio"];
    const narrow = (c: unknown): Conversation | null => {
      const ok = asConversation(c);
      if (!ok) return null;
      return MODES.includes(ok.mode as Conversation["mode"])
        ? (ok as Conversation)
        : ({ ...ok, mode: "chat" } as Conversation);
    };
    const incoming = remote
      .map(narrow)
      .filter((c): c is Conversation => c !== null && visible(c));
    const { next, changed } = mergeConversationLists(fresh.conversations, incoming);
    if (!changed) return;
    // `next` is typed with remote's loose `mode`; every element came from
    // `narrow()` or was already in the store, so both sides are the store shape.
    fresh.conversations = next as Conversation[];
    write(fresh, { mirror: false, touchBoot: false });
  } catch (e) {
    console.error("[bw] hydrate conversations", e);
  }
}

export async function adoptGuestConversations(guestId: string, userId: string): Promise<void> {
  if (!remoteDbEnabled() || !guestId || !userId || guestId === userId) return;
  try {
    await reassignRemoteConversations(guestId, userId);
  } catch (e) {
    console.error("[bw] reassign conversations", e);
  }
}

/* ── Generations ─────────────────────────────────────────── */

export function addGeneration(g: Omit<Generation, "id" | "createdAt">) {
  const db = read();
  const row: Generation = {
    ...g,
    id: uid("gen"),
    createdAt: new Date().toISOString(),
  };
  db.generations.unshift(row);
  // Per-owner cap (was global slice(0,300), which deleted other users' work).
  const mineGen = db.generations.filter((x) => x.userId === g.userId);
  if (mineGen.length > RETENTION.generationsPerUser) {
    const keep = new Set(
      mineGen.slice(0, RETENTION.generationsPerUser).map((x) => x.id)
    );
    db.generations = db.generations.filter(
      (x) => x.userId !== g.userId || keep.has(x.id)
    );
  }
  write(db);
  return row;
}

export function listGenerations(userId: string, type?: Generation["type"]) {
  return read()
    .generations.filter((g) => g.userId === userId && (!type || g.type === type))
    .slice(0, 100);
}

/* ── Artifacts — the generations a user keeps and shows ──── */

/** Longest title the creations panel accepts. Refused, never truncated. */
/**
 * The question that produced one answer, plus the answer. Both "share this" and "keep this"
 * need the pair — an answer shown alone reads as an excerpt out of nowhere — so the rule for
 * "the user message before it" lives here once rather than in two features that could
 * disagree. An assistant message with no question above it is still shareable: the loop simply
 * finds nothing, and the caller decides that a lone answer is enough.
 *
 * A conversation belonging to someone else returns the same `null` as a missing one, so a
 * guessed id reads as "not found" and never as another person's data.
 */
export function findAnswerPair(
  conversationId: string,
  messageId: string,
  userId: string
): { conversation: Conversation; message: Message; question: Message | null } | null {
  const c = read().conversations.find((x) => x.id === conversationId && x.userId === userId);
  if (!c) return null;
  const at = c.messages.findIndex((m) => m.id === messageId);
  if (at < 0) return null;
  const message = c.messages[at];
  // Only BUILDWE's own writing can be shared or kept this way. Saving someone's pasted-in
  // question as a "creation" is not a thing anybody asked for.
  if (message.role !== "assistant") return null;
  let question: Message | null = null;
  for (let i = at - 1; i >= 0; i--) {
    if (c.messages[i].role === "user") {
      question = c.messages[i];
      break;
    }
  }
  return { conversation: c, message, question };
}

/** The shortest thing worth a row of its own: "ok", "sure!" and apologies are not creations. */
const ANSWER_MIN_CHARS = 40;

/**
 * Promote one answer into the creations list. Idempotent by `meta.from.messageId`: pressing the
 * button twice updates the same row (so a re-run after an edit is not a second copy in the
 * panel), which is what `createArtifactShare` already does for links and for the same reason —
 * a duplicate the user has to notice and delete is not a feature.
 */
export function saveAnswerAsArtifact(
  conversationId: string,
  messageId: string,
  userId: string
): { ok: true; artifact: Generation; created: boolean } | { ok: false; code: "ANSWER_NOT_FOUND" | "ANSWER_TOO_SHORT" } {
  const pair = findAnswerPair(conversationId, messageId, userId);
  if (!pair) return { ok: false, code: "ANSWER_NOT_FOUND" };
  const body = pair.message.content.trim();
  if (body.length < ANSWER_MIN_CHARS) return { ok: false, code: "ANSWER_TOO_SHORT" };

  const db = read();
  const from = { conversationId, messageId };
  const existing = db.generations.find(
    (g) =>
      g.userId === userId &&
      ((g.meta as { from?: { messageId?: string } } | undefined)?.from?.messageId === messageId)
  );
  if (existing) {
    existing.outputText = body;
    if (pair.question) existing.prompt = pair.question.content;
    existing.meta = { ...(existing.meta || {}), from, conversationTitle: pair.conversation.title };
    write(db);
    return { ok: true, artifact: existing, created: false };
  }
  const row = addGeneration({
    userId,
    type: "text",
    prompt: (pair.question ? pair.question.content : pair.conversation.title).slice(0, 4_000),
    outputText: body,
    meta: { from, conversationTitle: pair.conversation.title },
  });
  return { ok: true, artifact: row, created: true };
}

/** The link a given answer already has, if any — so a row can say "Shared" rather than guess. */
export function findShareByMessage(conversationId: string, messageId: string): Share | null {
  return read().shares.find((s) => s.conversationId === conversationId && s.messageId === messageId) || null;
}

/**
 * A public page for ONE answer: the question and the reply, snapshotted. Everything the whole-chat
 * share already does is inherited rather than re-made — the same `shares` table, the same
 * `capSharesPerOwner`, the same server-rendered `/s/[id]`, the same `action:"view"` counter — and
 * deleting the conversation deletes this too because `deleteSharesForConversation` filters by
 * `conversationId`, which this row carries.
 */
export function createMessageShare(
  conversationId: string,
  messageId: string,
  userId: string
): { ok: true; share: Share } | { ok: false; code: "ANSWER_NOT_FOUND" } {
  const pair = findAnswerPair(conversationId, messageId, userId);
  if (!pair) return { ok: false, code: "ANSWER_NOT_FOUND" };
  const messages = pair.question ? [pair.question, pair.message] : [pair.message];
  const label = (pair.question?.content || pair.conversation.title)
    .replace(/[\r\n]+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim()
    .slice(0, 80);

  const db = read();
  const existing = db.shares.find(
    (s) => s.conversationId === conversationId && s.messageId === messageId
  );
  if (existing) {
    existing.messages = messages;
    existing.title = label;
    existing.mode = pair.conversation.mode;
    write(db);
    return { ok: true, share: existing };
  }
  const s: Share = {
    id: randomBytes(8).toString("base64url"),
    conversationId,
    artifactId: null,
    messageId,
    userId,
    title: label,
    mode: pair.conversation.mode,
    messages,
    views: 0,
    createdAt: new Date().toISOString(),
  };
  db.shares.unshift(s);
  capSharesPerOwner(db, userId);
  write(db);
  return { ok: true, share: s };
}


export const ARTIFACT_TITLE_MAX = 120;

export type ArtifactPatch = { title?: string | null; pinned?: boolean };
export type ArtifactResult =
  | { ok: true; artifact: Generation }
  | { ok: false; code: "ARTIFACT_NOT_FOUND" | "TITLE_TOO_LONG" | "NOTHING_TO_CHANGE" };

/**
 * One owner's artifacts, pinned first and then newest.
 *
 * `listGenerations` stays the raw log the studios restore from — image/audio rows in the
 * order they were made, vision analyses included. This is the *curation* view over the
 * same rows, so the two have different filters on purpose: a vision analysis is text
 * about somebody's upload, not something they created, and it would sit in a list of
 * "your creations" as a row with nothing to open.
 *
 * `filter` copies the array, so the sort cannot reorder the stored log.
 */
export function listArtifacts(userId: string, type?: Generation["type"]) {
  return read()
    .generations.filter(
      (g) =>
        g.userId === userId &&
        (!type || g.type === type) &&
        (g.meta as { kind?: string } | undefined)?.kind !== "vision"
    )
    .sort((a, b) => {
      const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pin) return pin;
      return a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1;
    })
    .slice(0, 100);
}

/** Full row, including the untruncated text — the canvas needs the whole file. */
export function getArtifact(id: string, userId: string): Generation | null {
  const g = read()
    .generations.find((x) => x.id === id && x.userId === userId);
  return g || null;
}

export function updateArtifact(
  id: string,
  userId: string,
  patch: ArtifactPatch
): ArtifactResult {
  const db = read();
  const g = db.generations.find((x) => x.id === id && x.userId === userId);
  if (!g) return { ok: false, code: "ARTIFACT_NOT_FOUND" };

  const touched: string[] = [];
  if (patch.title !== undefined) {
    const next = String(patch.title ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, ARTIFACT_TITLE_MAX + 10);
    if (next.length > ARTIFACT_TITLE_MAX) {
      return { ok: false, code: "TITLE_TOO_LONG" };
    }
    if (next) g.title = next;
    else delete g.title;
    touched.push("title");
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned) g.pinned = true;
    else delete g.pinned;
    touched.push("pinned");
  }
  // An empty PATCH is a bug in the caller, not a write: the store rewrites the whole
  // document, and doing it for nothing is how a list starts costing disk on focus.
  if (!touched.length) return { ok: false, code: "NOTHING_TO_CHANGE" };
  write(db);
  return { ok: true, artifact: g };
}

/**
 * Deleting an artifact takes its public link with it. A share that outlives its source is
 * a page nobody can un-publish, and the snapshot is a copy of content the owner just
 * chose to throw away.
 */
export function deleteArtifact(id: string, userId: string): { ok: boolean } {
  const db = read();
  const before = db.generations.length;
  db.generations = db.generations.filter((x) => !(x.id === id && x.userId === userId));
  if (db.generations.length === before) return { ok: false };
  db.shares = db.shares.filter((x) => x.artifactId !== id);
  write(db);
  return { ok: true };
}

export function findShareByArtifact(artifactId: string): Share | null {
  return read().shares.find((s) => s.artifactId === artifactId) || null;
}

/**
 * What a shared artifact page shows. Deliberately markdown-as-text, because the share
 * page renders through `renderSafeMarkdown`, which allow-lists links and code fences and
 * not raw HTML: an image is a link to the file we host, never an `<img>` injected here.
 *
 * Returns null when there is nothing to show — an audio row whose file was never
 * persisted (no media storage configured) has a transcript but no sound, and calling
 * that shareable would be a link to a half-artifact.
 */
export function artifactShareBody(g: Generation): string | null {
  const url = g.outputUrl && /^https?:/i.test(g.outputUrl) ? g.outputUrl : null;
  const label = String(g.title || g.prompt || "Untitled")
    .replace(/[\[\]]/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (g.type === "text") {
    // Already markdown, from a model that writes markdown: fenced it would turn a whole answer
    // into one grey block, and the point of sharing an answer is that it reads like an answer.
    const prose = String(g.outputText || "").trim();
    return prose ? `**${label}**\n\n${prose}` : null;
  }
  if (g.type === "code") {
    const code = String(g.outputText || "").trim();
    if (!code) return null;
    // A fence inside the code would close ours early and the rest of the file would
    // render as prose, so the opener is one backtick longer than anything inside it.
    const run = (code.match(/`{3,}/g) || []).reduce((m, f) => Math.max(m, f.length), 2);
    const fence = "`".repeat(run + 1);
    const ask = String(g.prompt || "").replace(/[\r\n]+/g, " ").trim();
    return `${ask ? `**Prompt:** ${ask}\n\n` : ""}${fence}txt\n${code}\n${fence}`;
  }
  if (!url) return null;
  if (g.type === "audio") {
    const meta = (g.meta || {}) as { voice?: string };
    return `**${label}**\n\n[Play the audio](${url})${
      meta.voice ? `\n\nVoice: ${meta.voice}` : ""
    }`;
  }
  const meta = (g.meta || {}) as { model?: string; aspect?: string };
  return `**${label}**\n\n[Open the image](${url})${
    meta.aspect || meta.model
      ? `\n\n${[meta.aspect, meta.model].filter(Boolean).join(" · ")}`
      : ""
  }`;
}

/**
 * A public link for one output. Same `shares` table and the same `/s/<id>` page as a
 * conversation share: the page reads `messages`, so a snapshot of "the prompt, then this
 * answer" is everything a reader needs, and building a second share surface would mean a
 * second retention cap, a second view counter and a second delete path to forget.
 */
export function createArtifactShare(
  artifactId: string,
  userId: string
): { ok: true; share: Share } | { ok: false; code: "ARTIFACT_NOT_FOUND" | "NOTHING_TO_SHARE" } {
  const db = read();
  const g = db.generations.find((x) => x.id === artifactId && x.userId === userId);
  if (!g) return { ok: false, code: "ARTIFACT_NOT_FOUND" };
  const body = artifactShareBody(g);
  if (!body) return { ok: false, code: "NOTHING_TO_SHARE" };
  const title = (g.title || g.prompt || "Shared creation").slice(0, 80);
  // A saved answer is a conversation-shaped thing: question, then reply. `Share.mode` is what the
  // share page picks its framing from, and "text" is not one of its values on purpose.
  const mode: Conversation["mode"] =
    g.type === "code" ? "code" : g.type === "text" ? "chat" : g.type;

  const existing = db.shares.find((x) => x.artifactId === artifactId);
  if (existing) {
    // Re-sharing refreshes, exactly like createShare does for a conversation: the link a
    // user already sent should show what the artifact is now, not what it was at 3pm.
    existing.title = title;
    existing.mode = mode;
    existing.messages = snapshotMessages(g, body);
    write(db);
    return { ok: true, share: existing };
  }
  const s: Share = {
    id: randomBytes(8).toString("base64url"),
    conversationId: null,
    artifactId,
    userId,
    title,
    mode,
    messages: snapshotMessages(g, body),
    views: 0,
    createdAt: new Date().toISOString(),
  };
  db.shares.unshift(s);
  capSharesPerOwner(db, userId);
  write(db);
  return { ok: true, share: s };
}

function snapshotMessages(g: Generation, body: string): Message[] {
  const now = new Date(g.createdAt || Date.now()).toISOString();
  return [
    { id: uid("m"), role: "user", content: g.prompt || "", createdAt: now },
    { id: uid("m"), role: "assistant", content: body, createdAt: now },
  ];
}

/* ── Usage ───────────────────────────────────────────────── */

export function getUsage(userId: string) {
  const day = todayKey();
  const row = read().usage.find((u) => u.userId === userId && u.day === day);
  return row || { userId, day, chat: 0, code: 0, image: 0, audio: 0 };
}

export function bumpUsage(
  userId: string,
  feature: "chat" | "code" | "image" | "audio",
  n = 1
) {
  const db = read();
  const day = todayKey();
  let row = db.usage.find((u) => u.userId === userId && u.day === day);
  if (!row) {
    row = { userId, day, chat: 0, code: 0, image: 0, audio: 0 };
    db.usage.push(row);
  }
  row[feature] += n;
  write(db);
  return row;
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    plan: u.plan,
    skills: u.skills,
    createdAt: u.createdAt,
  };
}

/* ── Guest → account migration (audit V5) ─────────────────────
 *
 * Before this, registering as a guest silently orphaned everything the
 * visitor had made: conversations, projects, shares and generations stayed
 * bound to the old `guest_…` id and vanished from their account forever.
 *
 * migrateGuestData() re-points those rows at the real user id. It is
 * deliberately additive and idempotent:
 *   - only ever moves rows still owned by the guest id
 *   - never overwrites or deletes anything already owned by the account
 *   - usage counters are MERGED (summed per day) so migrating can't be used
 *     to reset a spent daily quota
 */
export function migrateGuestData(guestId: string, userId: string) {
  const moved: {
    conversations: number;
    projects: number;
    generations: number;
    shares: number;
    credits?: number;
  } = { conversations: 0, projects: 0, generations: 0, shares: 0 };

  if (
    !guestId ||
    !userId ||
    guestId === userId ||
    !guestId.startsWith("guest_")
  ) {
    return moved;
  }

  const db = read();

  for (const c of db.conversations) {
    if (c.userId === guestId) {
      c.userId = userId;
      moved.conversations += 1;
    }
  }
  for (const p of db.projects) {
    if (p.userId === guestId) {
      p.userId = userId;
      moved.projects += 1;
    }
  }
  for (const g of db.generations) {
    if (g.userId === guestId) {
      g.userId = userId;
      moved.generations += 1;
    }
  }
  for (const s of db.shares) {
    if (s.userId === guestId) {
      s.userId = userId;
      moved.shares += 1;
    }
  }

  // The wallet moves with the human, but the free signup grant does NOT stack.
  // Every credit is mirrored in the ledger and `reconcileWallet` treats that
  // ledger as the truth, so the transfer is done by repointing rows and then
  // setting the balance to what the rows now add up to - a balance edited on
  // its own would be overwritten by the next reconciliation.
  const guestWallet = db.wallets.find((w) => w.userId === guestId);
  const guestRows = db.creditLedger.filter((c) => c.userId === guestId);
  if (guestWallet || guestRows.length) {
    const guestWelcome = guestRows.find((c) => c.reason === "welcome") || null;
    const userWelcome = db.creditLedger.find(
      (c) => c.userId === userId && c.reason === "welcome"
    ) || null;
    for (const c of guestRows) c.userId = userId;

    const userWallet = db.wallets.find((w) => w.userId === userId);
    let balance = (userWallet?.balance || 0) + (guestWallet?.balance || 0);

    // Two welcome rows means the guest already used their one free grant: keep
    // the earlier one (it is the real first contact) and drop the fresh mint.
    if (guestWelcome && userWelcome) {
      db.creditLedger = db.creditLedger.filter((c) => c.id !== userWelcome.id);
      balance = Math.max(0, balance - CREDITS.welcome);
    }
    const welcomeAt =
      (guestWelcome && guestWelcome.createdAt) ||
      userWallet?.welcomeAt ||
      guestWallet?.welcomeAt ||
      null;

    const i = db.wallets.findIndex((w) => w.userId === userId);
    const now = new Date().toISOString();
    if (i < 0) {
      db.wallets.push({
        userId,
        balance,
        welcomeAt,
        proGrantPeriod: null,
        updatedAt: now,
      });
    } else {
      db.wallets[i] = { ...db.wallets[i], balance, welcomeAt, updatedAt: now };
    }
    db.wallets = db.wallets.filter((w) => w.userId !== guestId);
    db.creditLedger = db.creditLedger.filter((c) => c.userId !== guestId);
    moved.credits = balance;
  }

  // Merge usage rather than transfer — no quota laundering.
  const guestUsage = db.usage.filter((u) => u.userId === guestId);
  for (const gu of guestUsage) {
    const target = db.usage.find(
      (u) => u.userId === userId && u.day === gu.day
    );
    if (target) {
      target.chat += gu.chat;
      target.code += gu.code;
      target.image += gu.image;
      target.audio += gu.audio;
    } else {
      db.usage.push({ ...gu, userId });
    }
  }
  db.usage = db.usage.filter((u) => u.userId !== guestId);

  const touched =
    moved.conversations + moved.projects + moved.generations + moved.shares;
  // `moved.credits` is set whenever a guest wallet existed, even at balance 0.
  if (touched > 0 || guestUsage.length > 0 || moved.credits !== undefined) write(db);
  if (moved.conversations > 0) void reassignRemoteConversations(guestId, userId);

  return moved;
}

/* ── Link-preview cache ──────────────────────────────────── */

/** A good read is worth reusing for a day; a failed one for long enough to stop retrying per render. */
export const LINK_PREVIEW_OK_TTL_MS = 24 * 60 * 60 * 1000;
export const LINK_PREVIEW_FAIL_TTL_MS = 15 * 60 * 60 * 1000;
/** Global cap: previews are shared, so this is not a per-user trim and eviction is cheap. */
export const LINK_PREVIEW_MAX_ROWS = 500;

/** Derive the cache key. Never hand a raw URL to `linkPreviews` — see LinkPreviewRow. */
export function linkPreviewKey(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

export function findLinkPreview(key: string, now = Date.now()): LinkPreviewRow | null {
  const rows = read().linkPreviews;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.key !== key) continue;
    if (r.expiresAt <= now) return null; // expired: treated as absent, pruned on the next write
    return r;
  }
  return null;
}

export function saveLinkPreview(row: LinkPreviewRow): void {
  const db = read();
  db.linkPreviews = db.linkPreviews.filter(
    (r) => r.key !== row.key && r.expiresAt > row.fetchedAt
  );
  db.linkPreviews.unshift(row);
  if (db.linkPreviews.length > LINK_PREVIEW_MAX_ROWS) {
    db.linkPreviews = db.linkPreviews.slice(0, LINK_PREVIEW_MAX_ROWS);
  }
  write(db);
}

/**
 * Sum a user's usage across the current calendar month.
 *
 * PRO allowances are advertised as monthly, but the counters are stored per
 * day, so a monthly ceiling has to be aggregated — comparing a monthly limit
 * against a single day's row silently multiplied the real allowance by ~30.
 */
export function getMonthlyUsage(userId: string) {
  const prefix = todayKey().slice(0, 7); // "YYYY-MM"
  const rows = read().usage.filter(
    (u) => u.userId === userId && u.day.startsWith(prefix)
  );
  return rows.reduce(
    (acc, r) => ({
      userId,
      month: prefix,
      chat: acc.chat + r.chat,
      code: acc.code + r.code,
      image: acc.image + r.image,
      audio: acc.audio + r.audio,
    }),
    { userId, month: prefix, chat: 0, code: 0, image: 0, audio: 0 }
  );
}
