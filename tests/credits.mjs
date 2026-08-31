/**
 * Wave 2 credit-economy suite.
 *
 * Nothing here is mocked except the vendor: the wallet, the ledger, the hold,
 * the refund, the 402 gate, the guest→user migration and the price list all run
 * for real against a real server and a real store. `AI_BASE_URL_GROQ` points the
 * actual OpenAI-wire adapter at a localhost endpoint that speaks the same
 * protocol (same trick as tests/tools.mjs), so a *successful* paid run — and the
 * charge that goes with it — is observable in this sandbox.
 *
 * The invariants this suite exists to defend:
 *   1. the signup grant is minted once, to a guest or a user, never both;
 *   2. money leaves the wallet BEFORE the paid call, and comes back when the
 *      call produced nothing;
 *   3. an empty wallet cannot buy work — the run is refused, not silently free;
 *   4. `balance` always equals the sum of the ledger;
 *   5. a heavy tool's price is its own, and the frame that the UI shows is the
 *      number the server actually charged;
 *   6. the wallet survives a restart (it is on disk, not in memory);
 *   7. no path — forged verify, unknown pack, demo order — can mint credits.
 *
 * Run: npm run test:credits
 */

import http from "node:http";
import { newJar, req, report, run, startServer, stopServer } from "./harness.mjs";

const PORT_PAID = 3331; // has a (faked) provider + the normal 10-credit grant
const PORT_BROKE = 3332; // CREDITS_WELCOME=0 -> every paid route must 402
const PORT_OFFLINE = 3333; // no model at all -> the hold must come back
const FIXTURE_PORT = 3334;

const INR = "\u20b9";

/* ── provider fixture (OpenAI wire), same shape as tests/tools.mjs ── */

const GOOD_BLOG = [
  "# Blog about BUILDWE",
  "## Key takeaways",
  "- One wallet, one price per generation",
  "- A failed run is a refunded run",
  "## Why credits beat feature gates",
  "A feature gate says \u201cyou may not\u201d; a credit says \u201cthis costs that\u201d. The second one survives contact with a real user, because it explains itself at the moment of purchase and never needs a support ticket to describe what happened. BUILDWE prices an artifact, not a chat turn, so the meter only moves when something was produced and saved for you to keep.",
  "## What the runner enforces",
  "The hold is taken before the model is called. If the provider refuses, if the answer is empty, if the stream dies, the credit returns on its own with a ledger row saying so. Nobody has to ask for it, which is the only way this kind of promise is worth making.",
  "## How it is priced",
  "One generation of a tool is one credit. A heavy, multi-section tool is two. Chat is free on purpose: it is the thing that shows whether the rest is worth paying for, and metering it is how a product loses the user before the first invoice ever arrives.",
  "## What that buys you",
  "Ten credits at signup is enough to judge quality on your own work, which is the only review that matters here. If it is not better than what you do now, the pack you did not buy stays in your wallet for later, and nothing about the account has changed.",
  "## Call to action",
  "Run one tool against a task you have today, then check the ledger row it wrote. If the credit moved and the answer is worse than your own draft, that is a bug you should tell us about, not a price you should argue with.",
  "META: One credit wallet, priced per artifact, with refunds the server issues itself.",
  "SLUG: buildwe-credit-economy",
].join("\n\n");

let mode = "good";
const calls = [];

const fixture = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* */
    }
    const system = String(parsed?.messages?.[0]?.content || "");
    calls.push({ model: parsed?.model, isCorrection: /CORRECTION PASS/.test(system), at: Date.now() });
    const text = mode === "good" || calls[calls.length - 1].isCorrection ? GOOD_BLOG : "too short";
    if (parsed?.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const p of text.match(/[\s\S]{1,180}/g) || [text]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
    }
  });
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));

/* ── servers ─────────────────────────────────────────────── */

