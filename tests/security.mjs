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
  // Since UI step 10 the transcript is rendered on the SERVER, so the payload's own words
  // are now inside the served HTML (and inside the flight payload in a <script>, where the
  // parser reads them as text). "the string never appears" was therefore always a proxy for
  // "nothing the parser trusts was opened" — and it is now a proxy that cannot hold. These
  // assertions are the thing itself: no attribute may be opened in any element tag, no
  // javascript: URL may reach a src/href, and the payload must arrive ESCAPED, which is the
  // positive proof that renderSafeMarkdown ran before the bytes left the server.
  // tests/markdown-xss.mjs still asserts on the renderer itself; that pair is the coverage.
  // Scanning "tags" with a regex would be its own bug: an attribute value may legally hold
  // a `>`, so the honest shape of the invariant is that an event handler is never followed
  // by a real quote. Escaped text always reads `onmouseover=&quot;`, and the flight payload
  // inside <script> reads `onmouseover=\"` — neither can start an attribute.
  // The name has to START an attribute, which is what the leading character class is for:
  // without it `content="` matches through its own "on", and a check that fires on every
  // meta tag is a check nobody keeps.
  const handler = page.text.match(/[\s"']on[a-z]+\s*=\s*["']/i);
  assert.equal(
    handler,
    null,
    `an event handler was opened with a live quote in the served HTML: ${String(handler).slice(0, 120)}`
  );
  assert.ok(
    !/(href|src)="\s*javascript:/i.test(page.text),
    "a javascript: URL reached an href or src"
  );
  assert.ok(
    page.text.includes("&lt;img src=x onerror="),
    "the probe did not reach the page at all — this test would pass on an empty response"
  );
  assert.ok(
    !/<img\s/i.test(page.text.replace(/<img [^>]*src="\/_next[^"]*"/g, "")),
    "raw <img> from user content was not escaped"
  );
  // The new title/description path is its own risk: a share title is user text, and it now
  // goes into a <meta content="…">. One quote there would close the attribute.
  const meta = page.text.match(/<meta name="description" content="([^"]*)"/);
  assert.ok(meta, "a share should describe itself");
  assert.ok(!meta[1].includes("<"), "a description could open a tag");
  assert.ok(
    meta[1].includes("&quot;"),
    "and the quote in the probe had to arrive escaped, not as the end of the attribute"
  );
  const robots = page.text.match(/<meta name="robots" content="([^"]*)"/);
  assert.ok(robots && /noindex/.test(robots[1]), "a shared conversation is public, not indexable");
});

await check("gitignore keeps real env files out of git", async () => {
  const { readFileSync } = await import("node:fs");
  const gi = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.ok(/^\.env$/m.test(gi), ".env must be ignored");
  assert.ok(/^\.env\.\*$/m.test(gi), ".env.* must be ignored (covers .env.production, .env.development)");
  assert.ok(/^!\.env\.example$/m.test(gi), ".env.example must stay tracked");
  assert.ok(/^\.vercel$/m.test(gi), "Vercel CLI dumps must stay out");
  assert.ok(/\/docs\/\*\.md/.test(gi), "operator markdown must stay untracked");
});

await check("tracked sources do not contain live tenant ids or key prefixes", async () => {
  // Banned strings are base64 so this file cannot re-introduce them.
  const banned = [
    Buffer.from("eWllbnpjeWZtbXZhd2J4emRwdGI=", "base64").toString("utf8"),
    Buffer.from("Z3NrX0VoM2c=", "base64").toString("utf8"),
  ];
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const rootDir = new URL("..", import.meta.url);
  const skip = new Set(["node_modules", ".git", ".next", "tmp", "coverage", "out", "data"]);
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(md|ts|tsx|js|mjs|json|yml|yaml|example|sql)$/i.test(name) && name !== ".env.example") {
        continue;
      }
      const text = readFileSync(full, "utf8");
      for (const needle of banned) {
        if (text.includes(needle)) hits.push(`${full.slice(rootDir.pathname.length)} contains a redacted secret`);
      }
    }
  };
  walk(rootDir.pathname.replace(/\/$/, "") || rootDir.pathname);
  assert.deepEqual(hits, [], hits.join("; "));
});

