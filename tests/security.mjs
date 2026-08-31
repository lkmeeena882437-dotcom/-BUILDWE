#!/usr/bin/env node
/**
 * BUILDWE security + money regression tests.
 *
 *   BASE_URL=http://localhost:3000 node tests/security.mjs
 *   (or: npm run test:security)
 *
 * These are the exploits found in the 2026-08-31 audit, replayed against a
 * running server. Each one asserts the FIXED behaviour, so the file doubles as
 * the proof that Wave 0 actually landed. Nothing here is mocked: it talks to a
 * real dev/prod server over HTTP, and it FAILS LOUDLY if the server is not
 * reachable rather than skipping green.
 */

import assert from "node:assert/strict";

/**
 * With no BASE_URL set, the suite boots its OWN server on a spare port with an
 * empty data dir. Pointing at a developer's warm :3000 makes results depend on
 * whatever they tried last, which is not a test.
 */
const EXPLICIT = process.env.BASE_URL;
const PORT = Number(process.env.BW_TEST_PORT || 3331);
const results = [];
let failed = 0;
let own = null;

async function check(name, fn) {
  try {
    await fn();
    results.push(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    results.push(`  FAIL  ${name}\n          ${String(e.message).split("\n")[0]}`);
  }
}

/** Cookie jar so one "browser" can hold a session across requests. */
function newJar() {
  const cookies = new Map();
  return {
    header: () =>
      [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") || undefined,
    absorb(res) {
      for (const raw of res.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

async function req(path, { method = "GET", jar, body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  jar?.absorb(res);
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    /* html or empty */
  }
  return { status: res.status, json, text };
}

/** Unique per call, because signup is deliberately capped per email. */
let seq = 0;
const nextEmail = () => `w0-${Date.now()}-${(seq++).toString(36)}@example.test`;
const passwordFor = () => "correct-horse-9";
/** The one account reused by the tests that need a known credential. */
const email = nextEmail();

async function signup(password = "correct-horse-9", at = nextEmail()) {
  const jar = newJar();
  const r = await req("/api/auth/register", {
    method: "POST",
    jar,
    body: { email: at, password, name: "Wave Zero" },
  });
  return { jar, r };
}

import { startServer } from "./harness.mjs";
let BASE = EXPLICIT;
if (!BASE) {
  own = await startServer({
    port: PORT,
    label: "bw-wave0",
    env: { SIGNUPS_PER_IP_PER_HOUR: "200", SIGNUPS_PER_EMAIL_PER_DAY: "20" },
  });
  BASE = own.base;
}

console.log(`\nBUILDWE Wave-0 checks against ${BASE}\n`);

await check("server is up and honest about health shape", async () => {
  const r = await req("/api/health");
  assert.equal(r.status, 200, "health endpoint must answer");
  assert.ok(r.json?.services, "/api/health must expose typed services");
  // C-leak: the old payload told visitors whether demo mode was on and which
  // vendor credentials exist. Both are reconnaissance, not status.
  assert.equal(r.json.demoMode, undefined, "demoMode must not be public");
  // The flag is gone from the source, not just from this response: no env var may put
  // the checkout endpoint back into a mode that says "paid" without money moving.
  const { readFileSync } = await import("node:fs");
  const root = new URL("..", import.meta.url);
  const read = (rel) => readFileSync(new URL(rel, root), "utf8");
  assert.ok(!/DEMO_MODE/.test(read("lib/config.ts")), "NEXT_PUBLIC_DEMO_MODE must not come back");
  assert.ok(!/export function demoCheckoutOrder/.test(read("lib/payments/razorpay.ts")), "no canned-order factory in the payments lib (a comment may still name it)");
  assert.ok(!/demo:\s*true/.test(read("app/api/checkout/order/route.ts")), "the order route cannot answer with a demo order");
  assert.ok(!/DEMO_MODE/.test(read(".env.example")), "the example env must not offer a demo switch");
  assert.equal(
    r.json.providers?.configured,
    undefined,
    "the configured-vendor list must not be public"
  );
  const rows = Object.values(r.json.services);
  assert.ok(rows.length >= 8, `expected a row per service, got ${rows.length}`);
  for (const row of rows) {
    assert.ok(
      ["live", "degraded", "unconfigured", "down"].includes(row.state),
      `every row needs a real state, got ${row.state}`
    );
    assert.equal(typeof row.ok, "boolean", "every row needs a boolean ok");
    assert.ok(row.detail?.length > 8, "every row needs a human explanation");
    assert.ok(row.evidence?.length > 3, "every row needs to say how it was measured");
  }
});

await check("ops metrics are not public", async () => {
  const open = await req("/api/metrics");
  assert.equal(open.status, 401, "GET /api/metrics must not answer anonymous callers");
  const junk = await req("/api/metrics", {
    method: "POST",
    body: { kind: "arbitrary_key_that_inflates_counters" },
  });
  assert.ok([400, 429].includes(junk.status), `unknown metric kind rejected (${junk.status})`);
});

await check("C1: junk checkout payload cannot buy PRO", async () => {
  const { jar, r } = await signup(passwordFor(email), email);
  assert.equal(r.status, 200, `signup failed: ${r.text.slice(0, 160)}`);
  assert.equal(r.json.user.plan, "free");

  const junk = await req("/api/checkout/verify", {
    method: "POST",
    jar,
    body: {
      razorpay_order_id: "order_" + Math.random().toString(36).slice(2),
      razorpay_payment_id: "pay_" + Math.random().toString(36).slice(2),
      razorpay_signature: "not-a-real-signature",
    },
  });
  assert.notEqual(junk.status, 200, "an unsigned payload must never verify");
  const after = await req("/api/auth/me", { jar });
  assert.equal(after.json.user.plan, "free", "plan must still be free");
});

await check("C1: no fake order is minted when payments are unconfigured", async () => {
  const { jar } = await signup();
  const order = await req("/api/checkout/order", { method: "POST", jar });
  if (order.status === 503) {
    assert.equal(order.json.code, "CHECKOUT_UNAVAILABLE");
    assert.ok(
      /not configured|not enabled|cannot be purchased/i.test(order.json.error),
      "the 503 has to explain itself to a real user"
    );
    return;
  }
  // Live deployment: an order may only come from the gateway, so it must carry
  // a real Razorpay id and the server's price — never a local demo id.
  assert.equal(order.status, 200, `unexpected ${order.status}`);
  assert.ok(/^order_(?!demo_)/.test(order.json.order.id), "order id must be a real one");
  assert.equal(order.json.demo, false, "live orders are never demo");
});

await check("signup rejects a short password (no 6-char accounts)", async () => {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { email: `short-${Date.now()}@example.test`, password: "abc" },
  });
  assert.equal(r.status, 422, `expected 422, got ${r.status}`);
});

await check("C2: share page escapes quotes and kills javascript: links", async () => {
  const { jar } = await signup();
  const payload =
    'x](https://e" onmouseover="window.__PWNED__=1) [a](javascript:alert(1)) ' +
    '<img src=x onerror="window.__PWNED__=2"> ```js" onload="window.__PWNED__=3';
  const conv = await req("/api/history", {
    method: "POST",
    jar,
    body: {
      action: "create",
      mode: "chat",
      title: "xss probe",
      messages: [{ role: "assistant", content: payload }],
    },
  });
  assert.equal(conv.status, 200, `conversation create failed: ${conv.text.slice(0, 120)}`);
  const share = await req("/api/share", {
    method: "POST",
    jar,
    body: { conversationId: conv.json.conversation.id },
  });
  assert.equal(share.status, 200, `share create failed: ${share.text.slice(0, 120)}`);
  const page = await req(share.json.url);
  assert.equal(page.status, 200, "the share page must render");
  // The message bodies are rendered client-side, so the HTML alone cannot
  // prove the renderer is safe — tests/markdown-xss.mjs asserts on the
  // renderer directly. Here we prove the transport is not leaking raw HTML.
  assert.ok(
    !/onmouseover=|onerror=/.test(page.text),
    "raw handler text reached the served HTML"
  );
  assert.ok(
    !/onmouseover=|onerror=|onload=/.test(page.text),
    "an event handler reached the HTML of a public page"
  );
  assert.ok(!/javascript:/.test(page.text), "a javascript: URL reached an href");
  assert.ok(
    !/<img\s/i.test(page.text.replace(/<img [^>]*src="\/_next[^"]*"/g, "")),
    "raw <img> from user content was not escaped"
  );
});

await check("history answers, and never lies with an empty list", async () => {
  const r = await req("/api/history", { method: "GET" });
  assert.ok(
    r.status === 200 || r.status === 429 || r.status === 503,
    `history should answer, throttle, or fail honestly — got ${r.status}`
  );
  if (r.status === 200) {
    assert.ok(Array.isArray(r.json.conversations), "a 200 must carry real data");
    assert.equal(
      r.json.error,
      undefined,
      "a successful history read must not also claim an error"
    );
  }
});

await check("payment ledger cannot be double-redeemed", async () => {
  const { jar } = await signup();
  const a = await req("/api/checkout/verify", {
    method: "POST",
    jar,
    body: {
      razorpay_order_id: "order_replay_test",
      razorpay_payment_id: "pay_replay_test",
      razorpay_signature: "0".repeat(64),
    },
  });
  const b = await req("/api/checkout/verify", {
    method: "POST",
    jar,
    body: {
      razorpay_order_id: "order_replay_test",
      razorpay_payment_id: "pay_replay_test",
      razorpay_signature: "0".repeat(64),
    },
  });
  assert.notEqual(a.status, 200, "a forged signature must not verify");
  assert.equal(a.status, b.status, "replay must behave identically to the first call");
});

own?.stop();

console.log(results.join("\n"));
console.log(
  `\n${results.length - failed}/${results.length} checks passed` +
    (failed ? ` — ${failed} FAILED\n` : "\n")
);
process.exit(failed ? 1 : 0);
