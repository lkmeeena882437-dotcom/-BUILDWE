/**
 * Wave 1 tool-runner suite.
 *
 * WHAT THIS IS NOT: a mock of BUILDWE. The app under test runs for real — the
 * registry, the input validator, the quota check, the provider adapter, the
 * SSE parsing, the output-contract grading, the corrective retry and the
 * history write all execute as written.
 *
 * WHAT IS SUBSTITUTED: one thing, the vendor. This sandbox has no outbound
 * network, so `AI_BASE_URL_GROQ` points the *real* OpenAI-wire adapter at a
 * localhost endpoint that speaks the same protocol. Same URL, same headers,
 * same JSON shapes, same SSE framing — if the adapter broke, this suite breaks.
 * (A live-key run against the real API is the last box in docs/BUILD_PLAN.md
 * W1.9 and needs the boss's Vercel deploy.)
 *
 * Run: npm run test:tools
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { newJar, req, report, run, startServer } from "./harness.mjs";

const PORT_TRUSTED = 3321; // has the (faked) provider key
const PORT_OFFLINE = 3322; // no key at all → tools must refuse
const FIXTURE_PORT = 3323;

/* ── provider fixture (OpenAI wire) ──────────────────────── */

const GOOD_BLOG = [
  "# Blog about BUILDWE",
  "## Key takeaways",
  "- One workspace instead of five tabs",
  "- Real quota counting on the server",
  "- Output contracts, not vibes",
  "## Why teams drift",
  "Teams drift because every tool keeps its own copy of the context. A chat thread knows the decision, the spreadsheet knows the numbers, and the doc knows what was promised three weeks ago. Nobody is wrong; the knowledge is just filed in four places, and the cost shows up as rework. BUILDWE keeps one thread per piece of work so the model sees the decision it is meant to support. That is the whole argument, and the evidence is boring: fewer copy-paste hops, fewer stale summaries, fewer arguments about where the truth lives. The alternative is a folder of screenshots that nobody opens twice, which is how a shipped feature gets argued about again in a meeting six weeks later.",
  "## What the runner enforces",
  "The runner grades structure, not style. Headings must exist, the length must land inside the band the tool declared, and the required blocks have to be present. Any failed check buys exactly one corrective regeneration, and if that still fails the answer is delivered with the failure named. Nothing here marks itself as good because a model said so.",
  "## How it is metered",
  "Usage counts the model calls that were actually made, so a corrected run costs two rather than one. That is the same rule the multi-model comparison route follows, which removes the loophole the audit found where a five-model request was charged as a single unit of work.",
  "## Call to action",
  "Open the workspace and run one tool against a real task you have today, then compare the output with what the tab-hopping version produced. If the tool output is worse, change the inputs, not the story you tell yourself about AI.",
  "META: One workspace for AI writing tools with real output checks and honest metering.",
  "SLUG: buildwe-writing-tools-real",
].join("\n\n");

const BAD_SHORT = "Here is a blog post: BUILDWE is great and everyone should use it.";

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
    calls.push({
      model: parsed?.model,
      stream: parsed?.stream === true,
      system,
      user: String(parsed?.messages?.[1]?.content || ""),
      isCorrection: /CORRECTION PASS/.test(system),
      at: Date.now(),
    });
    // A correction pass must always get the compliant text; otherwise the
    // retry-evaluation logic can't be tested at all.
    const text = mode === "good" || calls[calls.length - 1].isCorrection ? GOOD_BLOG : BAD_SHORT;

    if (parsed?.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const pieces = text.match(/[\s\S]{1,180}/g) || [text];
      for (const p of pieces) {
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

const trusted = await startServer({
  port: PORT_TRUSTED,
  label: "tools-live",
  env: {
    GROQ_API_KEY: "bw-fixture-key",
    AI_BASE_URL_GROQ: `http://127.0.0.1:${FIXTURE_PORT}/v1/chat/completions`,
    // the tool run loop signs a user in; keep signup buckets out of the way
    SIGNUPS_PER_IP_PER_HOUR: "1000",
    SIGNUPS_PER_EMAIL_PER_DAY: "1000",
    SIGNUPS_GLOBAL_PER_DAY: "1000",
    TRUST_PROXY_HOPS: "1",
    // This suite sweeps every registered tool from one account (31 runs, some
    // charged twice by a corrective pass). Wave 2 put a price in front of the
    // model, so a default signup wallet runs dry halfway through and the suite
    // starts reporting 402s as "tool broken". The grant is a config knob, so
    // the knob is what the fixture turns: the credit rules themselves are
    // asserted by tests/credits.mjs, which uses the real default.
    CREDITS_WELCOME: "500",
    // The compare checks below assert what the default lanes are, so the operator knobs are
    // pinned off rather than inherited from whatever the developer's shell happens to export.
    COMPARE_SEATS: "",
    COMPARE_SEAT_COUNT: "3",
  },
});
const offline = await startServer({
  port: PORT_OFFLINE,
  label: "tools-nomodel",
  env: {
    GROQ_API_KEY: "",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    // W3.1: asking for more default lanes than the built-in list has must pad from the catalog
    // rather than quietly run three. This server boots with that knob so the rule is observable.
    COMPARE_SEAT_COUNT: "5",
  },
});
// resolved from the servers themselves: the harness steps to a free port when a
// previous interrupted run left one occupied.
const BASE = trusted.base;
const OFF = offline.base;

const jar = newJar();
const H = () => (jar.header() ? { cookie: jar.header() } : {});

async function usage() {
  const r = await fetch(`${BASE}/api/auth/me`, { headers: H() });
  const j = await r.json();
  return j.usage || {};
}

/** Sign up a real account so quota + history are the app's own. */
{
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar,
    body: {
      email: `tools-${Date.now()}@buildwe.test`,
      password: "tools-test-password",
      name: "Tool tester",
    },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register failed: ${r.status} ${r.text}`);
}

/** POST a tool run and parse the SSE into frames. */
async function runTool(base, id, inputs, extra = {}) {
  const res = await fetch(`${base}/api/tools/${id}`, {
    method: "POST",
    headers: H({ "content-type": "application/json" }),
    body: JSON.stringify({ inputs, ...extra }),
  });
  if (!res.ok) {
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const raw = await res.text();
  const frames = [];
  for (const block of raw.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        frames.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* */
      }
    }
  }
  const text = frames
    .filter((f) => typeof f.token === "string")
    .map((f) => f.token)
    .join("");
  const replace = frames.find((f) => typeof f.replace === "string");
  const done = frames.find((f) => f.done);
  return {
    status: res.status,
    frames,
    text: replace ? replace.replace : text,
    replace: replace?.replace,
    done,
    checking: frames.find((f) => f.status === "checking"),
    meta: frames.find((f) => f.meta),
  };
}

/* ── 1 · catalogue is data, not a promise ────────────────── */

let catalogue = null;
await run("GET /api/tools returns every registered tool, fully specified", async () => {
  const j = await (await fetch(`${BASE}/api/tools`)).json();
  catalogue = j;
  if (!j.ok) throw new Error("ok flag false");
  if (!(j.count >= 30)) throw new Error(`only ${j.count} tools registered`);
  const flat = j.groups.flatMap((g) => g.tools);
  if (flat.length !== j.count) throw new Error(`groups list ${flat.length} but count says ${j.count}`);
  const ids = new Set(flat.map((t) => t.id));
  if (ids.size !== flat.length) throw new Error("duplicate tool ids in the catalogue");
  for (const t of flat) {
    if (!t.name || !t.description || !t.tagline) throw new Error(`${t.id} is missing copy`);
    if (!t.fields?.length) throw new Error(`${t.id} has no input fields — it can't be run`);
    for (const f of t.fields) {
      if (["text", "textarea"].includes(f.kind) && f.required && !f.max) {
        throw new Error(`${t.id}.${f.key} is a required free-text field with no character cap`);
      }
    }
  }
  if (!j.studios?.length) throw new Error("studios missing");
  for (const s of j.studios) {
    if (!s.tools?.length) throw new Error(`studio ${s.slug} has no runnable tools`);
    for (const t of s.tools) if (!ids.has(t.id)) throw new Error(`studio ${s.slug} references unknown tool ${t.id}`);
  }
});


