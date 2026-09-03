#!/usr/bin/env node
/**
 * Conversations persist in Supabase as rows keyed by user id.
 *
 * The whole-DB `buildwe_kv` snapshot is last-write-wins: one cold instance
 * pushing an empty blob used to erase everyone else's chats. This suite
 * proves the replacement path — one row per chat, filtered by `user_id` —
 * without needing a live Postgres.
 *
 * Run: npm run test:conversations
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

await run("the schema has a conversations table keyed by user_id", () => {
  const sql = readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8");
  assert.ok(sql.includes("create table if not exists buildwe_conversations"), "table is in the one-shot SQL");
  assert.ok(sql.includes("user_id     text not null") || /user_id\s+text not null/.test(sql), "owner is a column, not buried in jsonb");
  assert.ok(sql.includes("buildwe_conversations_user_idx"), "listing a person's history is an index, not a seq scan");
  assert.ok(sql.includes("enable row level security"), "RLS is on — service_role bypasses, nothing else should");
  assert.ok(sql.includes("create table if not exists buildwe_owned"), "accounts/projects/billing are per-row, not only the kv blob");
  assert.ok(sql.includes("buildwe_owned_user_idx"), "listing one owner's rows is indexed");
  assert.ok(sql.includes("primary key (kind, id)"), "owned rows are unique per kind+id");
});

await run("production does not treat the JSON file as the database", () => {
  const store = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");
  const remoteSrc = readFileSync(path.join(ROOT, "lib", "db", "remote.ts"), "utf8");
  const login = readFileSync(path.join(ROOT, "app", "api", "auth", "login", "route.ts"), "utf8");
  assert.ok(store.includes("export function jsonStoreAllowed"), "JSON is a named fallback, not an implicit primary");
  assert.ok(store.includes('process.env.VERCEL === "1"'), "Vercel must not persist to ephemeral /tmp");
  assert.ok(store.includes("hydrateAccountByEmail"), "cold login hydrates the account row, not only the blob");
  assert.ok(login.includes("hydrateAccountByEmail"), "email login waits for that hydrate");
  assert.ok(remoteSrc.includes("upsertOwnedRecord"), "users/projects/payments/wallets upsert as owned rows");
  assert.ok(remoteSrc.includes("mergeDbSnapshots"), "a kv push merges so a cold snapshot cannot wipe others");
  assert.ok(store.includes("scheduleOwnedSync"), "a local write mirrors owned rows, not only the blob");
});

await run("history GET hydrates this user before listing", () => {
  const hist = readFileSync(path.join(ROOT, "app", "api", "history", "route.ts"), "utf8");
  assert.ok(hist.includes("hydrateConversationsForUser(session.userId)"), "a cold instance must pull before it answers");
  const store = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");
  assert.ok(store.includes("upsertRemoteConversation(c)"), "a new chat is a row, not only a blob patch");
  assert.ok(store.includes("write(fresh, { mirror: false, touchBoot: false })"), "hydrate must not push a partial blob");
  assert.ok(store.includes("adoptGuestConversations"), "guest chats follow the account into Postgres too");
});

await run("opening a chat is conversationId → GET /api/history → messages", () => {
  const hist = readFileSync(path.join(ROOT, "app", "api", "history", "route.ts"), "utf8");
  const client = readFileSync(path.join(ROOT, "lib", "client", "api.ts"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const chat = readFileSync(path.join(ROOT, "app", "api", "ai", "chat", "route.ts"), "utf8");
  const store = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");
  assert.ok(hist.includes('searchParams.get("id")'), "GET /api/history?id= is the open path");
  assert.ok(hist.includes("getVisibleConversation(id, session.userId)"), "and it looks the id up, owner-scoped");
  const at = client.indexOf("export async function loadConversation");
  const fn = client.slice(at, client.indexOf("\n}", at) + 2);
  assert.ok(fn.includes("/api/history?id="), "the client opens via GET, not by scanning the sidebar list");
  assert.equal(fn.includes('action: "get"'), false, "loadConversation must not POST a get any more");
  assert.ok(page.includes("abandonStream()"), "switching chats aborts the in-flight stream");
  assert.ok(page.includes("streamEpochRef"), "late tokens cannot rewrite another thread");
  assert.ok(page.includes("openEpochRef"), "a slower open cannot overwrite a later click");
  const newChat = page.slice(page.indexOf("const newChat = () => {"), page.indexOf("const openHist"));
  assert.equal(newChat.includes("deleteHistory"), false, "New chat must not delete stored threads");
  assert.ok(newChat.includes("setConvId(null)"), "it only clears the local composer");
  assert.ok(store.includes("export async function ensureConversationAccess"), "a cold instance hydrates before treating an id as missing");
  assert.ok(chat.includes("ensureConversationAccess"), "chat persist will not mint an empty shell over a real thread");
});

await run("history GET is a capped summary, not the whole store", () => {
  const hist = readFileSync(path.join(ROOT, "app", "api", "history", "route.ts"), "utf8");
  const store = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");
  const client = readFileSync(path.join(ROOT, "lib", "client", "api.ts"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  assert.ok(store.includes("HISTORY_LIST_CAP"), "the rail has a named cap, not an unbounded map");
  assert.ok(hist.includes("listVisibleConversationSummaries"), "GET lists summaries, not full message arrays");
  assert.equal(hist.includes("listGenerations"), false, "images do not ride along on every workspace mount");
  assert.ok(hist.includes("getVisibleConversation"), "opening a chat looks the id up, it does not scan the sidebar list");
  assert.ok(hist.includes("let c = getVisibleConversation"), "a warm instance skips the 200-row remote pull");
  assert.ok(store.includes("JSON.stringify(current)"), "the JSON file is compact, not pretty-printed on every mutation");
  assert.equal(store.includes("JSON.stringify(current, null, 2)"), false, "pretty-print must not come back");
  assert.ok(store.includes("writeConversations(db)"), "chat writes skip the blob once the conversations table is live");
  assert.ok(store.includes("mirror: !conversationsTableReady()"), "a 404 schema still pushes the blob so chats are not lost");
  const at = client.indexOf("export async function fetchHistory");
  const fn = client.slice(at, client.indexOf("\n}", at) + 2);
  assert.equal(fn.includes("generations:"), false, "the client no longer types a generations array this route does not send");
  assert.ok(page.includes("setHistory("), "the workspace still fills the rail from conversations");
  assert.ok(page.includes("fetchGenerations("), "studios still load creations from their own route");
});

await run("login/register/oauth wait for the reassignment", () => {
  for (const rel of [
    "app/api/auth/login/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/auth/oauth/[provider]/callback/route.ts",
  ]) {
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(src.includes("await adoptGuestConversations"), `${rel} must not return before guest chats are retargeted`);
  }
});

const outDir = mkdtempSync(path.join(tmpdir(), "bw-conv-"));
try {
  try {
    execFileSync(
      "npx",
      [
        "tsc",
        path.join(ROOT, "lib", "db", "remote.ts"),
        "--outDir",
        outDir,
        "--target",
        "es2022",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--strict",
        "--skipLibCheck",
        "--esModuleInterop",
      ],
      { cwd: ROOT, stdio: "pipe" }
    );
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    throw new Error(`could not compile lib/db/remote.ts\n${out}`);
  }
  const emitted = path.join(outDir, "remote.js");
  assert.ok(existsSync(emitted), "tsc produced remote.js");
  const remote = await import(pathToFileURL(emitted).href);

  await run("asConversation refuses junk, keeps a real chat", () => {
    assert.equal(remote.asConversation(null), null);
    assert.equal(remote.asConversation({ id: "x" }), null);
    const c = {
      id: "conv_1",
      userId: "usr_a",
      mode: "chat",
      title: "Hello",
      messages: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    assert.equal(remote.asConversation(c).id, "conv_1");
  });

  await run("an empty newer shell does not hide a thread that already has messages", () => {
    const local = [
      {
        id: "a",
        userId: "u1",
        title: "stub",
        updatedAt: "2026-09-02T04:00:00.000Z",
        mode: "chat",
        messages: [],
        createdAt: "t",
      },
    ];
    const incoming = [
      {
        id: "a",
        userId: "u1",
        title: "full",
        updatedAt: "2026-09-01T01:00:00.000Z",
        mode: "chat",
        messages: [
          { id: "m1", role: "user", content: "hello", createdAt: "t" },
          { id: "m2", role: "assistant", content: "hi", createdAt: "t" },
        ],
        createdAt: "t",
      },
    ];
    const { next } = remote.mergeConversationLists(local, incoming);
    assert.equal(next[0].title, "full");
    assert.equal(next[0].messages.length, 2);
  });

  await run("merge keeps the newer row and does not drop local-only chats", () => {
    const local = [
      { id: "a", userId: "u1", title: "local-newer", updatedAt: "2026-09-01T02:00:00.000Z", mode: "chat", messages: [], createdAt: "t" },
      { id: "b", userId: "u1", title: "only-local", updatedAt: "2026-09-01T01:00:00.000Z", mode: "chat", messages: [], createdAt: "t" },
    ];
    const incoming = [
      { id: "a", userId: "u1", title: "remote-older", updatedAt: "2026-09-01T01:00:00.000Z", mode: "chat", messages: [], createdAt: "t" },
      { id: "c", userId: "u1", title: "only-remote", updatedAt: "2026-09-01T03:00:00.000Z", mode: "chat", messages: [], createdAt: "t" },
    ];
    const { next, changed } = remote.mergeConversationLists(local, incoming);
    assert.equal(changed, true);
    const byId = Object.fromEntries(next.map((c) => [c.id, c]));
    assert.equal(byId.a.title, "local-newer");
    assert.ok(byId.b, "unpushed local chat survives a hydrate");
    assert.equal(byId.c.title, "only-remote");
  });

  await run("upsert/pull/delete are scoped to this user_id", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", body: init.body, headers: init.headers });
      const u = String(url);
      if (u.includes("user_id=eq.usr_a") && (init.method || "GET") === "GET") {
        return new Response(
          JSON.stringify([
            {
              payload: {
                id: "conv_1",
                userId: "usr_a",
                mode: "chat",
                title: "Saved",
                messages: [],
                createdAt: "2026-09-01T00:00:00.000Z",
                updatedAt: "2026-09-01T00:00:01.000Z",
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    };
    try {
      assert.equal(remote.remoteDbEnabled(), true);

      const chat = {
        id: "conv_1",
        userId: "usr_a",
        mode: "chat",
        title: "Saved",
        messages: [{ id: "m1", role: "user", content: "hi", createdAt: "t" }],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
      assert.equal(await remote.upsertRemoteConversation(chat), true);
      const upsert = calls.find((c) => c.method === "POST" && c.url.includes("buildwe_conversations"));
      assert.ok(upsert, "upsert hits the conversations table, not kv");
      const body = JSON.parse(upsert.body);
      assert.equal(body.user_id, "usr_a");
      assert.equal(body.id, "conv_1");
      assert.equal(body.payload.userId, "usr_a");
      assert.equal(upsert.url.includes("buildwe_kv"), false);

      calls.length = 0;
      const pulled = await remote.pullRemoteConversations("usr_a");
      assert.equal(pulled.length, 1);
      assert.equal(pulled[0].title, "Saved");
      assert.ok(calls[0].url.includes("user_id=eq.usr_a"), `pull must filter by owner, got ${calls[0].url}`);
      assert.equal(calls[0].url.includes("buildwe_kv"), false);

      calls.length = 0;
      await remote.deleteRemoteConversation("conv_1", "usr_a");
      const del = calls[0];
      assert.equal(del.method, "DELETE");
      assert.ok(del.url.includes("id=eq.conv_1") && del.url.includes("user_id=eq.usr_a"), "delete is id + owner, never id alone");

      calls.length = 0;
      await remote.pullRemoteConversations("usr_a", ["team_x"]);
      assert.ok(
        calls.some((c) => c.url.includes("team_id=in.(team_x)")),
        "team chats are a second filtered query, not select *"
      );
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  await run("without Supabase env the helpers are a no-op, not an exception", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(remote.remoteDbEnabled(), false);
    assert.equal(await remote.upsertRemoteConversation({ id: "x", userId: "y" }), false);
    assert.deepEqual(await remote.pullRemoteConversations("usr_a"), []);
    assert.equal(await remote.upsertOwnedRecord("user", "usr_a", "usr_a", { id: "usr_a" }), false);
    assert.deepEqual(await remote.pullOwnedForUser("usr_a"), []);
  });

  await run("an empty kv snapshot does not erase another user's account or PRO status", () => {
    const left = {
      users: [
        { id: "usr_a", email: "a@x.test", plan: "pro", planSeats: 3, updatedAt: "2026-09-01T00:00:00.000Z" },
        { id: "usr_b", email: "b@x.test", plan: "free", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
      payments: [{ id: "pay_1", userId: "usr_a", status: "paid", updatedAt: "2026-09-01T00:00:00.000Z" }],
      wallets: [{ userId: "usr_a", balance: 40, updatedAt: "2026-09-01T00:00:00.000Z" }],
      conversations: [],
    };
    const right = {
      users: [{ id: "usr_c", email: "c@x.test", plan: "free", updatedAt: "2026-09-02T00:00:00.000Z" }],
      payments: [],
      wallets: [],
      conversations: [],
    };
    const merged = remote.mergeDbSnapshots(left, right);
    const byId = Object.fromEntries(merged.users.map((u) => [u.id, u]));
    assert.equal(byId.usr_a.plan, "pro");
    assert.equal(byId.usr_a.planSeats, 3);
    assert.ok(byId.usr_b, "user B survives a push that never saw them");
    assert.ok(byId.usr_c, "the new local user is kept");
    assert.equal(merged.payments.length, 1);
    assert.equal(merged.wallets[0].balance, 40);
  });

  await run("a later cancel is not overwritten by an older PRO snapshot", () => {
    const olderPro = {
      users: [{ id: "usr_a", email: "a@x.test", plan: "pro", planSeats: 3, updatedAt: "2026-09-01T00:00:00.000Z" }],
    };
    const newerFree = {
      users: [{ id: "usr_a", email: "a@x.test", plan: "free", updatedAt: "2026-09-02T00:00:00.000Z" }],
    };
    const merged = remote.mergeDbSnapshots(olderPro, newerFree);
    assert.equal(merged.users[0].plan, "free");
    const stillPro = remote.mergeDbSnapshots(newerFree, olderPro);
    assert.equal(stillPro.users[0].plan, "free");
  });

  await run("owned upserts are scoped to this user_id", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", body: init.body });
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    };
    try {
      assert.equal(
        await remote.upsertOwnedRecord("user", "usr_a", "usr_a", {
          id: "usr_a",
          email: "a@x.test",
          plan: "pro",
        }),
        true
      );
      const post = calls.find((c) => c.method === "POST" && c.url.includes("buildwe_owned"));
      assert.ok(post, "accounts land in buildwe_owned, not only kv");
      const body = JSON.parse(post.body);
      assert.equal(body.kind, "user");
      assert.equal(body.user_id, "usr_a");
      assert.equal(body.id, "usr_a");
      assert.equal(body.payload.plan, "pro");
      assert.equal(post.url.includes("buildwe_kv"), false);

      calls.length = 0;
      await remote.pullOwnedForUser("usr_a");
      assert.ok(calls[0].url.includes("user_id=eq.usr_a"), `pull is owner-scoped, got ${calls[0].url}`);
      assert.equal(calls[0].url.includes("buildwe_kv"), false);

      calls.length = 0;
      await remote.deleteOwnedRecord("project", "proj_1", "usr_a");
      assert.equal(calls[0].method, "DELETE");
      assert.ok(
        calls[0].url.includes("id=eq.proj_1") && calls[0].url.includes("user_id=eq.usr_a"),
        "delete is kind+id+owner"
      );
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

process.exit(report("conversations persist by user id") ? 1 : 0);