const signupEnv = {
  SIGNUPS_PER_IP_PER_HOUR: "1000",
  SIGNUPS_PER_EMAIL_PER_DAY: "1000",
  SIGNUPS_GLOBAL_PER_DAY: "1000",
  TRUST_PROXY_HOPS: "1",
};
const creditEnv = {
  CREDITS_WELCOME: "10",
  CREDIT_COST_IMAGE: "2",
  CREDIT_COST_TOOL: "1",
  NEXT_PUBLIC_RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
};

const paid = await startServer({
  port: PORT_PAID,
  label: "credits-paid",
  env: {
    ...signupEnv,
    ...creditEnv,
    GROQ_API_KEY: "bw-fixture-key",
    AI_BASE_URL_GROQ: `http://127.0.0.1:${FIXTURE_PORT}/v1/chat/completions`,
  },
});
const broke = await startServer({
  port: PORT_BROKE,
  label: "credits-broke",
  env: {
    ...signupEnv,
    CREDITS_WELCOME: "0",
    GROQ_API_KEY: "bw-fixture-key",
    AI_BASE_URL_GROQ: `http://127.0.0.1:${FIXTURE_PORT}/v1/chat/completions`,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: "",
    RAZORPAY_KEY_SECRET: "",
  },
});
const offline = await startServer({
  port: PORT_OFFLINE,
  label: "credits-offline",
  env: { ...signupEnv, CREDITS_WELCOME: "10" },
});

let BASE = paid.base;
const BROKE = broke.base;
const OFF = offline.base;
let running = paid;

/* ── helpers ─────────────────────────────────────────────── */

async function credits(base, jar) {
  const r = await req(base, "/api/credits", { jar });
  if (r.status !== 200 || !r.json?.ok) {
    throw new Error(`/api/credits -> ${r.status} ${String(r.text).slice(0, 120)}`);
  }
  return r.json;
}

function sumDeltas(rows) {
  return (rows || []).reduce((n, r) => n + (Number(r.delta) || 0), 0);
}

function expectConsistent(j, who) {
  if (j.balance !== sumDeltas(j.ledger)) {
    throw new Error(
      `${who}: balance ${j.balance} != ledger sum ${sumDeltas(j.ledger)} (${JSON.stringify(
        (j.ledger || []).slice(0, 6).map((r) => [r.delta, r.reason])
      )})`
    );
  }
}

/** Reads a tool run (SSE or JSON) to the end and reports what it saw. */
async function toolRun(base, jar, id, inputs) {
  const res = await fetch(`${base}/api/tools/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jar.header() ? { cookie: jar.header() } : {}),
    },
    body: JSON.stringify({ inputs }),
  });
  const ctype = res.headers.get("content-type") || "";
  // Absorb first: a request from a cookie-less visitor mints a NEW guest
  // wallet server-side, and a test that ignores the cookie ends up auditing a
  // different person's balance.
  jar?.absorb(res);
  if (!res.ok || ctype.includes("json")) {
    const json = await res.json().catch(() => null);
    return { status: res.status, json, frames: [], done: null };
  }
  const text = await res.text();
  const frames = text
    .split("\n\n")
    .flatMap((f) => f.split("\n"))
    .filter((l) => l.startsWith("data:"))
    .map((l) => {
      try {
        return JSON.parse(l.slice(5).trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { status: res.status, frames, done: frames.find((f) => f.done) || null, json: null };
}

/* ── 1. the signup grant ─────────────────────────────────── */

await run("a brand-new visitor is granted the welcome balance exactly once", async () => {
  const g = newJar();
  const first = await credits(BASE, g);
  if (first.balance !== 10) throw new Error(`expected 10 credits, got ${first.balance}`);
  const welcome = (first.ledger || []).filter((r) => r.reason === "welcome");
  if (welcome.length !== 1) throw new Error(`welcome rows = ${welcome.length}, expected 1`);
  if (!first.welcomeAt) throw new Error("welcomeAt not stamped");
  const again = await credits(BASE, g);
  if (again.balance !== 10) throw new Error(`a second read minted more: ${again.balance}`);
  if ((again.ledger || []).filter((r) => r.reason === "welcome").length !== 1) {
    throw new Error("the grant is not idempotent on read");
  }
  expectConsistent(again, "fresh guest");
});

await run("signing up does not stack a second welcome grant on the guest one", async () => {
  const g = newJar();
  const before = await credits(BASE, g);
  if (before.balance !== 10) throw new Error(`guest balance ${before.balance}`);
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar: g,
    body: {
      email: `credits-${Date.now()}@buildwe.test`,
      password: "credits-test-password",
      name: "Credit tester",
    },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register -> ${r.status} ${r.text}`);
  const after = await credits(BASE, g);
  // 10 as a guest + 10 as a user would be a free-credit farm: the migration
  // keeps the earlier welcome and drops the duplicate mint.
  if (after.balance !== 10) throw new Error(`expected 10 after signup, got ${after.balance}`);
  const welcomes = (after.ledger || []).filter((x) => x.reason === "welcome");
  if (welcomes.length !== 1) throw new Error(`${welcomes.length} welcome rows after signup`);
  expectConsistent(after, "signup migration");
});