await run("?brief=1 answers the palette's question and nothing else", async () => {
  const fullR = await fetch(`${BASE}/api/tools`);
  const full = await fullR.json();
  const r = await fetch(`${BASE}/api/tools?brief=1`);
  const j = await r.json();
  const flat = j.groups.flatMap((g) => g.tools);
  const fullFlat = full.groups.flatMap((g) => g.tools);
  if (!j.brief) throw new Error("the answer does not say which projection it is");
  if (flat.length !== fullFlat.length) throw new Error(`brief lists ${flat.length} tools, full lists ${fullFlat.length} — a menu must not be able to drop one`);
  for (const t of flat) {
    if (!t.id || !t.name || !t.tagline) throw new Error(`${t.id}: a launcher row needs an id, a name and a line`);
    for (const k of ["fields", "example", "description", "feature", "checks", "afterRun"]) {
      if (k in t) throw new Error(`${t.id} still carries ${k}, which is exactly what a menu cannot use`);
    }
    if (typeof t.creditCost !== "number") throw new Error(`${t.id} lost its cost — the row would have to lie about credits`);
  }
  for (const s of j.studios) {
    if (!s.slug || !s.name) throw new Error("a studio row without a link target");
    if ("tools" in s) throw new Error("brief studios still ship their tool arrays");
  }
  const bytes = JSON.stringify(j).length;
  const fullBytes = JSON.stringify(full).length;
  if (bytes > fullBytes / 3) throw new Error(`brief is ${bytes} B against ${fullBytes} B — barely a saving`);
  const cc = r.headers.get("cache-control") || "";
  if (!/max-age=300/.test(cc)) throw new Error(`brief is served "${cc}"; a per-user-free catalogue should survive a second ⌘K`);
  const fullCc = fullR.headers.get("cache-control") || "";
  if (!/max-age=60/.test(fullCc)) throw new Error(`the full answer is served "${fullCc}" — it holds field schemas, so it is not cached as long`);
});

await run("the public spec never leaks the prompt builders", async () => {
  const j = await (await fetch(`${BASE}/api/tools/blog-post`)).json();
  const t = j.tool;
  for (const k of ["buildSystem", "buildUser", "maxTokens", "temperature"]) {
    if (k in t) throw new Error(`${k} reached the browser — the client could rewrite the prompt`);
  }
  if (!t.fields.some((f) => f.key === "topic")) throw new Error("blog-post lost its topic field");
});

/* ── 2 · input validation is the server's, not the form's ── */

await run("missing required input is rejected before any model call", async () => {
  const before = calls.length;
  const r = await runTool(BASE, "blog-post", { tone: "bold" });
  if (r.status !== 400) throw new Error(`expected 400, got ${r.status}`);
  if (r.json?.code !== "BAD_INPUT") throw new Error(`code was ${r.json?.code}`);
  if (!r.json?.fields?.includes("topic")) throw new Error("the error didn't name the missing field");
  if (calls.length !== before) throw new Error("a model call happened for an invalid request — quota leak");
});

await run("a select field rejects values outside its option list", async () => {
  const r = await runTool(BASE, "blog-post", {
    topic: "anything at all about workspaces",
    tone: "<img src=x onerror=alert(1)>",
  });
  if (r.status !== 400) throw new Error(`free text was accepted into a select (status ${r.status})`);
});

await run("oversized text is clamped, and the clamp is reported", async () => {
  const r = await runTool(BASE, "grammar-checker", { source: "x".repeat(9000) });
  if (r.status !== 200) throw new Error(`expected a clamped 200, got ${r.status}`);
  const notes = r.meta?.meta?.notes || [];
  if (!notes.some((n) => /trimmed/i.test(n))) throw new Error(`no trim note in meta: ${JSON.stringify(notes)}`);
  const sent = calls[calls.length - 1];
  if (sent.user.split("").filter((c) => c === "x").length > 6100) {
    throw new Error("the prompt still carried the oversized payload");
  }
});

/* ── 3 · a real run: prompt, stream, contract, quota ─────── */

