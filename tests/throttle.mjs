#!/usr/bin/env node
/**
 * Rate-limit identity tests (audit C3), against disposable servers.
 *
 * What used to happen: signup was limited by `rateLimit(`reg:${clientIp(req)}`,
 * 10, 60_000)` and `clientIp` returned the FIRST value of `x-forwarded-for` —
 * a header the caller writes. The audit measured 26/26 signups succeeding with
 * only 1 in 30 ever blocked, i.e. there was no flood brake at all on the one
 * endpoint that costs money per account.
 *
 * These checks pin the new contract:
 *  • no trusted proxy declared → an IP cannot be trusted, so anonymous callers
 *    share one bucket and rotating `x-forwarded-for` buys nothing;
 *  • `TRUST_PROXY_HOPS=1` (Vercel/Cloudflare) → the header IS our proxy's
 *    answer, so per-IP limits work as normal;
 *  • anything with a credential (email) is bucketed on the credential, so an
 *    IP rotation can never unlock a fresh allowance.
 */

import assert from "node:assert/strict";
import { req, run, startServer, newJar, results, report } from "./harness.mjs";

const PORT_UNTRUSTED = Number(process.env.BW_TEST_PORT_A || 3311);
const PORT_TRUSTED = Number(process.env.BW_TEST_PORT_B || 3312);

let servers = [];

function stamp() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

try {
  servers = await Promise.all([
    startServer({
      port: PORT_UNTRUSTED,
      label: "bw-untrusted",
      env: {
        // No proxy in front of us: the only defensible reading.
        TRUST_PROXY_HOPS: "0",
        SIGNUPS_PER_IP_PER_HOUR: "3",
      },
    }),
    startServer({
      port: PORT_TRUSTED,
      label: "bw-trusted",
      env: {
        // Pretend Vercel is terminating the connection and setting the header.
        TRUST_PROXY_HOPS: "1",
        SIGNUPS_PER_IP_PER_HOUR: "3",
      },
    }),
  ]);
  const [untrusted, trusted] = servers;

  await run("with no trusted proxy, rotating x-forwarded-for cannot buy quota", async () => {
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const r = await req(untrusted.base, "/api/auth/register", {
        method: "POST",
        body: { email: `u${stamp()}@example.test`, password: "correct-horse-9" },
        headers: { "x-forwarded-for": `203.0.113.${i}` },
      });
      codes.push(r.status);
    }
    const blocked = codes.filter((c) => c === 429).length;
    assert.ok(
      blocked >= 5,
      `expected the shared bucket to block 5 of 8, blocked ${blocked} → ${codes.join(",")}`
    );
  });

  await run("with a trusted proxy, per-IP limits still work per IP", async () => {
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const r = await req(trusted.base, "/api/auth/register", {
        method: "POST",
        body: { email: `t${stamp()}${i}@example.test`, password: "correct-horse-9" },
        headers: { "x-forwarded-for": `203.0.113.${i}` },
      });
      codes.push(r.status);
    }
    // Three different real clients, three different buckets → all allowed.
    assert.deepEqual(codes, [200, 200, 200], `trusted-proxy signups: ${codes.join(",")}`);

    // A fourth client is still a fourth bucket — but the 4th from the SAME ip
    // as an existing one must be refused. Use ip .0 again (already used once).
    const again = [];
    for (let i = 0; i < 4; i++) {
      const r = await req(trusted.base, "/api/auth/register", {
        method: "POST",
        body: { email: `t2${stamp()}${i}@example.test`, password: "correct-horse-9" },
        headers: { "x-forwarded-for": "203.0.113.0" },
      });
      again.push(r.status);
    }
    assert.ok(again.includes(429), `per-ip limit must bite for repeat hits: ${again.join(",")}`);
  });

  await run("health reports how identity is being derived", async () => {
    const bad = await req(untrusted.base, "/api/health");
    const good = await req(trusted.base, "/api/health");
    assert.equal(bad.json.services.identity.state, "degraded");
    assert.match(bad.json.services.identity.detail, /TRUST_PROXY_HOPS/);
    assert.equal(good.json.services.identity.state, "live");
  });

  await run("per-account login throttle survives IP rotation", async () => {
    const email = `lock${stamp()}@example.test`;
    const jar = newJar();
    const created = await req(trusted.base, "/api/auth/register", {
      method: "POST",
      jar,
      body: { email, password: "correct-horse-9" },
    });
    assert.equal(created.status, 200, `account needed for the lockout test: ${created.status}`);

    const codes = [];
    for (let i = 0; i < 20; i++) {
      const r = await req(trusted.base, "/api/auth/login", {
        method: "POST",
        body: { email, password: "definitely-wrong-1" },
        headers: { "x-forwarded-for": `198.51.100.${i}` },
      });
      codes.push(r.status);
    }
    const blocked = codes.filter((c) => c === 429).length;
    assert.ok(
      blocked > 0,
      `20 wrong passwords were all accepted (${codes.join(",")}) — the account bucket is not being read`
    );
    // Credential stuffing is refused with a retry window, not a 500.
    const first = codes.indexOf(429);
    assert.ok(first >= 8, `the limit should allow a human's bad day first, blocked at #${first}`);
  });

  await run("AI routes are bucketed per session, not per IP", async () => {
    // The AI routes key on the signed session/guest id, so the same visitor
    // cannot multiply quota by changing headers. Compare search limits.
    const jar = newJar();
    const hit = async (ip) =>
      (
        await req(untrusted.base, "/api/ai/search", {
          method: "POST",
          jar,
          body: { query: `probe ${stamp()}` },
          headers: { "x-forwarded-for": ip },
        })
      ).status;
    const first = await hit("203.0.113.1");
    assert.ok([200, 429, 502].includes(first), `search should answer or throttle, got ${first}`);
    // Same session, different claimed IPs: the bucket follows the session, so
    // after the cap (30/min) the caller is throttled regardless of the header.
    const statuses = [];
    for (let i = 0; i < 40; i++) statuses.push(await hit(`203.0.114.${i % 250}`));
    assert.ok(
      statuses.includes(429),
      `40 searches from one session were never throttled (${[...new Set(statuses)].join(",")})`
    );
  });
} catch (e) {
  results.push(`  FAIL  server boot / harness: ${e.message}`);
} finally {
  for (const s of servers) s.stop();
}

process.exit(report('Rate-limit identity checks (isolated servers)') ? 1 : 0);