/* ── 2. a real charge, for real work ─────────────────────── */

const worker = newJar();

await run("a successful heavy-tool run charges that tool's own cost", async () => {
  const before = await credits(BASE, worker);
  if (before.balance !== 10) throw new Error(`worker started at ${before.balance}`);
  const res = await toolRun(BASE, worker, "blog-post", { topic: "why credits beat feature gates" });
  if (res.status !== 200) throw new Error(`tool run -> ${res.status} ${JSON.stringify(res.json)}`);
  if (!res.done) throw new Error("no done frame; the run did not complete");
  const charged = res.done.credits?.charged;
  if (charged !== 2) {
    throw new Error(`done frame reported charged=${charged}, expected 2 (heavy prose tool)`);
  }
  const after = await credits(BASE, worker);
  if (after.balance !== 8) throw new Error(`balance ${after.balance} after a 2-credit run`);
  const row = (after.ledger || []).find((r) => r.reason === "tool:blog-post");
  if (!row || row.delta !== -2) throw new Error(`no -2 tool row: ${JSON.stringify(row)}`);
  if (!(after.ledger || []).some((r) => r.balanceAfter === 8)) throw new Error("balanceAfter not mirrored");
  expectConsistent(after, "worker");
});

await run("the balance in the receipt frame is the number the server holds", async () => {
  const res = await toolRun(BASE, worker, "blog-post", { topic: "the receipt has to be the truth" });
  if (!res.done) throw new Error(`no done frame: ${JSON.stringify(res.json)}`);
  if (res.done.credits?.charged !== 2) {
    throw new Error(`second run charged ${res.done.credits?.charged}, expected 2`);
  }
  if (res.done.credits?.balance !== 6) {
    throw new Error(`frame says balance ${res.done.credits?.balance}, expected 6`);
  }
  const after = await credits(BASE, worker);
  if (after.balance !== 6) throw new Error(`server says ${after.balance}, frame said 6`);
});

/* ── 3. nothing produced => nothing kept ─────────────────── */

await run("when no model answers, the held credit comes back with a reason", async () => {
  const g = newJar();
  const before = await credits(OFF, g);
  if (before.balance !== 10) throw new Error(`offline guest balance ${before.balance}`);
  const res = await toolRun(OFF, g, "blog-post", { topic: "the honest refund path" });
  if (res.status !== 503) throw new Error(`expected 503 with no model, got ${res.status}`);
  if (res.json?.code !== "PROVIDER_UNAVAILABLE") throw new Error(`code = ${res.json?.code}`);
  const after = await credits(OFF, g);
  if (after.balance !== 10) throw new Error(`balance ${after.balance} after a failed run`);
  const spend = (after.ledger || []).filter((r) => r.reason === "tool:blog-post");
  const refund = (after.ledger || []).filter((r) => r.reason === "tool:offline-refund");
  if (!spend.length || !refund.length) {
    throw new Error(`expected a -cost row and its refund, got ${JSON.stringify((after.ledger || []).slice(0, 4))}`);
  }
  if (spend.length !== refund.length) throw new Error(`${spend.length} spends vs ${refund.length} refunds`);
  expectConsistent(after, "offline guest");
});