await run("a successful run builds the prompt server-side and streams the answer", async () => {
  mode = "good";
  calls.length = 0;
  const before = await usage();
  const r = await runTool(BASE, "blog-post", {
    topic: "Why most D2C brands plateau at ₹40L ARR",
    context: "our own numbers: 12% repeat rate, 3 ads, no email list",
  });
  if (r.status !== 200) throw new Error(`run failed: ${JSON.stringify(r.json)}`);
  if (!r.done) throw new Error("stream never reached done");
  if (!r.text.includes("Key takeaways")) throw new Error("answer did not stream through to the client");
  if (r.meta?.meta?.live !== true) throw new Error("run was not marked live");
  // The product labels vendors ("BUILDWE AI") rather than leaking model ids,
  // so the honest assertion is on what the ADAPTER sent upstream.
  if (!/BUILDWE/.test(String(r.meta?.meta?.model || ""))) {
    throw new Error(`unexpected public model label: ${r.meta?.meta?.model}`);
  }
  if (!r.meta?.meta?.modelId || /BUILDWE/.test(r.meta.meta.modelId)) {
    throw new Error(`meta.modelId must be the catalog id a retry can use, got ${r.meta?.meta?.modelId}`);
  }
  const sent = calls.find((c) => !c.isCorrection);
  if (!sent) throw new Error("the provider endpoint was never called");
  if (!sent.model || /BUILDWE/.test(sent.model)) {
    throw new Error(`the router sent a label instead of a catalog model id: ${sent.model}`);
  }
  if (!sent.system.includes("META:")) throw new Error("the tool's output contract never reached the model");
  if (!sent.user.includes("D2C brands plateau")) throw new Error("the user's topic was dropped from the prompt");
  if (!sent.user.includes("12% repeat rate")) throw new Error("the context field was ignored by the prompt builder");
  if (!sent.stream) throw new Error("tools must stream");
  if (!r.done.checks?.passed?.length) throw new Error("no output-contract results returned");
  if (r.done.attempts !== 1) throw new Error(`expected 1 attempt, got ${r.done.attempts}`);
  const after = await usage();
  if (after.chat !== before.chat + 1) {
    throw new Error(`usage did not move exactly one (${before.chat} → ${after.chat}) — quota is not enforced for tools`);
  }
});

await run("a contract violation costs one corrective pass, and it is charged twice", async () => {
  mode = "bad";
  calls.length = 0;
  const before = await usage();
  const r = await runTool(BASE, "blog-post", { topic: "anything worth writing about at all today" });
  const corrections = calls.filter((c) => c.isCorrection);
  if (!r.checking) throw new Error("the runner never reported the failed check to the client");
  if (!corrections.length) throw new Error("no corrective pass ran despite a failing answer");
  if (corrections.length > 1) throw new Error(`${corrections.length} correction passes — the loop is unbounded`);
  if (!r.replace) throw new Error("the corrected text never reached the client");
  if (/BUILDWE/.test(corrections[0].model || "")) {
    throw new Error("the corrective pass sent a display label to the provider instead of a model id");
  }
  if (!r.text.includes("Key takeaways")) throw new Error("the better answer was not the one kept");
  if (r.done.attempts !== 2) throw new Error(`attempts should be 2, got ${r.done.attempts}`);
  if (r.done.corrected !== true) throw new Error("the run must be reported as corrected, not silently replaced");
  const after = await usage();
  if (after.chat !== before.chat + 2) {
    throw new Error(`two model calls charged as ${after.chat - before.chat} — compute is free again`);
  }
  mode = "good";
});

await run("the run is written into the user's history with its checks attached", async () => {
  const j = await (await fetch(`${BASE}/api/history`, { headers: H() })).json();
  const conv = (j.conversations || []).find((c) => /^Blog Post Writer:/.test(c.title || ""));
  if (!conv) throw new Error("no tool run appeared in history — the answer only existed in the browser");
  if (!(conv.messageCount >= 1)) throw new Error(`thread was created but has ${conv.messageCount} messages`);
  if (!/BUILDWE|Key takeaways|workspace/i.test(conv.preview || "")) {
    throw new Error(`history preview isn't the generated text: ${JSON.stringify(conv.preview)}`);
  }
});

/* ── 4 · no model → no output, and nothing charged ───────── */

await run("with no live model the tool refuses instead of printing a template", async () => {
  const before = calls.length;
  const r = await runTool(OFF, "blog-post", { topic: "write me something nice about the weather" });
  if (r.status !== 503) throw new Error(`expected 503, got ${r.status} ${JSON.stringify(r.json || {})}`);
  if (r.json?.code !== "PROVIDER_UNAVAILABLE") throw new Error(`unexpected code ${r.json?.code}`);
  if (!/key|settings/i.test(r.json?.hint || "")) throw new Error("the refusal doesn't tell the user how to fix it");
  if (calls.length !== before) throw new Error("an offline deployment still reached for the provider");
});

/* ── 5 · every tool actually runs (the "no fake menu" test) */

await run("every registered tool accepts its own example and reaches the model", async () => {
  const flat = catalogue.groups.flatMap((g) => g.tools);
  const broken = [];
  for (const t of flat) {
    calls.length = 0;
    const r = await runTool(BASE, t.id, t.example);
    if (r.status === 400) {
      broken.push(`${t.id}: its own example is rejected (${r.json?.error})`);
      continue;
    }
    if (r.status !== 200) {
      broken.push(`${t.id}: status ${r.status} ${JSON.stringify(r.json || {})}`);
      continue;
    }
    const engineTool = t.id === "fact-check";
    if (!calls.length && !engineTool) broken.push(`${t.id}: no provider call — the tool has no engine`);
    if (calls.length && !calls[0].system && !engineTool)
      broken.push(`${t.id}: empty system prompt`);
    if (!r.done) broken.push(`${t.id}: stream never completed`);
  }
  if (broken.length) throw new Error(`\n - ${broken.join("\n - ")}`);
});

await run("the fact-check tool uses the search pipeline, not the model", async () => {
  calls.length = 0;
  const r = await runTool(BASE, "fact-check", {
    answer: "Revenue grew 42% in 2025 to ₹9.4 crore, making it the largest district in Rajasthan.",
  });
  if (r.status !== 200) throw new Error(`fact-check failed: ${JSON.stringify(r.json)}`);
  if (calls.length !== 0) throw new Error("fact-check spent a model call; it grades claims against sources");
  if (!/nothing to check|hallucination check|corroborated|unconfirmed|search/i.test(r.text)) {
    throw new Error(`no verdict text came back: ${r.text.slice(0, 120)}`);
  }
});

/* ── 6 · the pages exist as HTML, not as a JS promise ───── */