await check("client modules do not import server secrets or tool prompts", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const rootDir = (new URL("..", import.meta.url).pathname.replace(/\/$/, "") || "/");
  const skip = new Set(["node_modules", ".git", ".next", "tmp", "coverage", "out", "data"]);
  const forbiddenFrom = [
    "@/lib/config",
    "@/lib/crypto",
    "@/lib/db/",
    "@/lib/ai/providers",
    "@/lib/ai/provider-registry",
    "@/lib/ai/workspace-context",
    "@/lib/tools/registry",
    "@/lib/payments/razorpay",
  ];
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
      const rel = full.slice(rootDir.length + 1);
      const inClientTree =
        rel.startsWith("components/") ||
        rel.startsWith("lib/client/") ||
        (rel.startsWith("app/") && !rel.startsWith("app/api/"));
      if (!inClientTree) continue;
      const text = readFileSync(full, "utf8");
      const isClient =
        rel.startsWith("lib/client/") || /^\s*["']use client["']/.test(text);
      if (!isClient) continue;
      for (const line of text.split("\n")) {
        if (!/\bfrom\s+["']/.test(line)) continue;
        if (/^\s*import\s+type\s/.test(line)) continue;
        for (const f of forbiddenFrom) {
          if (line.includes(`"${f}`) || line.includes(`'${f}`)) {
            hits.push(`${rel}: ${line.trim()}`);
          }
        }
      }
      for (const needle of ["AI_KEYS", "GROQ_API_KEY", "SESSION_SECRET", "SUPABASE_SERVICE_ROLE", "RAZORPAY_KEY_SECRET"]) {
        if (text.includes(needle)) hits.push(`${rel} mentions ${needle}`);
      }
    }
  };
  walk(rootDir);
  assert.deepEqual(hits, [], hits.join("; "));
});

await check("guessed ids do not read or write another user's rows", async () => {
  const alice = await signup();
  const bob = await signup();
  assert.equal(alice.r.status, 200, `alice signup: ${alice.r.text.slice(0, 120)}`);
  assert.equal(bob.r.status, 200, `bob signup: ${bob.r.text.slice(0, 120)}`);

  const conv = await req("/api/history", {
    method: "POST",
    jar: alice.jar,
    body: {
      action: "create",
      mode: "chat",
      title: "alice only",
      messages: [{ role: "user", content: "secret from alice" }],
    },
  });
  assert.equal(conv.status, 200, `alice create: ${conv.text.slice(0, 120)}`);
  const cid = conv.json.conversation.id;

  const peek = await req("/api/history", {
    method: "POST",
    jar: bob.jar,
    body: { action: "get", conversationId: cid },
  });
  assert.equal(peek.status, 404, `bob must not open alice's chat (${peek.status})`);
  assert.equal(peek.json?.conversation, undefined, "no conversation body on a 404");

  const append = await req("/api/history", {
    method: "POST",
    jar: bob.jar,
    body: {
      action: "append",
      conversationId: cid,
      messages: [{ role: "user", content: "bob injecting" }],
    },
  });
  assert.equal(append.status, 404, `bob must not append into alice's chat (${append.status})`);

  const still = await req("/api/history", {
    method: "POST",
    jar: alice.jar,
    body: { action: "get", conversationId: cid },
  });
  assert.equal(still.status, 200);
  const texts = (still.json.conversation.messages || []).map((m) => m.content);
  assert.ok(texts.includes("secret from alice"));
  assert.equal(texts.includes("bob injecting"), false, "alice's thread must not grow bob's message");

  const stolenId = await req(`/api/history?id=${encodeURIComponent(cid)}`, {
    method: "DELETE",
    jar: bob.jar,
  });
  assert.equal(stolenId.status, 404, `bob must not delete alice's chat (${stolenId.status})`);

  const proj = await req("/api/projects", {
    method: "POST",
    jar: alice.jar,
    body: { action: "create", name: "alice folder" },
  });
  assert.equal(proj.status, 200, `alice project: ${proj.text.slice(0, 120)}`);
  const pid = proj.json.project.id;

  const files = await req(`/api/projects/files?projectId=${encodeURIComponent(pid)}`, {
    jar: bob.jar,
  });
  assert.equal(files.status, 404, `bob must not list alice's files (${files.status})`);

  const zap = await req(`/api/projects?id=${encodeURIComponent(pid)}`, {
    method: "DELETE",
    jar: bob.jar,
  });
  assert.equal(zap.status, 404, `bob must not delete alice's project (${zap.status})`);

  const listed = await req("/api/projects", { jar: alice.jar });
  assert.equal(listed.status, 200);
  assert.ok(
    (listed.json.projects || []).some((p) => p.id === pid),
    "alice's project must still be there"
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
