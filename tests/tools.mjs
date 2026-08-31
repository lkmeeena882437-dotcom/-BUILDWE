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

import http from "node:http";
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
  },
});
const offline = await startServer({
  port: PORT_OFFLINE,
  label: "tools-nomodel",
  env: { GROQ_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", NEXT_PUBLIC_DEMO_MODE: "false" },
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


/* ── teardown ────────────────────────────────────────────── */

const failures = report("Wave 1 · tool runner");
await trusted.stop();
await offline.stop();
fixture.close();
process.exit(failures ? 1 : 0);