await run("tool pages render server-side", async () => {
  const html = await (await fetch(`${BASE}/tools/blog-post`)).text();
  if (!/Blog Post Writer/.test(html)) throw new Error("tool page HTML has no title — client-only render");
  if (!/Output contract|Honest limits|checks before/.test(html)) throw new Error("no contract section in the HTML");
  if (/buildSystem/.test(html)) throw new Error("server prompt builders leaked into the page source");
  const idx = await (await fetch(`${BASE}/tools`)).text();
  const links = (idx.match(/href="\/tools\//g) || []).length;
  if (links < 25) throw new Error(`/tools links only ${links} tools`);
  const studio = await fetch(`${BASE}/studios/founder`);
  if (!studio.ok) throw new Error(`/studios/founder → ${studio.status}`);
});

/* ── 7 · per-tool rate limiting (last: it exhausts a shared window on purpose) ── */

await run("the same tool can't be hammered — per-tool window caps it", async () => {
  let blocked = 0;
  const starts = [];
  for (let i = 0; i < 24; i++) {
    starts.push(
      runTool(BASE, "tweet-writer", { idea: `idea number ${i} about shipping faster with fewer tools` }).then(
        (r) => {
          if (r.status === 429) blocked++;
        }
      )
    );
  }
  await Promise.all(starts);
  if (blocked === 0) throw new Error("24 parallel runs of one tool, none rate limited");
});


/* ── W3.a: which model answered, and which ones this deployment can call ── */

const ROOT = path.resolve(import.meta.dirname, "..");
const srcFile = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/**
 * `lib/ai/models-catalog.ts` imports nothing, so it compiles standalone — the trick
 * tests/artifacts.mjs uses for the store. Naming a model is a pure lookup, and a pure lookup is
 * worth driving directly rather than inferring from what a page happens to render.
 */
const labelDir = path.join(ROOT, "node_modules", ".cache", "bw-model-labels");
fs.mkdirSync(labelDir, { recursive: true });
try {
  execFileSync(
    "npx",
    [
      "tsc",
      path.join(ROOT, "lib", "ai", "models-catalog.ts"),
      "--outDir", labelDir,
      "--target", "es2022",
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--strict",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
} catch (e) {
  console.error("could not compile lib/ai/models-catalog.ts\n", e.stdout?.toString(), e.stderr?.toString());
  process.exit(1);
}
const CAT = createRequire(path.join(ROOT, "noop.cjs"))(path.join(labelDir, "models-catalog.js"));

await run("a model's label comes from its catalog row, never from its id's substrings", () => {
  assert.ok(CAT && typeof CAT.publicModelLabel === "function", "the compiled module exports the lookup");
  // The bug (audit A9): a *chat* model configured as an id containing "vision" announced itself as
  // the image product. Capability decides now, and an unknown id says only what is true.
  const anyChatId = CAT.MODEL_CATALOG.find((m) => m.capability === "chat").id;
  assert.equal(CAT.publicModelLabel(anyChatId, "chat"), "BUILDWE AI", "a chat row is the chat brand");
  assert.equal(CAT.publicModelLabel("gpt-4o-vision-preview", "chat"), "BUILDWE AI", "a substring in an unknown id is not a capability");
  assert.equal(CAT.publicModelLabel("anything-with-code-in-it", "chat"), "BUILDWE AI", "and neither is 'code'");
  assert.equal(CAT.publicModelLabel(undefined, "code"), "BUILDWE Code", "no id at all still means the mode that ran");
  assert.equal(CAT.publicModelLabel("fal-ai/flux/schnell"), "BUILDWE Vision", "with no mode, the row still answers");
  assert.equal(CAT.modelDetailLabel("fal-ai/flux/schnell"), "FLUX Schnell", "and the detail name comes from the same row");
  assert.equal(CAT.publicModelLabel("totally-unknown-audio"), "BUILDWE AI", "unknown with no mode falls back to chat, not to a guess");

  // The same id registered under two capabilities must answer with the row for *this* run, or a
  // code run is branded as chat by whichever match comes first.
  // Discover a dual-capability id rather than pinning one: a retired model used
  // to break this check even though the behaviour it tests was still correct.
  const chatIds = new Set(
    CAT.MODEL_CATALOG.filter((m) => m.capability === "chat").map((m) => m.id)
  );
  const dualId = CAT.MODEL_CATALOG.find(
    (m) => m.capability === "code" && chatIds.has(m.id)
  )?.id;
  assert.ok(dualId, "the catalog should have at least one id serving chat and code");
  assert.equal(CAT.publicModelLabel(dualId, "code"), "BUILDWE Code", "the hint picks the right row");

  // The lanes and the developer API get the real name; an unknown id degrades to the brand instead
  // of inventing a vendor.
  const namedRow = CAT.MODEL_CATALOG.find((m) => m.capability === "chat");
  assert.equal(CAT.modelDetailLabel(namedRow.id, "chat"), namedRow.label, "a known id names itself");
  assert.equal(CAT.modelDetailLabel("gpt-4o-vision-preview", "chat"), "BUILDWE AI", "an unknown one says who answered, not what it might be");
});

await run("the catalog and the seats it feeds are consistent", () => {
  const rows = CAT.MODEL_CATALOG;
  const seen = new Set();
  for (const m of rows) {
    const key = `${m.capability}:${m.id}`;
    assert.ok(!seen.has(key), `${key} is listed twice under one capability, so a lookup cannot know which was meant`);
    seen.add(key);
    assert.ok(m.label, `row ${m.id} has no public label`);
  }
  // Every capability the catalog routes is either offered by the picker or declared internal — a
  // third option would be rows nobody can ever reach.
  const route = srcFile("app/api/ai/models/route.ts");
  const published = (route.match(/const CAPS = \[([^\]]+)\]/) || ["", ""])[1];
  const internal = (route.match(/const INTERNAL_CAPS = \[([^\]]+)\]/) || ["", ""])[1];
  assert.ok(internal.includes('"router"'), "the router row stays internal on purpose");
  for (const cap of new Set(rows.map((m) => m.capability))) {
    assert.ok(
      published.includes(`"${cap}"`) || internal.includes(`"${cap}"`),
      `the catalog routes ${cap}, and /api/ai/models neither publishes it nor declares it internal`
    );
  }
  // And every default compare seat has to be a catalog row, or that lane prints a brand where a
  // name belongs — the exact failure this step removed. W3.1 moved the list out of the route into
  // `lib/ai/compare-seats.ts`, so the check reads the owner, not the caller.
  const seatsFile = srcFile("lib/ai/compare-seats.ts");
  const seats = ((seatsFile.match(/export const DEFAULT_SEAT_IDS = \[([\s\S]*?)\];/) || ["", ""])[1]
    .match(/"[^"]+"/g) || []).map((x) => x.replace(/"/g, ""));
  assert.ok(seats.length >= 2, `parsed ${seats.length} default seats out of lib/ai/compare-seats.ts`);
  for (const id of seats) {
    assert.ok(
      CAT.MODEL_CATALOG.some((m) => m.id === id && m.capability === "chat"),
      `the compare seat ${id} is not a chat row in the catalog, so it cannot name itself`
    );
  }
  // (The file's comment still *names* gemma2-9b-it, which is why this reads the parsed list rather
  // than the text: the id must be gone from the seats, and the reason it went belongs in prose.)
  assert.equal(seats.includes("gemma2-9b-it"), false, "a retired Groq model must not come back as a default seat");
});

await run("GET /api/ai/models reports what THIS deployment can call", async () => {
  const live = await req(BASE, "/api/ai/models");
  assert.equal(live.status, 200);
  const j = live.json;
  assert.ok(j.selectable && Array.isArray(j.selectable.chat) && j.selectable.chat.length, "chat rows are published");
  assert.equal(j.llmLive, true, "this server has a chat provider key, and says so");
  const chat = j.selectable.chat[0];
  for (const field of ["id", "label", "brand", "provider", "quality", "latency", "strengths", "available"]) {
    assert.ok(field in chat, `a selectable row lost ${field}`);
  }
  // `available` is per provider, not a global flag: this server was given a Groq key and nothing
  // else, so exactly the Groq rows are callable and every other vendor says why it is not.
  assert.ok(
    j.selectable.chat.every((m) => (m.provider === "groq" || m.provider === "pollinations") === m.available),
    "a row is callable iff its provider has a key here"
  );
  assert.ok(j.selectable.chat.some((m) => m.provider === "openai" && !m.available), "another vendor's row is present and honest about not working");
  assert.ok(j.selectable.image.some((m) => m.available), "pollinations images are keyless, so they are always callable");
  assert.ok(
    j.ready.chat && j.ready.chat.ready === j.selectable.chat.filter((m) => m.available).length,
    "the per-capability count is derived from the rows, not a second list"
  );
  assert.equal(j.catalogSize, CAT.MODEL_CATALOG.length, "the size the route quotes is the catalog the gateway routes from");
  assert.ok(j.all.some((m) => m.status === "coming_soon"), "the marketing ladder still carries its reserved seats");
  assert.equal(JSON.stringify(j.selectable).includes("coming_soon"), false, "and none of them leaked into the callable list");
  const blob = JSON.stringify(j);
  for (const leak of ["GROQ_API_KEY", "OPENAI_API_KEY", "envKey", "api.openai.com", "api.groq.com", "AI_KEYS", "sk-", "gsk_"]) {
    assert.equal(blob.includes(leak), false, `/api/ai/models leaked ${leak}`);
  }
  assert.ok(Array.isArray(j.internal) && j.internal.includes("agent"), "agent is an alias, not a picker section");
  assert.ok(
    j.selectable.audio.some((m) => m.provider === "pollinations" && m.available && m.keyless),
    "keyless voice is callable without a key"
  );
  assert.ok(
    j.selectable.audio.some((m) => m.provider === "cartesia" && !m.available),
    "an unimplemented vendor stays unavailable even as a catalog row"
  );

  const dry = await req(OFF, "/api/ai/models");
  assert.equal(dry.json.llmLive, false, "a keyless deployment admits it");
  assert.ok(dry.json.selectable.chat.length > 0, "it still publishes the rows it has");
  assert.ok(dry.json.selectable.chat.every((m) => !m.available && /key/.test(m.whyNot || "")), "each says it needs a key, instead of failing on click");
  assert.equal(dry.json.ready.chat.ready, 0, "and the count says none");
  assert.ok(dry.json.selectable.image.some((m) => m.available), "even with no keys at all, the keyless image provider is honest about working");
});

await run("the Models sheet reads that route and never invents a row", () => {
  const page = srcFile("app/page.tsx");
  assert.equal(page.includes("GPT-class seat"), false, "the hardcoded fake model is gone");
  assert.equal(page.includes("setModelsCatalog(m.all"), false, "the sheet no longer renders the marketing ladder");
  assert.ok(page.includes("modelsInfo.selectable"), "it renders the deployment's own rows");
  assert.ok(page.includes("data-models-error") && page.includes("loadModels()"), "a failed read says so, with a retry that refetches");
  assert.ok(page.includes("Connect an API key") && page.includes('setModal("byok")'), "and the fix it offers is a route that exists");
  const caps = ((srcFile("app/api/ai/models/route.ts").match(/const CAPS = \[([^\]]+)\]/) || ["", ""])[1]
    .match(/"[a-z]+"/g) || []).map((x) => x.replace(/"/g, ""));
  assert.ok(caps.length >= 6, `parsed ${caps.length} capabilities out of the route`);
  const captions = (page.match(/const MODEL_CAPTION: Record<string, string> = \{([\s\S]*?)\n\};/) || ["", ""])[1];
  for (const cap of caps) {
    assert.ok(captions.includes(`${cap}:`), `the sheet has no caption for ${cap}, so its header would print the raw key`);
  }
  const api = srcFile("lib/client/api.ts");
  const at = api.indexOf("export async function fetchModels(");
  const fn = api.slice(at, api.indexOf("\n}", at));
  assert.ok(fn.includes("failWith"), "the client throws on a bad read instead of handing back an empty list");
  assert.ok(fn.includes('cache: "no-store"'), "and never serves a stale view of which keys are set");
});


/* ── W3.1: the caller picks the lanes, and sees the price first ─────── */

const CHAT_IDS = CAT.MODEL_CATALOG.filter((m) => m.capability === "chat").map((m) => m.id);
/**
 * Lane fixtures below used to hardcode vendor ids. When Groq retired
 * llama-3.1-8b-instant and llama-3.3-70b-versatile these checks failed on a
 * 400 LANE_NOT_IN_CATALOG — the app was right and the fixture was stale. Pull
 * real ids from the catalog instead.
 */
const FREE_CHAT_IDS = CAT.MODEL_CATALOG.filter(
  (m) => m.capability === "chat" && m.tiers.includes("free")
).map((m) => m.id);
const [LANE_A, LANE_B, LANE_C] = FREE_CHAT_IDS;

await run("GET /api/ai/compare states the range, the price and the defaults before anything runs", async () => {
  const res = await fetch(`${BASE}/api/ai/compare`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") || "", /no-store/, "the default lanes depend on whose keys are connected");
  const j = await res.json();
  assert.equal(j.minLanes, 2, "one answer is not a comparison");
  assert.equal(j.maxLanes, 6, "and six is where the run stops being about the answers");
  assert.ok(Number.isInteger(j.perLane) && j.perLane > 0, `per-lane price: ${j.perLane}`);
  assert.ok(j.defaults.length >= j.minLanes && j.defaults.length <= j.maxLanes, `defaults: ${j.defaults.length}`);
  for (const d of j.defaults) {
    assert.ok(CHAT_IDS.includes(d.id), `the default lane ${d.id} is not a catalog chat row`);
    assert.equal(d.model, CAT.modelDetailLabel(d.id, "chat"), "a default lane says which model it is");
    assert.match(d.label, /^Model [A-F]$/, `lane label: ${d.label}`);
  }
  assert.equal(new Set(j.defaults.map((d) => d.id)).size, j.defaults.length, "a lane asked twice tells you nothing new");
  // An operator knob that asks for more default lanes than the built-in list has gets them,
  // padded from the catalog — `COMPARE_SEAT_COUNT=5` used to be silently truncated to three.
  const dry = await req(OFF, "/api/ai/compare");
  assert.equal(dry.json.defaults.length, 5, `COMPARE_SEAT_COUNT=5 produced ${dry.json.defaults.length} default lanes`);
  assert.equal(new Set(dry.json.defaults.map((d) => d.id)).size, 5, "padded lanes have to be distinct models");
  assert.ok(dry.json.defaults.every((d) => CHAT_IDS.includes(d.id)), "every padded lane is a catalog chat row");
  // The row list itself stays with /api/ai/models — one projection, two readers.
  const models = await fetch(`${BASE}/api/ai/models`);
  assert.match(models.headers.get("cache-control") || "", /no-store/, "readability of a key must not be cached across readers");
  const mj = await models.json();
  assert.equal(j.defaults.every((d) => mj.selectable.chat.some((m) => m.id === d.id)), true, "the defaults are rows the picker lists");
});

await run("a bad lane list is refused with what to send instead", async () => {
  // Eight POSTs at most against OFF's 10/min compare bucket — the bucket is the reason these
  // checks live on the keyless server, where a refusal costs nothing anyway.
  const cases = [
    [["definitely-not-a-model"], "LANE_NOT_IN_CATALOG"],
    [[LANE_A, "fal-ai/flux/schnell"], "LANE_NOT_A_CHAT_MODEL"],
    [[LANE_A], "TOO_FEW_LANES"],
    // Two identical ids are one lane, and a comparison of one has to say so rather than run.
    [[LANE_A, LANE_A], "TOO_FEW_LANES"],
    [CHAT_IDS.slice(0, 7), "TOO_MANY_LANES"],
  ];
  for (const [models, code] of cases) {
    const r = await req(OFF, "/api/ai/compare", {
      method: "POST",
      body: { prompt: "Which model should answer this, and why?", models },
    });
    assert.equal(r.status, 400, `${code}: got ${r.status} ${r.text.slice(0, 160)}`);
    assert.equal(r.json.code, code, `refused for the wrong reason: ${JSON.stringify(r.json)}`);
    assert.ok(String(r.json.hint || "").length > 20, `${code} arrives without a hint a human can act on`);
  }
  const shape = await req(OFF, "/api/ai/compare", { method: "POST", body: { prompt: "x?", models: 42 } });
  assert.equal(shape.json.code, "BAD_LANE_LIST", "`models` has to be a list");
  // …and the comma form a curl user reaches for is accepted, not rejected as a type error.
  const csv = await req(OFF, "/api/ai/compare", {
    method: "POST",
    body: { prompt: "Ship the billing page in place or rebuild it?", models: `${LANE_A},${LANE_B}` },
  });
  assert.equal(csv.status, 200, `comma list: ${csv.status} ${csv.text.slice(0, 160)}`);
  assert.equal(csv.json.lanes.length, 2, "both lanes were asked");
  assert.equal(csv.json.available, false, "on a keyless deployment neither of them answers");
  assert.ok(csv.json.lanes.every((l) => !l.live && /key/.test(l.note || "")), "and each says what is missing");
  assert.equal(csv.json.credits.charged, 0, "a run where nothing answered costs nothing");
  assert.equal(csv.json.credits.refunded, csv.json.credits.held, "the whole hold came back");
});

await run("the picked lanes are what the vendor is actually asked for, per lane and to the credit", async () => {
  const before = await req(BASE, "/api/credits", { jar });
  const asked0 = calls.length;
  const models = [LANE_A, LANE_B];
  const r = await req(BASE, "/api/ai/compare", {
    method: "POST",
    jar,
    body: { prompt: "Should a five-person team rewrite its billing page in place or start fresh?", models },
  });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(r.json.available, true, "both seats are on the provider this server can reach");
  assert.deepEqual(r.json.lanes.map((l) => l.label), ["Model A", "Model B"], "lanes are named in order");
  assert.deepEqual(
    r.json.lanes.map((l) => l.model),
    models.map((id) => CAT.modelDetailLabel(id, "chat")),
    "each lane is named by its own catalog row, not by the brand every lane shares"
  );
  assert.ok(r.json.lanes.every((l) => l.live && l.reply.length > 40), "and both answered");
  const asked = calls.slice(asked0).map((c) => c.model);
  for (const id of models) {
    assert.ok(asked.includes(id), `the vendor was asked for ${asked.join(", ")} — ${id} never left the building`);
  }
  const per = r.json.credits.perLane;
  assert.equal(r.json.credits.held, per * 2, "held for both lanes before either ran");
  assert.equal(r.json.credits.refunded, 0, "nothing to give back when both answered");
  assert.equal(r.json.credits.charged, per * 2);
  assert.deepEqual(r.json.credits.lanes, { total: 2, live: 2, dead: 0 }, "the run reports which lanes it asked for");
  const after = await req(BASE, "/api/credits", { jar });
  assert.equal(before.json.balance - after.json.balance, r.json.credits.charged, "the wallet moved by exactly the live lanes");
  assert.equal(after.json.balance, r.json.credits.balance, "and the receipt the UI got is the balance it now has");
  assert.ok(String(r.json.synthesis || "").length > 40, "the combined answer came back too");
});

await run("a lane whose vendor has no key is refused by the picker, refunded by the run", async () => {
  const r = await req(BASE, "/api/ai/compare", {
    method: "POST",
    jar,
    body: { prompt: "Which caching layer should we pick for a small Postgres app?", models: [LANE_A, "gpt-4o-mini"] },
  });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.lanes.length, 2);
  const dead = r.json.lanes.find((l) => l.id === "gpt-4o-mini");
  assert.equal(dead.live, false, "this deployment has no OpenAI key, and the lane admits it");
  assert.match(dead.note || "", /openai key/, `the dead lane explains itself: ${dead.note}`);
  assert.equal(dead.reply, "", "and does not fill in with an invented answer");
  assert.equal(r.json.credits.lanes.dead, 1);
  assert.equal(r.json.credits.refunded, r.json.credits.perLane, "the dead lane is given back");
  assert.equal(r.json.credits.charged, r.json.credits.perLane, "only the lane that answered is kept");
});

await run("the padded default set is what actually runs, and costs nothing when all five are dark", async () => {
  const r = await req(OFF, "/api/ai/compare", { method: "POST", body: { prompt: "Summarise the tradeoff between a queue and a worker pool for a two-person team." } });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.lanes.length, 5, "five lanes were asked, because five were promised");
  assert.equal(r.json.available, false, "none of them could answer here");
  assert.equal(r.json.credits.held, r.json.credits.perLane * 5, "and all five were held for");
  assert.equal(r.json.credits.refunded, r.json.credits.perLane * 5, "all five came back");
  assert.equal(r.json.credits.charged, 0, "which is what makes an offline deployment safe to run against");
  assert.ok(r.json.lanes.every((l) => /key/.test(l.note || "")), "each dark lane says which key is missing");
});

await run("a BYOK account's own key makes its lanes callable — the picker is not stuck on the deployment's", async () => {
  // A second account, its own jar: the suite's shared user must stay clean for the checks above.
  const jar2 = newJar();
  const reg = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar: jar2,
    body: { email: `byok-lanes-${Date.now()}@buildwe.test`, password: "lane-test-password", name: "Lane tester" },
  });
  assert.ok(reg.status === 200 || reg.status === 201, `register: ${reg.status}`);
  const dry = await req(BASE, "/api/ai/models", { jar: jar2 });
  const row = dry.json.selectable.chat.find((m) => m.id === "deepseek/deepseek-chat");
  assert.equal(row.available, false, "with no key of their own, an OpenRouter row is not callable");
  assert.match(row.whyNot || "", /Settings|deployment/, `and says where to fix it: ${row.whyNot}`);

  // A well-formed key is what the shape check accepts; availability only asks whether one exists.
  const saved = await req(BASE, "/api/user/keys", {
    method: "POST",
    jar: jar2,
    body: { openrouter: `sk-or-v1-${"a".repeat(40)}` },
  });
  assert.equal(saved.status, 200, `byok save: ${saved.status} ${saved.text.slice(0, 160)}`);
  const wet = await req(BASE, "/api/ai/models", { jar: jar2 });
  const after = wet.json.selectable.chat.find((m) => m.id === "deepseek/deepseek-chat");
  assert.equal(after.available, true, "the same row became callable the moment their key was saved");
  assert.equal(after.whyNot, undefined, "and stopped telling them to do the thing they just did");
  assert.equal(wet.json.byokActive, true, "the route says whose key is powering the answer");
});