await run("two failed runs leave the wallet exactly where it started", async () => {
  const g = newJar();
  const first = await toolRun(OFF, g, "blog-post", { topic: "balanced pairs one" });
  // A failed run must still hand the visitor their identity, or the refund it
  // just wrote belongs to nobody.
  if (!/bw_guest=/.test(g.header() || "")) {
    throw new Error(`no guest cookie on the error response (status ${first.status}) - refunds would be stranded`);
  }
  await toolRun(OFF, g, "blog-post", { topic: "balanced pairs two" });
  const j = await credits(OFF, g);
  if (j.balance !== 10) throw new Error(`two failed runs changed the balance to ${j.balance}`);
  const spends = (j.ledger || []).filter((r) => r.delta < 0 && r.reason.startsWith("tool:")).length;
  const refunds = (j.ledger || []).filter((r) => r.delta > 0 && r.reason.endsWith("-refund")).length;
  if (spends !== 2 || refunds !== 2) throw new Error(`spends=${spends} refunds=${refunds}, expected 2 and 2`);
});

/* ── 4. an empty wallet buys nothing ─────────────────────── */

await run("a zero-balance account is refused before any paid call (402, not a free run)", async () => {
  const g = newJar();
  const j0 = await credits(BROKE, g);
  if (j0.balance !== 0) throw new Error(`expected a 0-credit wallet, got ${j0.balance}`);
  const before = calls.length;
  const res = await toolRun(BROKE, g, "blog-post", { topic: "should never reach the model" });
  if (res.status !== 402) throw new Error(`status ${res.status} (expected 402)`);
  if (res.json?.code !== "INSUFFICIENT_CREDITS") throw new Error(`code ${res.json?.code}`);
  if (res.json?.needed !== 2 || res.json?.balance !== 0) {
    throw new Error(`needed/balance = ${res.json?.needed}/${res.json?.balance}`);
  }
  if (!Array.isArray(res.json?.packs) || res.json.packs.length === 0) {
    throw new Error("the 402 does not carry the top-up options the UI needs");
  }
  if (calls.length !== before) throw new Error("the provider was called even though the wallet was empty");
  const j1 = await credits(BROKE, g);
  if (j1.balance !== 0) throw new Error(`a refused run still moved the balance: ${j1.balance}`);
});

await run("a light tool's 402 asks for exactly 1 credit", async () => {
  const g = newJar();
  await credits(BROKE, g);
  const res = await toolRun(BROKE, g, "commit-message", { diff: "- const a = 1;\n+ const a = 2;" });
  if (res.status !== 402) throw new Error(`status ${res.status}, expected 402`);
  if (res.json?.needed !== 1) throw new Error(`needed = ${res.json?.needed}, expected 1`);
});

