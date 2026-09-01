#!/usr/bin/env node
/**
 * Cross-process write tests (audit C4), with two real servers on one store.
 *
 * What used to happen: every mutation was a whole-file
 * read → modify → write on `buildwe.json`. Inside one process that is safe,
 * but two server processes each read the file, each add their own record, and
 * the second write silently erases the first. The audit reproduced it with
 * three processes and lost accounts and history.
 *
 * Two `next dev` instances pointed at the SAME data directory reproduce that
 * exactly, which is what this does. It then asserts that BOTH writers' records
 * survive, that no write is half-visible, and that the lock file is gone after
 * the burst (a leaked lock would degrade every later request).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { req, run, startServer, results, report } from "./harness.mjs";

const PORT_A = Number(process.env.BW_TEST_PORT_A || 3321);
const PORT_B = Number(process.env.BW_TEST_PORT_B || 3322);
const dataDir = mkdtempSync(path.join(tmpdir(), "bw-shared-store-"));
const N = 12;

let a, b;

function stamp() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

try {
  // Both servers see the same JSON file. Their in-memory caches are separate,
  // which is precisely the condition that used to destroy data.
  [a, b] = await Promise.all([
    startServer({
      port: PORT_A,
      label: "bw-store-a",
      dataDir,
      // This file is about lost writes, not about quotas — so quotas are
      // lifted here rather than left to interfere with the assertion.
      env: { SIGNUPS_PER_IP_PER_HOUR: "500", SIGNUPS_PER_EMAIL_PER_DAY: "50" },
    }),
    startServer({
      port: PORT_B,
      label: "bw-store-b",
      dataDir,
      env: { SIGNUPS_PER_IP_PER_HOUR: "500", SIGNUPS_PER_EMAIL_PER_DAY: "50" },
    }),
  ]);

  const emails = Array.from({ length: N }, (_, i) => `burst${i}-${stamp()}@example.test`);

  await run(`${N} concurrent signups across 2 processes all persist`, async () => {
    const results = await Promise.all(
      emails.map((email, i) =>
        req(i % 2 ? a.base : b.base, "/api/auth/register", {
          method: "POST",
          body: { email, password: "correct-horse-9", name: `burst ${i}` },
        })
      )
    );
    const codes = results.map((r) => r.status);
    assert.ok(
      codes.every((c) => c === 200),
      `some signups failed: ${codes.join(",")} (per-IP cap on shared 'anon' bucket may need raising for this test)`
    );

    // Give the debounced remote push and any in-flight write a moment to settle.
    await new Promise((r) => setTimeout(r, 1_200));
    const db = JSON.parse(readFileSync(path.join(dataDir, "buildwe.json"), "utf8"));
    const stored = new Set(db.users.map((u) => u.email));
    const missing = emails.filter((e) => !stored.has(e));
    assert.deepEqual(
      missing,
      [],
      `${missing.length} of ${N} accounts were lost to a concurrent write`
    );
  });

  await run("each process can read every record the other wrote", async () => {
    for (const email of emails.slice(0, 4)) {
      for (const server of [a, b]) {
        const r = await req(server.base, "/api/auth/login", {
          method: "POST",
          body: { email, password: "correct-horse-9" },
        });
        assert.equal(
          r.status,
          200,
          `${email} could not log in through ${server.base} (${r.status})`
        );
      }
    }
  });

  await run("concurrent history writes into one conversation do not drop messages", async () => {
    const jar = (await req(a.base, "/api/auth/login", {
      method: "POST",
      body: { email: emails[0], password: "correct-horse-9" },
    })) && (await (async () => {
      // Reuse a jar that owns the account so both servers append into one conv.
      const { newJar } = await import("./harness.mjs");
      const j = newJar();
      await req(a.base, "/api/auth/login", {
        method: "POST",
        jar: j,
        body: { email: emails[0], password: "correct-horse-9" },
      });
      return j;
    })());

    const created = await req(a.base, "/api/history", {
      method: "POST",
      jar,
      body: { action: "create", mode: "chat", title: "concurrent", messages: [] },
    });
    assert.equal(created.status, 200, `conversation create failed: ${created.status}`);
    const convId = created.json.conversation.id;

    const appends = Array.from({ length: 10 }, (_, i) =>
      req(i % 2 ? a.base : b.base, "/api/history", {
        method: "POST",
        jar,
        body: {
          action: "append",
          conversationId: convId,
          messages: [{ role: "user", content: `message ${i}` }],
        },
      })
    );
    const rs = await Promise.all(appends);
    assert.ok(
      rs.every((r) => r.status === 200),
      `some appends failed: ${rs.map((r) => r.status).join(",")}`
    );

    await new Promise((r) => setTimeout(r, 800));
    const db = JSON.parse(readFileSync(path.join(dataDir, "buildwe.json"), "utf8"));
    const conv = db.conversations.find((c) => c.id === convId);
    assert.ok(conv, "the conversation vanished entirely");
    const bodies = conv.messages.map((m) => m.content);
    const lost = Array.from({ length: 10 }, (_, i) => `message ${i}`).filter(
      (m) => !bodies.includes(m)
    );
    assert.deepEqual(
      lost,
      [],
      `${lost.length}/10 appended messages were lost to a concurrent write`
    );
  });

  await run("no lock file is left behind after the burst", async () => {
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(
      !existsSync(path.join(dataDir, "buildwe.json.lock")),
      "buildwe.json.lock leaked — later writes would queue or stall"
    );
    const health = await req(a.base, "/api/health");
    assert.ok(health.json.durability.writeLocking, "health must report the locking mode");
    assert.equal(
      health.json.services.writeLocking.state,
      "live",
      `locking should be available on a writable dir: ${health.json.services.writeLocking.detail}`
    );
  });

  await run("store file is always valid JSON (no half-written snapshot)", async () => {
    // Read while the other process hammers it: the old tmp+rename made this
    // safe; a merge regression would show up here as a parse error.
    const writes = Array.from({ length: 6 }, (_, i) =>
      req(b.base, "/api/history", {
        method: "POST",
        body: { action: "create", mode: "chat", title: `noise ${i}`, messages: [] },
      })
    );
    const reads = Array.from({ length: 20 }, () => {
      try {
        return JSON.parse(readFileSync(path.join(dataDir, "buildwe.json"), "utf8")).users.length;
      } catch (e) {
        throw new Error(`store unreadable mid-write: ${e.message}`);
      }
    });
    reads.forEach((n) => assert.ok(n >= N, `user count went backwards: ${n}`));
    await Promise.all(writes);
  });
  await run("a writer that cannot take the lock fails instead of overwriting", async () => {
    // The lock is held here on purpose, and its mtime is refreshed, because that is the difference
    // between the two cases the store must tell apart: a *crashed* holder (stale mtime, take it
    // over) and a *working* one (wait, and when waiting runs out, refuse). The store used to answer
    // both the same way — carry on and write unlocked — which is how a signup disappeared in a
    // 12-account burst on a loaded machine: the merge path only protects writes that were
    // serialised, so an unlocked write merges onto a base nobody can vouch for.
    const store = path.join(dataDir, "buildwe.json");
    const lock = `${store}.lock`;
    const before = readFileSync(store, "utf8");
    const email = `busy-${stamp()}@example.test`;
    const body = { email, password: "correct-horse-9", name: "contended" };

    writeFileSync(lock, String(process.pid), "utf8");
    const beat = setInterval(() => {
      const now = new Date();
      try {
        utimesSync(lock, now, now);
      } catch {
        /* released between the tick and the call */
      }
    }, 1_000);
    let refused;
    const at = Date.now();
    try {
      refused = await req(a.base, "/api/auth/register", { method: "POST", body });
    } finally {
      clearInterval(beat);
      rmSync(lock, { force: true });
    }
    const waited = Date.now() - at;
    assert.ok(waited > 2_000, `it answered in ${waited} ms — a live holder should be waited out, not waved off`);
    assert.equal(
      refused.status,
      503,
      `a busy store answered ${refused.status} — 400 would tell the person their typing is wrong`
    );
    assert.match(String(refused.json?.error || ""), /try again/i, "and it says to come back");
    assert.equal(readFileSync(store, "utf8"), before, "the store is byte-for-byte untouched: refusing is the safe answer");
    assert.ok(
      !JSON.parse(before).users.some((u) => u.email === email),
      "and the account really was not created — no half-written state to discover later"
    );

    // The same request once the lock is gone. This is the part a unit test of the throw would miss:
    // the refused write must not leave the email reserved in this process's memory, because then the
    // retry would answer "already registered" about an account that exists nowhere.
    const retry = await req(a.base, "/api/auth/register", { method: "POST", body });
    assert.equal(retry.status, 200, `the retry got ${retry.status} — something was left behind`);
    const db = JSON.parse(readFileSync(store, "utf8"));
    assert.equal(
      db.users.filter((u) => u.email === email).length,
      1,
      "the account is on disk exactly once"
    );
    assert.ok(!existsSync(lock), "and the lock we held is gone");

    const health = await req(a.base, "/api/health");
    assert.equal(
      health.json.services.writeLocking.state,
      "live",
      "one contended write must not report locking as degraded for the rest of the process"
    );
  });

} catch (e) {
  results.push(`  FAIL  harness: ${e.message}`);
} finally {
  a?.stop();
  b?.stop();
  // The harness skips cleanup for shared dirs, so it happens here.
  rmSync(dataDir, { recursive: true, force: true });
}

process.exit(report('Cross-process durability checks (two servers, one store)') ? 1 : 0);
