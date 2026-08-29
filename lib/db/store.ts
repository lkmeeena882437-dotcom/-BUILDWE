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

export type Plan = "free" | "pro";

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: Plan;
  skills: string[];
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
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

type DB = {
  users: User[];
  conversations: Conversation[];
  generations: Generation[];
  usage: UsageRow[];
};

const emptyDb = (): DB => ({
  users: [],
  conversations: [],
  generations: [],
  usage: [],
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
  if (!file) return memoryDb;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as DB;
    memoryDb = {
      users: parsed.users || [],
      conversations: parsed.conversations || [],
      generations: parsed.generations || [],
      usage: parsed.usage || [],
    };
    return memoryDb;
  } catch {
    return memoryDb;
  }
}

function write(db: DB) {
  memoryDb = db;
  const file = getPath();
  if (!file || !writable) return;
  try {
    fs.writeFileSync(file, JSON.stringify(db, null, 2), "utf8");
  } catch {
    writable = false;
  }
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
  patch: Partial<Pick<User, "name" | "plan" | "skills">>
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
}) {
  const db = read();
  const now = new Date().toISOString();
  const c: Conversation = {
    id: uid("conv"),
    userId: input.userId,
    mode: input.mode,
    title: input.title.slice(0, 80) || "New chat",
    messages: input.messages || [],
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
  write(db);
  return db.conversations.length < before;
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