await run("the image route holds 2 credits and refuses an empty wallet", async () => {
  const refused = await fetch(`${BROKE}/api/ai/image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "a cube on white", aspect: "1:1" }),
  });
  if (refused.status !== 402) throw new Error(`broke wallet image -> ${refused.status}`);
  const rj = await refused.json().catch(() => ({}));
  if (rj.code !== "INSUFFICIENT_CREDITS" || rj.needed !== 2) throw new Error(JSON.stringify(rj).slice(0, 200));

  // Same call on the funded server: whatever the keyless image provider does,
  // the run must be *metered* - a charge that stuck, or a charge that came
  // back with a refund row. Silence is the only illegal outcome.
  const w = newJar();
  const j0 = await credits(BASE, w);
  const res = await fetch(`${BASE}/api/ai/image`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(w.header() ? { cookie: w.header() } : {}) },
    body: JSON.stringify({ prompt: "a sphere on white", aspect: "1:1" }),
  });
  const j = await res.json().catch(() => ({}));
  w.absorb(res);
  if (!res.ok) throw new Error(`funded image -> ${res.status} ${JSON.stringify(j).slice(0, 160)}`);
  const after = await credits(BASE, w);
  const rows = after.ledger || [];
  const charged = rows.find((r) => r.reason === "image");
  const refunded = rows.find((r) => r.reason === "image-refund");
  if (j.credits?.charged === 2) {
    if (!charged || charged.delta !== -2) throw new Error("receipt says 2 charged but no ledger row");
    if (after.balance !== j0.balance - 2) {
      throw new Error(`balance went ${j0.balance} -> ${after.balance} for a 2-credit image`);
    }
  } else if (charged && refunded) {
    if (after.balance !== j0.balance) {
      throw new Error(`charged then refunded, yet the balance moved to ${after.balance}`);
    }
  } else {
    throw new Error(`the image run was not metered at all: ${JSON.stringify(rows.slice(0, 3))}`);
  }
  expectConsistent(after, "image buyer");
});

/* ── 5. the price list is the server's, not the UI's ─────── */

await run("packs and per-work costs come from config, and env overrides land", async () => {
  const j = await credits(BASE, newJar());
  const packs = j.costs?.packs || [];
  if (packs.length !== 2) throw new Error(`${packs.length} packs`);
  const starter = packs.find((p) => p.id === "starter");
  const value = packs.find((p) => p.id === "value");
  if (!starter || starter.credits !== 100 || starter.paise !== 9900) {
    throw new Error(`starter: ${JSON.stringify(starter)}`);
  }
  if (!value || value.credits !== 500 || value.paise !== 39900) {
    throw new Error(`value: ${JSON.stringify(value)}`);
  }
  if (j.costs.image !== 2 || j.costs.tool !== 1 || j.costs.chat !== 0) {
    throw new Error(`the cost table did not come through: ${JSON.stringify(j.costs)}`);
  }
  if (j.welcome !== 10) throw new Error(`welcome grant ${j.welcome}`);
  const brokeJ = await credits(BROKE, newJar());
  if (brokeJ.welcome !== 0) throw new Error(`the zero-grant server reports ${brokeJ.welcome}`);
});

await run("the public tool list carries each tool's own cost, heavy ones at 2", async () => {
  const r = await req(BASE, "/api/tools");
  if (r.status !== 200) throw new Error(`/api/tools -> ${r.status}`);
  const all = (r.json.groups || []).flatMap((g) => g.tools || []);
  if (all.length < 30) throw new Error(`only ${all.length} tools listed`);
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  if (byId["commit-message"]?.creditCost !== 1) {
    throw new Error(`commit-message cost = ${byId["commit-message"]?.creditCost}`);
  }
  if (byId["blog-post"]?.creditCost !== 2) {
    throw new Error(`blog-post cost = ${byId["blog-post"]?.creditCost}`);
  }
  const heavy = all.filter((t) => t.creditCost >= 2).length;
  if (heavy < 5) throw new Error(`only ${heavy} tools priced as heavy`);
  if (all.some((t) => !(t.creditCost >= 1))) throw new Error("a tool is listed with no price");
});

await run("a tool page states its price before the button is pressed", async () => {
  const res = await fetch(`${BASE}/tools/blog-post`);
  const html = await res.text();
  if (res.status !== 200) throw new Error(`/tools/blog-post -> ${res.status}`);
  if (!/credit/i.test(html)) throw new Error("no credit wording in the tool page HTML");
});

/* ── 6. money cannot be minted by talking to the endpoints ── */

await run("checkout refuses to sell anything while keys are unset, and mints nothing", async () => {
  const g = newJar();
  const before = await credits(BASE, g);
  const order = await req(BASE, "/api/checkout/order", {
    method: "POST",
    jar: g,
    body: { pack: "starter" },
  });
  if (order.status === 200 && order.json?.demo !== true) {
    throw new Error(`an order was issued with no live keys: ${JSON.stringify(order.json).slice(0, 160)}`);
  }
  if (![401, 503, 200].includes(order.status)) throw new Error(`unexpected ${order.status}`);
  const fake = await req(BASE, "/api/checkout/verify", {
    method: "POST",
    jar: g,
    body: {
      razorpay_order_id: "order_demo_whatever",
      razorpay_payment_id: "pay_demo_whatever",
      razorpay_signature: "0".repeat(64),
    },
  });
  if (fake.json?.ok === true) throw new Error("verify said ok without a real payment");
  if (Number(fake.json?.credits) > 0 || fake.json?.granted === true) {
    throw new Error(`credits were granted by a forged verify: ${JSON.stringify(fake.json)}`);
  }
  const after = await credits(BASE, g);
  if (after.balance !== before.balance) {
    throw new Error(`a rejected checkout changed the wallet: ${before.balance} -> ${after.balance}`);
  }
});

await run("an unknown pack id is refused, not defaulted to the cheapest", async () => {
  const g = newJar();
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar: g,
    body: { email: `pack-${Date.now()}@buildwe.test`, password: "pack-test-password", name: "Pack" },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register -> ${r.status}`);
  const order = await req(BASE, "/api/checkout/order", {
    method: "POST",
    jar: g,
    body: { pack: "free-money-please" },
  });
  if (order.status !== 400 || order.json?.code !== "UNKNOWN_PACK") {
    throw new Error(`${order.status} ${JSON.stringify(order.json).slice(0, 160)}`);
  }
});

