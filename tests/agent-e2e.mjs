#!/usr/bin/env node
/**
 * UPDATE 16 — coding agent, end to end.
 *
 * A real BUILDWE server against a scripted model fixture, so the plan → act →
 * check → finish loop runs offline and deterministically:
 *
 *   agent UI → /api/ai/agent → catalog → adapter chain → tool calls → SSE → UI
 *
 * `tests/agent.mjs` already covers tool-call *parsing* at the unit level. This
 * suite covers the parts only a running server can show: which model the chain
 * actually picks, what happens when it dies, whether tool results reach the
 * client, and whether a run that built nothing is still billed.
 *
 * Run: npm run test:agent-e2e
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { newJar, report, req, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PORT = 3440;
const FIXTURE_PORT = 3441;

const PAGE = "<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>";

/**
 * The fixture plays the model. `script` is a queue of replies; each request
 * pops the next one, so a whole agent run can be choreographed exactly.
 */
let script = [];
let mode = "ok";
let seen = [];
let modelsAsked = [];

const fixture = http.createServer((rq, res) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    modelsAsked.push(body.model);
    seen.push(body);

    if (mode === "down") {
      res.writeHead(503, { "Content-Type": "text/plain" });
      return res.end("model down");
    }
    if (mode === "prose") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ choices: [{ message: { content: "Sure, I can help with that!" } }] })
      );
    }
    const next = script.length ? script.shift() : JSON.stringify({ tool: "finish", summary: "done" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: next } }] }));
  });
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));

/** A full, successful build: write a page, verify it, finish. */
function buildScript() {
  return [
    JSON.stringify({ tool: "list_files" }),
    JSON.stringify({ tool: "write_file", path: "index.html", content: PAGE, lang: "html" }),
    JSON.stringify({ tool: "run_check", path: "index.html" }),
    JSON.stringify({ tool: "finish", summary: "Built a landing page." }),
  ];
}

let srv = null;
srv = await startServer({
  port: PORT,
  label: "bw-agent",
  env: {
    GROQ_API_KEY: "bw-fixture-key",
    AI_BASE_URL_GROQ: `http://127.0.0.1:${FIXTURE_PORT}/v1/chat/completions`,
    CREDITS_WELCOME: "500",
    SIGNUPS_PER_IP_PER_HOUR: "1000",
    SIGNUPS_PER_EMAIL_PER_DAY: "1000",
    SIGNUPS_GLOBAL_PER_DAY: "1000",
  },
});
const BASE = srv.base;

async function signUp(tag) {
  const jar = newJar();
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar,
    body: {
      email: `agent-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "Str0ng-Passw0rd!x",
      name: `Agent ${tag}`,
    },
  });
  assert.equal(r.status, 200, `register failed: ${r.text?.slice(0, 200)}`);
  return jar;
}

/** Run the agent and collect every SSE event it emitted. */
async function runAgent(jar, body) {
  const res = await fetch(`${BASE}/api/ai/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jar?.header() ? { cookie: jar.header() } : {}),
    },
    body: JSON.stringify(body),
  });
  jar?.absorb(res);
  const raw = await res.text();
  const events = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(t.slice(5).trim()));
    } catch {
      /* partial */
    }
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    events,
    raw,
    of: (type) => events.filter((e) => e.type === type),
    result: events.find((e) => e.type === "result"),
  };
}

const balance = async (jar) => (await req(BASE, "/api/credits", { jar })).json?.balance;

/* ── 1. A successful run ─────────────────────────────────── */

await run("a goal drives a full plan → write → check → finish run", async () => {
  mode = "ok";
  script = buildScript();
  const jar = await signUp("happy");
  const r = await runAgent(jar, { goal: "build a landing page" });
  assert.equal(r.status, 200, `expected 200, got ${r.status}`);
  assert.match(r.contentType, /text\/event-stream/, "the agent must stream progress");
  assert.ok(r.result, "a result event closes the run");
  assert.equal(r.result.ok, true, `run failed: ${JSON.stringify(r.result).slice(0, 200)}`);
  assert.deepEqual(r.result.filesChanged, ["index.html"], "the file it wrote is reported");
  assert.equal(r.result.verified, true, "checks passed, so the run is verified");
});

await run("the file the agent wrote really exists in the project", async () => {
  mode = "ok";
  script = buildScript();
  const jar = await signUp("persist");
  const r = await runAgent(jar, { goal: "build a page" });
  const projectId = r.events.find((e) => e.type === "meta")?.projectId;
  assert.ok(projectId, "the client is told which project it landed in");

  const files = await req(BASE, `/api/projects/files?projectId=${encodeURIComponent(projectId)}`, { jar });
  assert.equal(files.status, 200);
  const rows = files.json.files || files.json.items || [];
  const hit = rows.find((f) => f.path === "index.html");
  assert.ok(hit, "the agent's file must be a real project file, not just an event");
});

