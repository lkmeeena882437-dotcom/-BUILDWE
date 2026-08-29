/**
 * BUILDWE store — works on Vercel serverless + local dev.
 *
 * Vercel: filesystem under project root is read-only.
 * We write to /tmp when possible, else pure in-memory (per-instance).
 * For permanent multi-instance auth later: swap to Supabase/Turso.
 */
import fs from "fs";
import path from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { pullRemoteDb, pushRemoteDb, remoteDbEnabled } from "./remote";

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
  createdAt: string;
  updatedAt: string;
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
  paymentId?: string;
  amount: number;
  currency: string;
  status: "created" | "paid" | "failed";
  demo: boolean;
  createdAt: string;
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
  shares: Share[];
  payments: Payment[];
  apiKeys: ApiKey[];
  teams: Team[];
};

const emptyDb = (): DB => ({
  users: [],
  conversations: [],
  generations: [],
  usage: [],
  projects: [],
  shares: [],
  payments: [],
  apiKeys: [],
  teams: [],
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
      shares: parsed.shares || [],
      payments: parsed.payments || [],
      apiKeys: parsed.apiKeys || [],
      teams: parsed.teams || [],
    };
    return memoryDb;
  } catch {
    return memoryDb;
  }
}

function write(db: DB) {
  memoryDb = db;
  const file = getPath();
  if (file && writable) {
    try {
      // atomic: never leave a half-written store behind
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
      fs.renameSync(tmp, file);
    } catch {
      writable = false;
    }
  }
  scheduleRemotePush(db);
}

/* ── Optional Supabase mirror (permanent DB) ─────────────── */

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let latestDb: DB | null = null;
let bootedRemote = false;

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

/** One-time boot: adopt the remote snapshot when local storage is fresh. */
function bootRemote() {
  if (bootedRemote || !remoteDbEnabled()) return;
  bootedRemote = true;
  void (async () => {
    const localHadData =
      memoryDb.users.length > 0 || memoryDb.conversations.length > 0;
    if (localHadData) return; // local wins on warm starts
    const remote = await pullRemoteDb();
    if (!remote) return;
    memoryDb = {
      users: remote.users || [],
      conversations: remote.conversations || [],
      generations: remote.generations || [],
      usage: remote.usage || [],
      projects: remote.projects || [],
      shares: remote.shares || [],
      payments: remote.payments || [],
      apiKeys: remote.apiKeys || [],
      teams: remote.teams || [],
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

export function storageMode(): "disk" | "memory" {
  getPath();
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
  write(db);
  return user;
}

export function updateUser(
  id: string,
  patch: Partial<Pick<User, "name" | "plan" | "skills" | "byok">>
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
  // keep memory bounded on serverless
  if (db.conversations.length > 200) {
    db.conversations = db.conversations.slice(0, 200);
  }
  write(db);
  return c;
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
  db.projects = db.projects.filter((p) => !(p.id === id && p.userId === userId));
  // detach conversations from the deleted project
  for (const c of db.conversations) {
    if (c.projectId === id) c.projectId = null;
  }
  write(db);
  return true;
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
  db.shares = db.shares.slice(0, 200);
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
  db.payments = db.payments.slice(0, 300);
  write(db);
  return row;
}

export function findPaymentByOrder(orderId: string) {
  return read().payments.find((p) => p.orderId === orderId) || null;
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
  db.apiKeys = db.apiKeys.filter((k) => !(k.id === id && k.userId === userId));
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
  db.generations = db.generations.slice(0, 300);
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