/* ── 7. the wallet is on disk, not in memory ─────────────── */

await run("the balance survives a restart of the server", async () => {
  const before = await credits(BASE, worker);
  if (before.balance !== 6) throw new Error(`worker balance drifted: ${before.balance}`);
  const dataDir = running.dataDir;
  const port = running.port;
  // Deliberately NOT running.stop(): that helper deletes the temp data dir, and
  // the whole point of this check is to read the same files back.
  stopServer({ child: running.child });
  const again = await startServer({
    port,
    label: "credits-restart",
    dataDir,
    env: { ...signupEnv, ...creditEnv, GROQ_API_KEY: "bw-fixture-key", AI_BASE_URL_GROQ: `http://127.0.0.1:${FIXTURE_PORT}/v1/chat/completions` },
  });
  running = again;
  BASE = again.base;
  const after = await req(again.base, "/api/credits", { jar: worker });
  if (!after.json?.ok) throw new Error(`credits after restart -> ${after.status}`);
  if (after.json.balance !== 6) throw new Error(`balance ${after.json.balance} after restart, expected 6`);
  expectConsistent(after.json, "restarted");
});

/* ── 8. a correction pass is a second charge, priced honestly ── */

await run("a correction pass charges its own credit and books its own refund", async () => {
  const g = newJar();
  await credits(BASE, g);
  mode = "bad";
  const res = await toolRun(BASE, g, "blog-post", { topic: "a first answer that fails the contract" });
  mode = "good";
  if (!res.done) throw new Error(`run did not finish: ${JSON.stringify(res.json)}`);
  const j = await credits(BASE, g);
  const charges = (j.ledger || []).filter((r) => r.reason === "tool:blog-post").length;
  const extras = (j.ledger || []).filter((r) => r.reason === "tool:blog-post:correction").length;
  const back = (j.ledger || []).filter((r) => r.reason === "tool:correction-refund").length;
  const charged = res.done.credits?.charged ?? 0;
  if (charges !== 1) throw new Error(`${charges} base charges, expected 1`);
  if (extras === 0) throw new Error("a corrective pass ran but was never charged");
  // either the better answer was kept (2 charges, no refund) or it was no
  // better (2 charges, 1 refund) - and the wallet must agree with that.
  if (charged === 4 && back !== 0) throw new Error(`charged 4 with a refund on the books (${back})`);
  if (charged === 2 && back !== 1) throw new Error(`kept 2 while a correction was refunded ${back} times`);
  if (j.balance !== 10 - charged) throw new Error(`balance ${j.balance} for a ${charged}-credit run`);
  expectConsistent(j, "correction");
});

/* ── report ──────────────────────────────────────────────── */

const failures = report("Wave 2 \u00b7 credit economy");
console.log(
  `   (fixture saw ${calls.length} provider call(s); packs are ${INR}99/100 and ${INR}399/500 as configured)`
);
running.stop();
broke.stop();
offline.stop();
fixture.close();
process.exit(failures ? 1 : 0);