/* ── 2. Streaming + tool status ──────────────────────────── */

await run("tool calls and their results are streamed to the UI", async () => {
  mode = "ok";
  script = buildScript();
  const jar = await signUp("tools");
  const r = await runAgent(jar, { goal: "build a page" });

  const tools = r.of("tool");
  assert.ok(tools.length >= 3, `expected list/write/check events, saw ${tools.length}`);
  const names = tools.map((t) => t.tool);
  assert.ok(names.includes("list_files"), "list_files status reaches the UI");
  assert.ok(names.includes("write_file"), "write_file status reaches the UI");
  for (const t of tools) {
    assert.equal(typeof t.ok, "boolean", "each tool event says whether it worked");
    assert.ok(t.detail, "each tool event carries a human detail line");
  }

  const checks = r.of("check");
  assert.ok(checks.length >= 1, "verification results are streamed");
  assert.equal(checks[0].ok, true, "the written page passes static checks");

  assert.ok(r.of("step").length >= 3, "step progress is streamed as it happens");
  assert.ok(r.of("done").length === 1, "exactly one done event");
});

await run("events arrive in a sane order — meta first, result last", async () => {
  mode = "ok";
  script = buildScript();
  const jar = await signUp("order");
  const r = await runAgent(jar, { goal: "build a page" });
  assert.equal(r.events[0].type, "meta", "the project id comes before any work");
  assert.equal(r.events.at(-1).type, "result", "the receipt closes the stream");
});

/* ── 3. Catalog + adapter selection ──────────────────────── */

await run("the agent asks only for reachable, plan-allowed catalog models", async () => {
  mode = "ok";
  script = buildScript();
  modelsAsked = [];
  const jar = await signUp("catalog");
  await runAgent(jar, { goal: "build a page" });

  assert.ok(modelsAsked.length, "the agent called a model");
  // Only groq is keyed on this deployment, and the caller is free tier.
  const FREE_GROQ_CODE = [
    "qwen-2.5-coder-32b",
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];
  for (const m of modelsAsked) {
    assert.ok(
      FREE_GROQ_CODE.includes(m),
      `${m} is not a reachable free-tier code model — the chain left the catalog`
    );
  }
});

await run("the agent resolves its chain through the adapter, not its own list", () => {
  const agent = src("lib/ai/agent.ts");
  assert.ok(agent.includes('from "@/lib/ai/adapter"'), "the chain comes from the adapter");
  assert.ok(agent.includes("chainFor({"), "same policy as chat and code");
  assert.ok(agent.includes('capability: "code"'), "agent aliases the code catalog");
  assert.equal(
    /https:\/\/api\./.test(agent),
    false,
    "the agent must never hold a vendor endpoint of its own"
  );
});

/* ── 4. Fallback + failure ───────────────────────────────── */

await run("every model failing is a clean error, never a fake success", async () => {
  mode = "down";
  const jar = await signUp("alldown");
  const r = await runAgent(jar, { goal: "build something" });
  assert.equal(r.status, 200, "a vendor outage must not 500 the endpoint");
  assert.equal(r.result?.ok, false, "a run that built nothing must not claim success");
  assert.deepEqual(r.result.filesChanged, [], "and must not claim files it never wrote");
  assert.equal(r.result.verified, false, "nothing was verified");
  assert.ok(r.of("error").length >= 1, "the user is told the model stopped responding");
});

await run("a failed run is refunded, a successful one is charged", async () => {
  const jar = await signUp("credits");

  mode = "down";
  const before = await balance(jar);
  const failed = await runAgent(jar, { goal: "this will fail" });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.credits.charged, 0, "a failed run is not billed");
  assert.equal(await balance(jar), before, "and the hold is returned in full");

  mode = "ok";
  script = buildScript();
  const okRun = await runAgent(jar, { goal: "build a page" });
  assert.equal(okRun.result.ok, true);
  assert.ok(okRun.result.credits.charged > 0, "real work is charged");
  const after = await balance(jar);
  assert.equal(
    before - after,
    okRun.result.credits.charged,
    "the balance moved by exactly the amount on the receipt"
  );
});