await run("the sheet picks from those lists and prices the run from the server's number", () => {
  const route = srcFile("app/api/ai/compare/route.ts");
  assert.equal(route.includes("DEFAULT_SEATS"), false, "the route no longer owns a seat list");
  assert.equal(route.includes(".slice(0, 4)"), false, "the cap that silently dropped a fifth pick is gone");
  assert.ok(route.includes("resolveLanes"), "what it will run is decided by the module that prices it");
  assert.ok(route.includes("userKeys"), "a BYOK account's comparison runs on their own key, not on nothing");
  const picker = srcFile("components/workspace/CompareLanes.tsx");
  assert.equal(picker.includes("MODEL_CATALOG"), false, "the picker is handed its rows; it does not read the catalog itself");
  assert.ok(picker.includes('role="checkbox"') && picker.includes("aria-checked"), "a lane is a checkbox, not a div with an onClick");
  assert.ok(picker.includes("data-lane-off"), "a lane without a key stays visible, disabled, with its reason");
  const page = srcFile("app/page.tsx");
  assert.ok(page.includes("<CompareLanes") && page.includes("selectable?.chat"), "the sheet lists /api/ai/models' chat rows");
  assert.ok(page.includes("data-compare-cost"), "the price of this exact run is on screen before the click");
  assert.ok(page.includes("fetchCompareContract"), "and it is read from the server, not copied into the client");
  const bar = srcFile("components/workspace/PromptBar.tsx");
  assert.equal(bar.includes("ask 3 AIs"), false, "the composer must not promise a fixed three any more");
  // The ⌘K palette opens this sheet by setting `modal` and nothing else, so the contract read has
  // to hang off `modal` — an effect only the composer button called leaves the other way in
  // staring at a spinner.
  assert.ok(
    page.includes('if (modal === "compare") void loadLanes()'),
    "the lane contract is read on every open of the sheet, whichever control opened it"
  );
  // BYOK changes which rows are callable, so saving a key has to refetch them — otherwise the row
  // the user just earned still says "no key here" until they reload the tab.
  const at = page.indexOf("const doSaveByok");
  assert.ok(page.slice(at, at + 1500).includes("loadModels()"), "saving a key refreshes the lists that depend on it");
});


