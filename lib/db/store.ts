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
import { pullRemoteDb, pushRemoteDb, remoteDbEnabled } from "./remote";
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
  conversationId: string;
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

export type Generation = {
  id: string;
  userId: string;
  type: "image" | "audio" | "code";
  prompt: string;
  outputUrl?: string;
  outputText?: string;
  meta?: Record<string, unknown>;
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
});

/** Process-local fallback when disk is unavailable */
let memoryDb: DB = emptyDb();
let resolvedPath: string | null | undefined;
let writable = false;

function candidatePaths(): string[] {
  const list: string[] = [];
  if (process.env.BUILDWE_DATA_DIR) {
    list.push(path.join(process.env.BUILDWE_DATA_DIR, "buildwe.json"));
  }
  // Vercel / AWS lambda writable tmp
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
      fs.writeFileSync(file, JSON.stringify(emptyDb(), null, 2), "utf8");
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
  const deadline = Date.now() + 2_000;
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
        dbLockingAvailable = false;
        return null;
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

function write(db: DB) {
  // A local write happened. If bootRemote() is still awaiting its pull, this
  // tells it to abandon the adopt rather than overwrite what we just wrote.
  localWriteSinceBoot = true;
  const file = getPath();
  if (file && writable) {
    const lock = acquireLock(file);
    try {
      // If another process wrote since our read, merge instead of overwrite.
      let current = db;
      try {
        const onDisk = fs.readFileSync(file, "utf8");
        if (lastReadRaw !== null && onDisk !== lastReadRaw) {
          current = mergeOnto(parseDb(onDisk), parseDb(lastReadRaw), db);
        }
      } catch {
        /* unreadable file: fall back to writing what we hold */
      }
      const out = JSON.stringify(current, null, 2);
      // atomic: never leave a half-written store behind
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, out, "utf8");
      fs.renameSync(tmp, file);
      memoryDb = current;
      lastReadRaw = out;
      db = current;
    } catch {
      writable = false;
    } finally {
      if (lock) releaseLock(lock);
    }
  }
  memoryDb = db;
  scheduleRemotePush(db);
}
/* ── Optional Supabase mirror (permanent DB) ─────────────── */

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let latestDb: DB | null = null;
let bootedRemote = false;
/** Set by write(); blocks a late remote adopt from clobbering local data. */
let localWriteSinceBoot = false;

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
  void (async () => {
    const localHadData =
      memoryDb.users.length > 0 || memoryDb.conversations.length > 0;
    if (localHadData) return; // local wins on warm starts
    const remote = await pullRemoteDb();
    if (!remote) return;
    // Re-check AFTER the await — this is the race the guard exists for.
    if (localWriteSinceBoot) return;
    if (memoryDb.users.length > 0 || memoryDb.conversations.length > 0) return;
    memoryDb = {
      users: remote.users || [],
      conversations: remote.conversations || [],
      generations: remote.generations || [],
      usage: remote.usage || [],
      projects: remote.projects || [],
      projectFiles: remote.projectFiles || [],
      shares: remote.shares || [],
      payments: remote.payments || [],
      wallets: remote.wallets || [],
      creditLedger: remote.creditLedger || [],
      apiKeys: remote.apiKeys || [],
      teams: remote.teams || [],
      passwordResets: remote.passwordResets || [],
      consumedTokens: remote.consumedTokens || [],
    };
    const file = getPath();
    if (file && writable) {
      try {
        fs.writeFileSync(file, JSON.stringify(memoryDb, null, 2), "utf8");
      } catch {
        /* */
      }
    }
  })();
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
  // Keep memory bounded PER USER, never globally.
  //
  // This used to be `db.conversations.slice(0, 200)` across the whole table,
  // which meant one busy user (or 200 visitors) silently deleted everyone
  // else's chats — proven in testing: a user's chat vanished after 205 other
  // conversations were created. Trimming per owner keeps the table bounded
  // without ever touching another account's data.
  trimPerUser(db, input.userId);
  write(db);
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
  db.conversations = db.conversations.filter(
    (c) => c.userId !== userId || keep.has(c.id)
  );
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
  // If missing (new instance / lost memory), recreate shell
  if (i < 0) {
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
  write(db);
  return db.conversations[i];
}

