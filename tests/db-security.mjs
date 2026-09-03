#!/usr/bin/env node
/**
 * Database / Supabase security hardening.
 *
 * The app never speaks SQL: it talks to PostgREST over HTTPS with the service
 * role key, which bypasses RLS by design. That makes three things load-bearing,
 * and this suite pins all three:
 *
 *   1. Every filter that reaches PostgREST is either server-generated or
 *      allowlisted, because `encodeURIComponent` does NOT escape the
 *      characters PostgREST treats as operators — `(`, `)`, `.`, `*`.
 *   2. Every read and delete carries the owner in the query, since the service
 *      role can see every row and an in-memory filter would be too late.
 *   3. The schema denies anon/authenticated outright, so a leaked anon key is
 *      not a database.
 *
 * Run: npm run test:db-security
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SCHEMA = src("supabase/schema.sql");
const REMOTE = src("lib/db/remote.ts");
const DURABLE = src("lib/rate-limit/durable.ts");
const MEDIA = src("lib/storage/media.ts");
const STORE = src("lib/db/store.ts");

const TABLES = [
  "buildwe_kv",
  "buildwe_conversations",
  "buildwe_owned",
  "buildwe_rate_limits",
];

/* ── RLS ─────────────────────────────────────────────────── */

await run("every table enables RLS and denies anon + authenticated", () => {
  for (const t of TABLES) {
    assert.match(
      SCHEMA,
      new RegExp(`alter table ${t} enable row level security`),
      `${t} must enable RLS`
    );
    const policy = SCHEMA.slice(SCHEMA.indexOf(`on ${t} for all`));
    assert.ok(policy, `${t} needs a deny policy`);
    const head = policy.slice(0, 200);
    assert.match(head, /to anon, authenticated/, `${t} policy must name both roles`);
    assert.match(head, /using \(false\)/, `${t} must deny reads`);
    assert.match(head, /with check \(false\)/, `${t} must deny writes`);
  }
});

await run("the service role key is server-only and never NEXT_PUBLIC", () => {
  assert.equal(
    /NEXT_PUBLIC_SUPABASE_SERVICE|NEXT_PUBLIC_SERVICE_ROLE/.test(SCHEMA + REMOTE + DURABLE + MEDIA),
    false,
    "the service role key must never be exposed to the browser"
  );
  // Only these three server modules may read it.
  const allowed = ["lib/db/remote.ts", "lib/rate-limit/durable.ts", "lib/storage/media.ts"];
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const files = [...walk("lib"), ...walk("app"), ...walk("components")];
  for (const f of files) {
    const body = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (!body.includes("SUPABASE_SERVICE_ROLE_KEY")) continue;
    assert.ok(allowed.includes(f), `${f} must not read the service role key`);
    assert.equal(
      body.slice(0, 200).includes('"use client"'),
      false,
      `${f} reads the service role key and must not be a client component`
    );
  }
});

/* ── Injection ───────────────────────────────────────────── */

await run("encodeURIComponent alone does not neutralise PostgREST operators", () => {
  // This is the premise the rest of the suite rests on. If it ever stops being
  // true the allowlists below are redundant, but they are not today.
  for (const ch of ["(", ")", ".", "*"]) {
    assert.equal(
      encodeURIComponent(ch),
      ch,
      `${ch} survives encodeURIComponent, so interpolating raw input is unsafe`
    );
  }
});

await run("the email filter is allowlisted before it reaches a query", () => {
  const fn = REMOTE.slice(REMOTE.indexOf("export async function pullOwnedUserByEmail"));
  assert.match(fn, /\/\[\^a-z0-9\.@_\+-\]\/\.test\(e\)/, "an allowlist must gate the email");

  const guard = (email) => {
    const e = String(email || "").trim().toLowerCase();
    if (!e || e.length > 120 || /[^a-z0-9.@_+-]/.test(e)) return null;
    return encodeURIComponent(e);
  };
  for (const attack of [
    "a@b.com,or(id.neq.0)",
    "*",
    "a@b.com)&select=*",
    "a@b.com&kind=eq.wallet",
    "a@b.com\u0000",
    "x@b.com,payload->>role.eq.admin",
  ]) {
    assert.equal(guard(attack), null, `${attack} must be refused, not encoded`);
  }
  assert.ok(guard("real.user+tag@example.com"), "a normal address still works");
});

await run("owned ids and kinds are validated before interpolation", () => {
  assert.match(REMOTE, /function ownedIdOk/, "ids go through a length/type check");
  assert.match(REMOTE, /OWNED_KINDS\.includes/, "kind is an allowlist, not free text");
  // asOwnedKind is the only way a kind reaches the URL.
  for (const fn of ["upsertOwnedRecord", "deleteOwnedRecord"]) {
    const body = REMOTE.slice(REMOTE.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 600), /asOwnedKind\(kind\)/, `${fn} must validate kind`);
  }
});