/* ── W3.2: fold the answers you liked into a new combined one ─────── */

await run("POST action:mix folds exactly what you send, asks no model again, and costs one lane", async () => {
  const A = LANE_A;
  const B = LANE_B;
  const C = LANE_C;
  const long = "Z".repeat(5000);
  const before = calls.length;
  const r = await req(BASE, "/api/ai/compare", {
    method: "POST",
    jar,
    body: {
      action: "mix",
      prompt: "Ship the pricing page rewrite or measure first?",
      lanes: [
        { id: A, reply: "SHIP IT — revenue grew 42% while churn held flat." },
        { id: B, reply: `MEASURE FIRST — here is the number to wait for. ${long}` },
      ],
    },
  });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(r.json.available, true, "the judge pass ran on this deployment");
  const fresh = calls.slice(before);
  assert.equal(fresh.length, 1, `a re-mix is one judge pass; the fixture saw ${fresh.length} calls`);
  assert.ok(
    fresh.every((c) => /comparison synthesizer/i.test(c.system)),
    "only the synthesiser was called — no lane was asked again"
  );
  assert.ok(fresh[0].user.includes("SHIP IT"), "the first answer went in");
  assert.ok(fresh[0].user.includes("MEASURE FIRST"), "and so did the second");
  assert.ok(
    fresh[0].user.includes(CAT.modelDetailLabel(A, "chat")) &&
      fresh[0].user.includes(CAT.modelDetailLabel(B, "chat")),
    "the judge is told which model each answer came from"
  );
  assert.ok(!fresh[0].user.includes(C), `the lane that was not checked leaked into the mix: ${C}`);
  assert.equal(r.json.credits.held, r.json.credits.perLane, "held for one unit of work");
  assert.equal(r.json.credits.charged, r.json.credits.perLane, "kept it, because the pass answered");
  assert.equal(r.json.credits.refunded, 0);
  assert.equal(r.json.used.length, 2, "and the response names what was folded");
  const trimmed = r.json.used.find((u) => u.id === B);
  assert.equal(trimmed.chars, 2400, "a long answer is clamped to the length the run itself publishes");
  assert.equal(trimmed.trimmed, true, "and says so, rather than silently cutting");
  assert.ok(fresh[0].user.length < 5000, "the clamp is enforced in the text sent, not only reported");
});