await run("a model that drifts into prose does not write junk or claim success", async () => {
  mode = "prose";
  const jar = await signUp("prose");
  const r = await runAgent(jar, { goal: "build a page" });
  assert.equal(r.result.ok, false, "no tool call means no work was done");
  assert.deepEqual(r.result.filesChanged, [], "prose must never be saved as a file");
  assert.equal(r.result.credits.charged, 0, "and it is not billed");
});

await run("a dead model is benched so it stops leading every later step", () => {
  const agent = src("lib/ai/agent.ts");
  assert.ok(agent.includes("noteModelFailure(model)"), "failures are recorded");
  assert.ok(agent.includes("noteModelSuccess(model)"), "a working model clears its strikes");
  assert.ok(agent.includes("orderByHealth("), "benched models stop being tried first");
  assert.match(
    agent,
    /if \(Date\.now\(\) - startedAt > AGENT_LIMITS\.maxWallMs\) break;/,
    "the wall clock is checked between model attempts, not only per step"
  );
});

/* ── 5. Auth, ownership, isolation ───────────────────────── */

await run("another user's project is refused, not silently adopted", async () => {
  mode = "ok";
  script = buildScript();
  const alice = await signUp("own-alice");
  const bob = await signUp("own-bob");

  const made = await runAgent(alice, { goal: "build a page" });
  const projectId = made.events.find((e) => e.type === "meta")?.projectId;
  assert.ok(projectId);

  script = buildScript();
  const r = await runAgent(bob, { goal: "take over", projectId });
  assert.equal(r.status, 404, "an agent must not run inside someone else's project");
});

await run("one user's agent output never appears in another's project", async () => {
  mode = "ok";
  script = buildScript();
  const alice = await signUp("iso-alice");
  const aliceRun = await runAgent(alice, { goal: "build alice's page" });
  const aliceProject = aliceRun.events.find((e) => e.type === "meta")?.projectId;

  const bob = await signUp("iso-bob");
  const bobFiles = await req(BASE, `/api/projects/files?projectId=${encodeURIComponent(aliceProject)}`, {
    jar: bob,
  });
  const rows = bobFiles.json?.files || bobFiles.json?.items || [];
  assert.equal(rows.length, 0, "another account must not read the agent's files");
});

await run("an empty goal is refused before any model call or charge", async () => {
  mode = "ok";
  const jar = await signUp("empty");
  const before = await balance(jar);
  const r = await req(BASE, "/api/ai/agent", { method: "POST", jar, body: { goal: "   " } });
  assert.equal(r.status, 400);
  assert.equal(await balance(jar), before, "a rejected goal is never billed");
});

/* ── 6. Safety ───────────────────────────────────────────── */

await run("the agent has no shell and cannot execute code on the server", () => {
  const agent = src("lib/ai/agent.ts");
  const parse = src("lib/ai/agent-parse.ts");
  for (const danger of ["child_process", "vm.runInNewContext", "new Function(", "execSync"]) {
    assert.equal(agent.includes(danger), false, `the agent must never gain ${danger}`);
  }
  // The tool surface is a closed list; anything outside it is not callable.
  for (const tool of ["shell", "exec", "bash", "http_request"]) {
    assert.equal(
      parse.includes(`"${tool}"`),
      false,
      `${tool} must not be a recognised agent tool`
    );
  }
  assert.ok(agent.includes("run_check"), "verification stays static analysis");
});

await run("agent budgets are enforced on every axis", () => {
  const agent = src("lib/ai/agent.ts");
  for (const cap of [
    "maxSteps",
    "maxToolCalls",
    "maxFileChars",
    "maxTotalWriteChars",
    "maxWallMs",
  ]) {
    assert.ok(agent.includes(cap), `${cap} must exist`);
    assert.ok(
      agent.includes(`AGENT_LIMITS.${cap}`),
      `${cap} must actually be enforced, not merely declared`
    );
  }
  assert.ok(agent.includes('refused unsafe path'), "path traversal is refused");
});

await run("no keys, vendor hosts or internal errors reach the browser", async () => {
  mode = "down";
  const jar = await signUp("leak");
  const r = await runAgent(jar, { goal: "build a page" });
  for (const leak of ["bw-fixture-key", "GROQ_API_KEY", "127.0.0.1", "api.groq.com", "Bearer "]) {
    assert.equal(
      r.raw.includes(leak),
      false,
      `the agent stream leaked ${leak}`
    );
  }
  const route = src("app/api/ai/agent/route.ts");
  assert.ok(route.includes("userProviderKeys"), "BYOK is resolved server-side");
  assert.equal(route.includes("AI_KEYS"), false, "the route never touches raw keys");
});

if (srv) stopServer(srv);
fixture.close();

process.exit(report("coding agent — end to end") ? 1 : 0);