await run("no raw SQL is ever built from application input", () => {
  for (const [name, body] of Object.entries({ REMOTE, DURABLE, MEDIA })) {
    assert.equal(
      /\b(select|insert|update|delete)\s+.*\$\{/i.test(body),
      false,
      `${name} appears to interpolate into SQL`
    );
  }
  // The one RPC call passes arguments as JSON, never as a string.
  const rpc = DURABLE.slice(DURABLE.indexOf("rpc/buildwe_rate_hit"));
  assert.match(rpc, /body: JSON\.stringify\(\{/, "RPC arguments must be a JSON body");
});

/* ── Ownership isolation / IDOR ──────────────────────────── */

await run("every remote read and delete filters by owner in the query", () => {
  const mustScope = {
    deleteRemoteConversation: ["id=eq.", "user_id=eq."],
    deleteRemoteConversationsForUser: ["user_id=eq."],
    deleteOwnedRecord: ["kind=eq.", "id=eq.", "user_id=eq."],
    deleteOwnedForUser: ["user_id=eq."],
    pullOwnedForUser: ["user_id=eq."],
  };
  for (const [fn, needles] of Object.entries(mustScope)) {
    const start = REMOTE.indexOf(`export async function ${fn}`);
    assert.ok(start > -1, `${fn} not found`);
    const body = REMOTE.slice(start, start + 1200);
    for (const n of needles) {
      assert.ok(body.includes(n), `${fn} must constrain ${n} in the query`);
    }
  }
  // The comment is load-bearing: never select * and slice in memory.
  const pull = REMOTE.slice(REMOTE.indexOf("export async function pullRemoteConversations"));
  assert.match(pull.slice(0, 700), /user_id=eq\./, "conversations are pulled per owner");
});

await run("conversation ownership is proven before the remote delete", () => {
  const fn = STORE.slice(STORE.indexOf("export function deleteConversation"));
  const body = fn.slice(0, 500);
  assert.match(body, /c\.userId === userId/, "ownership is checked locally first");
  const ownedIdx = body.indexOf("owned");
  const delIdx = body.indexOf("deleteRemoteConversation");
  assert.ok(ownedIdx > -1 && ownedIdx < delIdx, "the check must precede the delete");
});

await run("store getters for owned records require a userId", () => {
  for (const fn of ["getConversation", "getProject", "getProjectFile"]) {
    const i = STORE.indexOf(`export function ${fn}(`);
    assert.ok(i > -1, `${fn} not found`);
    const sig = STORE.slice(i, STORE.indexOf(")", i));
    assert.match(sig, /userId/, `${fn} must take a userId`);
    const body = STORE.slice(i, i + 400);
    assert.match(body, /userId === userId|\.userId === userId/, `${fn} must filter on it`);
  }
});

/* ── Constraints, indexes, functions ─────────────────────── */

await run("the login email lookup is indexed", () => {
  // Without this, every cold-start login sequentially scans buildwe_owned —
  // and that path is reachable before authentication.
  assert.match(
    SCHEMA,
    /create index if not exists buildwe_owned_email_idx[\s\S]*?payload->>'email'/,
    "an expression index must cover payload->>'email'"
  );
  const q = REMOTE.slice(REMOTE.indexOf("pullOwnedUserByEmail"));
  assert.match(q, /payload->>email=eq\./, "…matching the filter the query actually uses");
});

await run("owner tables carry integrity constraints", () => {
  assert.match(SCHEMA, /buildwe_owned_kind_ck[\s\S]*?check \(kind in \(/, "kind is constrained");
  assert.match(SCHEMA, /buildwe_owned_id_len_ck/, "id/user_id length is constrained");
  assert.match(SCHEMA, /buildwe_conversations_id_len_ck/, "conversation ids are constrained");
  assert.match(
    SCHEMA,
    /buildwe_rate_limits_count_ck check \(count >= 0\)/,
    "a negative counter would mean unlimited quota"
  );
});

await run("the constrained kinds match the kinds the code can write", () => {
  const m = SCHEMA.match(/check \(kind in \(([^)]+)\)\)/);
  assert.ok(m, "the kind constraint must exist");
  const sqlKinds = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
  const c = REMOTE.match(/const OWNED_KINDS: readonly OwnedKind\[\] = \[([^\]]+)\]/);
  assert.ok(c, "OWNED_KINDS must exist");
  const tsKinds = [...c[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(
    sqlKinds,
    tsKinds,
    "a kind the code writes but the constraint rejects is a silent write failure"
  );
});

await run("every SQL function pins its search_path", () => {
  const fns = [...SCHEMA.matchAll(/create or replace function (\w+)/g)].map((m) => m[1]);
  assert.ok(fns.length >= 2, "expected the rate-limit functions");
  for (const fn of fns) {
    const body = SCHEMA.slice(SCHEMA.indexOf(`create or replace function ${fn}`));
    const head = body.slice(0, body.indexOf("as $$"));
    assert.match(
      head,
      /set search_path = public, pg_temp/,
      `${fn} must pin search_path so it cannot resolve a shadowed object`
    );
  }
});

await run("the schema stays idempotent", () => {
  // Operators are told to re-run this file; a bare `create table` or
  // `alter table ... add constraint` would fail the second time.
  const creates = [...SCHEMA.matchAll(/^create table (?!if not exists)/gim)];
  assert.deepEqual(creates.map((c) => c[0]), [], "tables must be `if not exists`");
  const idx = [...SCHEMA.matchAll(/^create index (?!if not exists)/gim)];
  assert.deepEqual(idx.map((c) => c[0]), [], "indexes must be `if not exists`");
  for (const m of SCHEMA.matchAll(/add constraint (\w+)/g)) {
    const before = SCHEMA.slice(0, SCHEMA.indexOf(`add constraint ${m[1]}`));
    assert.match(
      before.slice(-400),
      /where conname = '/,
      `${m[1]} must be guarded by an existence check`
    );
  }
});

/* ── Credits integrity ───────────────────────────────────── */

await run("the credit ledger is as durable as the wallet it rebuilds", () => {
  // getWallet reconciles the balance from the ledger, so the ledger must not
  // have weaker persistence than the cache derived from it.
  assert.match(REMOTE, /"credit"/, "credit must be an owned kind");
  const diff = STORE.slice(STORE.indexOf("function ownedDiff"));
  assert.match(diff.slice(0, 2000), /push\("credit"/, "new ledger rows must be pushed per-row");
  assert.match(diff.slice(0, 2000), /push\("wallet"/, "wallets keep their per-row sync");
});

await run("hydrated ledger rows can never double-count", () => {
  const apply = STORE.slice(STORE.indexOf('if (kind === "credit")'));
  const body = apply.slice(0, 500);
  assert.match(body, /some\(\(c\) => c\.id === id\)/, "an existing id must be skipped");
  assert.match(body, /return false/, "…without mutating the ledger");
});

await run("merged snapshots key credits and wallets stably", () => {
  const rid = REMOTE.slice(REMOTE.indexOf("function recordId"));
  assert.match(rid.slice(0, 400), /wallets.*rec\.userId/s, "wallets key on userId");
  // Ledger rows fall through to `rec.id`, which is assigned once at creation.
  assert.match(STORE, /id: uid\("crl"\)/, "ledger ids are generated, not derived");
});

/* ── Leakage ─────────────────────────────────────────────── */

await run("database errors never reach the client", () => {
  const pub = src("lib/http/public-error.ts");
  for (const term of ["postgres", "supabase", "sqlstate", "service_role"]) {
    assert.ok(pub.includes(term), `the redactor must cover ${term}`);
  }
  // remote.ts swallows upstream bodies rather than surfacing them.
  assert.equal(
    /return .*await res\.text\(\)/.test(REMOTE),
    false,
    "upstream response text must not be returned to callers"
  );
});

await run("the media mirror goes through the SSRF guard", () => {
  assert.match(MEDIA, /assertSafeUrl/, "the one outbound fetch must be guarded too");
  const fn = MEDIA.slice(MEDIA.indexOf("export async function mirrorRemoteImage"));
  const guardAt = fn.indexOf("assertSafeUrl");
  const fetchAt = fn.indexOf("await fetch(");
  assert.ok(guardAt > -1 && guardAt < fetchAt, "the guard must run before the fetch");
});

await run("uploaded object paths cannot escape the bucket", () => {
  const fn = MEDIA.slice(MEDIA.indexOf("export async function putMedia"));
  assert.match(fn, /replace\(\/\\\.\\\.\/g, ""\)/, "traversal segments are stripped");
  assert.match(fn, /\[\^a-zA-Z0-9\/_\.-\]/, "the key is reduced to a safe alphabet");
  const sanitize = (p) =>
    p.replace(/\.\./g, "").replace(/^\/+/, "").replace(/[^a-zA-Z0-9/_.-]/g, "_").slice(0, 200);
  for (const attack of ["../../etc/passwd", "/absolute", "a/../../b"]) {
    const out = sanitize(attack);
    assert.equal(out.includes(".."), false, `${attack} escaped`);
    assert.equal(out.startsWith("/"), false, `${attack} stayed absolute`);
  }
});

process.exit(report("database & Supabase hardening") ? 1 : 0);