await run("a mix is refused, with a reason, when it is not a mix", async () => {
  const A = LANE_A;
  const B = LANE_B;
  const cases = [
    [{ lanes: { id: A, reply: "x" } }, "BAD_MIX_LIST"],
    [{ lanes: [{ id: "mistral", reply: "x" }, { id: A, reply: "y" }] }, "LANE_NOT_IN_CATALOG"],
    [{ lanes: [{ id: A, reply: "only one" }] }, "TOO_FEW_LANES"],
    [{ lanes: [{ id: A, reply: "one side only" }, { id: B, reply: "   " }] }, "MIX_ANSWER_MISSING"],
  ];
  for (const [extra, code] of cases) {
    const r = await req(OFF, "/api/ai/compare", {
      method: "POST",
      body: { action: "mix", prompt: "Which of these two readings is better supported?", ...extra },
    });
    assert.equal(r.status, 400, `${code}: got ${r.status} ${r.text.slice(0, 160)}`);
    assert.equal(r.json.code, code, `refused for the wrong reason: ${JSON.stringify(r.json)}`);
    assert.ok(String(r.json.hint || "").length > 20, `${code} arrives without a hint`);
  }
  const action = await req(OFF, "/api/ai/compare", { method: "POST", body: { action: "blend", prompt: "x?" } });
  assert.equal(action.json.code, "BAD_ACTION", "an unknown action is named, not run as the default");
});