export function deleteConversation(id: string, userId: string) {
  const db = read();
  const before = db.conversations.length;
  db.conversations = db.conversations.filter(
    (c) => !(c.id === id && c.userId === userId)
  );
  db.shares = db.shares.filter((s) => s.conversationId !== id);
  write(db);
  return db.conversations.length < before;
}

/* ── Projects ────────────────────────────────────────────── */

export function listProjects(userId: string) {
  return read()
    .projects.filter((p) => p.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createProject(userId: string, name: string) {
  const db = read();
  const p: Project = {
    id: uid("proj"),
    userId,
    name: name.trim().slice(0, 40) || "New project",
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
  p.name = name.trim().slice(0, 40) || p.name;
  write(db);
  return p;
}

export function deleteProject(id: string, userId: string) {
  const db = read();
  const owned = db.projects.some((p) => p.id === id && p.userId === userId);
  db.projects = db.projects.filter((p) => !(p.id === id && p.userId === userId));
  // detach conversations from the deleted project
  for (const c of db.conversations) {
    if (c.projectId === id) c.projectId = null;
  }
  // remove the project's files too — otherwise they'd linger unreachable
  if (owned) {
    db.projectFiles = db.projectFiles.filter(
      (f) => !(f.projectId === id && f.userId === userId)
    );
  }
  write(db);
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

/** Create or update a file by path (upsert), scoped to one owner + project. */
export function saveProjectFile(input: {
  userId: string;
  projectId: string;
  path: string;
  content: string;
  lang?: string;
}): { file: ProjectFile } | { error: string } {
  const path = normalizeFilePath(input.path);
  if (!path) return { error: "Invalid file path." };

  const content = String(input.content ?? "");
  if (content.length > MAX_FILE_CHARS) {
    return { error: "File too large — keep it under 120,000 characters." };
  }

  const db = read();
  const project = db.projects.find(
    (p) => p.id === input.projectId && p.userId === input.userId
  );
  if (!project) return { error: "Project not found." };

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
    return { error: `Project file limit reached (${MAX_FILES_PER_PROJECT}).` };
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
 * Compact project snapshot for the model's context window.
 * Full text for small files, head+tail excerpt for large ones — the agent needs
 * shape and entry points, not every byte.
 */
export function buildProjectContext(
  projectId: string,
  userId: string,
  budgetChars = 12_000
): string {
  const files = listProjectFiles(projectId, userId);
  if (!files.length) return "";

  const lines: string[] = [
    `PROJECT FILES (${files.length}) — this is the user's current project. Modify these files; don't invent new structure unless asked.`,
    "",
    "Structure:",
    ...files.map((f) => `  ${f.path} (${f.lang}, ${f.content.length} chars)`),
    "",
  ];

  let used = lines.join("\n").length;
  for (const f of files) {
    const remaining = budgetChars - used;
    if (remaining < 400) {
      lines.push(`--- ${f.path} — omitted (context budget reached) ---`);
      continue;
    }
    const body =
      f.content.length <= remaining
        ? f.content
        : `${f.content.slice(0, Math.floor(remaining * 0.6))}\n… (truncated) …\n${f.content.slice(-Math.floor(remaining * 0.25))}`;
    const block = `--- ${f.path} ---\n${body}\n`;
    lines.push(block);
    used += block.length;
  }

  return lines.join("\n");
}

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
  // Per-owner cap (was a global slice that evicted other users' share links).
  const mineShares = db.shares.filter((x) => x.userId === userId);
  if (mineShares.length > RETENTION.sharesPerUser) {
    const keep = new Set(
      mineShares.slice(0, RETENTION.sharesPerUser).map((x) => x.id)
    );
    db.shares = db.shares.filter((x) => x.userId !== userId || keep.has(x.id));
  }
  write(db);
  return s;
}

export function getShare(id: string) {
  return read().shares.find((s) => s.id === id) || null;
}

export function bumpShareViews(id: string) {
  const db = read();
  const s = db.shares.find((x) => x.id === id);
  if (!s) return;
  s.views += 1;
  write(db);
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
  return c;
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

  return moved;
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