await run("a mix whose judge cannot answer costs nothing and says which lanes it had", async () => {
  const r = await req(OFF, "/api/ai/compare", {
    method: "POST",
    body: {
      action: "mix",
      prompt: "Two sources disagree about the same quarter — which do I trust?",
      lanes: [
        { id: LANE_A, reply: "The filing says revenue rose." },
        { id: LANE_B, reply: "The interview says orders rose." },
      ],
    },
  });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.available, false, "no provider, no combined answer");
  assert.equal(r.json.synthesis, "", "and nothing is invented to fill the card");
  assert.match(r.json.message, /nothing was charged/i, "the copy says so in the same breath");
  assert.equal(r.json.credits.charged, 0, "the held credit came back");
  assert.equal(r.json.credits.refunded, r.json.credits.held);
  assert.deepEqual(r.json.used.map((u) => u.id), [LANE_A, LANE_B], "the lanes it did have are still named");
  assert.equal("live" in r.json.used[0], false, "a folded answer must not claim a provider answered");
});

await run("the results are an input: every lane stays on screen, and the mix is priced by the server", () => {
  const results = srcFile("components/workspace/CompareResults.tsx");
  assert.ok(/\{lanes\.map\(\(l\) => \{/.test(results), "the cards map over every lane, not over the ones in the mix");
  assert.ok(results.includes("data-mix-toggle"), "each answer can be put into or taken out of the combined one");
  assert.ok(results.includes('role="checkbox"') && results.includes("aria-checked"), "and that control is a checkbox, announced as one");
  assert.ok(results.includes("{mixCost} credit"), "the re-mix button quotes the server's own price");
  assert.ok(results.includes("view + 1}/"), "combined answers are steppable, so a fold never destroys the last one");
  assert.ok(results.includes("data-compare-offline"), "the nothing-answered case is this screen's too, not a second one");
  assert.equal(results.includes("fetch("), false, "it renders state; it does not go and ask for more");

  const page = srcFile("app/page.tsx");
  assert.ok(page.includes("r.combinedFrom"), "the strip starts from what the run actually folded, not a guess");
  assert.equal(page.includes("Best combined answer"), false, "the result markup lives in one place now");
  assert.ok(page.includes("compareMixApi"), "and the page is the one that calls it");
  const api = srcFile("lib/client/api.ts");
  const at = api.indexOf("export async function compareMixApi(");
  assert.ok(at > 0, "the client has one way to ask for a mix");
  const fn = api.slice(at, api.indexOf("\n}", at));
  assert.ok(fn.includes("noteCredits(r, j)"), "a charged re-mix moves the wallet chip like any other paid call");
  const pricing = srcFile("app/pricing/page.tsx");
  assert.ok(
    /\["Combining a chosen few of them again", wallet\.costs\.compareLane\]/.test(pricing),
    "the price table quotes the same per-lane number rather than inventing a second one"
  );
  const ledger = srcFile("components/billing/CreditsUI.tsx");
  assert.ok(ledger.includes('"compare-mix"'), "a re-mix shows up in the ledger under a real name");
});

fs.rmSync(labelDir, { recursive: true, force: true });

/* ── teardown ────────────────────────────────────────────── */

const failures = report("Wave 1 · tool runner");
await trusted.stop();
await offline.stop();
fixture.close();
process.exit(failures ? 1 : 0);
