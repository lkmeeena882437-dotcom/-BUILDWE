#!/usr/bin/env node
/**
 * UPDATE 15 — coding feature, end to end.
 *
 * A real BUILDWE server against a local OpenAI-compatible fixture standing in
 * for the code vendor, so the whole path runs offline and deterministically:
 *
 *   code UI → /api/ai/code → catalog → adapter → model → SSE stream → UI
 *
 * The fixture can go down mid-suite, so fallback and the honest-offline reply
 * are exercised rather than described.
 *
 * Run: npm run test:code
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { newJar, report, req, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PORT = 3430;
const FIXTURE_PORT = 3431;

const CODE_REPLY =
  "Here you go:\n\n```js\nexport function add(a, b) {\n  return a + b;\n}\n```\n\n- pure function\n- no deps";

let mode = "ok";
let lastBody = null;
let hits = 0;

const fixture = http.createServer((rq, res) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    hits++;
    try {
      lastBody = JSON.parse(raw);
    } catch {
      lastBody = null;
    }
    if (mode === "down") {
      res.writeHead(503, { "Content-Type": "text/plain" });
      return res.end("model unavailable");
    }
    if (lastBody?.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      // Deliberately chunked, so the route's SSE re-framing is exercised
      // rather than a single tidy write.
      for (const piece of CODE_REPLY.match(/[\s\S]{1,8}/g) || [CODE_REPLY]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: CODE_REPLY } }] }));
  });
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));

let srv = null;
srv = await startServer({
  port: PORT,
  label: "bw-code",
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
      email: `code-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "Str0ng-Passw0rd!x",
      name: `Code ${tag}`,
    },
  });
  assert.equal(r.status, 200, `register failed: ${r.text?.slice(0, 200)}`);
  return jar;
}

/** POST /api/ai/code and parse the SSE frames into {meta, text, errors}. */
async function codeStream(jar, body) {
  const res = await fetch(`${BASE}/api/ai/code`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jar?.header() ? { cookie: jar.header() } : {}),
    },
    body: JSON.stringify(body),
  });
  jar?.absorb(res);
  const raw = await res.text();
  let meta = null;
  let text = "";
  const errors = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      const j = JSON.parse(t.slice(5).trim());
      if (j.meta) meta = j.meta;
      if (j.token) text += j.token;
      if (j.error) errors.push(j.error);
    } catch {
      /* partial frame */
    }
  }
  return { status: res.status, contentType: res.headers.get("content-type") || "", meta, text, errors, raw };
}

const ask = (jar, content, extra = {}) =>
  codeStream(jar, { messages: [{ role: "user", content }], ...extra });

/* ── 1. Success + streaming ──────────────────────────────── */

await run("a code request streams a real answer back as SSE", async () => {
  mode = "ok";
  const jar = await signUp("happy");
  const r = await ask(jar, "write an add function in javascript");
  assert.equal(r.status, 200, `expected 200, got ${r.status}`);
  assert.match(r.contentType, /text\/event-stream/, "code must stream, not buffer");
  assert.ok(r.meta, "the first frame carries meta");
  assert.equal(r.meta.live, true, "a reachable model answers live");
  assert.ok(r.text.includes("export function add"), `the code did not arrive: ${r.text.slice(0, 120)}`);
  assert.equal(r.errors.length, 0, "a healthy run emits no error frame");
});

await run("the answer arrives as many tokens, not one blob", async () => {
  mode = "ok";
  const jar = await signUp("chunks");
  const res = await fetch(`${BASE}/api/ai/code`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar.header() },
    body: JSON.stringify({ messages: [{ role: "user", content: "write a js helper" }] }),
  });
  const raw = await res.text();
  const tokenFrames = raw.split("\n").filter((l) => l.includes('"token"')).length;
  // The fixture emits ~12 deltas; the route must forward them incrementally
  // rather than buffering the whole answer and sending one frame at the end.
  assert.ok(tokenFrames >= 8, `expected an incremental stream, saw ${tokenFrames} token frames`);
});

await run("the model label is branded, never the raw vendor id", async () => {
  mode = "ok";
  const jar = await signUp("brand");
  const r = await ask(jar, "write a sorting function");
  assert.ok(r.meta.model, "a model label is reported");
  for (const leak of ["groq", "llama", "qwen", "gpt-", "claude", "127.0.0.1"]) {
    assert.equal(
      String(r.meta.model).toLowerCase().includes(leak),
      false,
      `the label leaked a vendor detail: ${r.meta.model}`
    );
  }
});

/* ── 2. Catalog / chain ──────────────────────────────────── */

await run("only a reachable, plan-allowed code model is called", async () => {
  mode = "ok";
  const jar = await signUp("chain");
  lastBody = null;
  await ask(jar, "refactor this python function");
  assert.ok(lastBody?.model, "the adapter sent a model id to the vendor");
  const CODE_IDS = [
    "qwen-2.5-coder-32b",
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];
  assert.ok(
    CODE_IDS.includes(lastBody.model),
    `${lastBody.model} is not a free-tier groq code model — an unreachable vendor was attempted`
  );
});

await run("the code chain is catalog-driven and shared with chat", () => {
  const chain = src("lib/ai/model-chain.ts");
  assert.ok(chain.includes('capability: "chat" | "code"'), "one builder serves both");
  assert.ok(chain.includes("modelChain({"), "candidates come from the catalog");
  const providers = src("lib/ai/providers.ts");
  assert.ok(providers.includes("buildChatChain({"), "code uses the shared chain builder");
});

/* ── 3. Fallback + failure ───────────────────────────────── */

await run("an unreachable model falls back to an honest offline answer", async () => {
  mode = "down";
  const jar = await signUp("offline");
  const r = await ask(jar, "write a binary search in javascript");
  assert.equal(r.status, 200, "a vendor outage must not 500 the request");
  assert.equal(r.meta.live, false, "an offline answer must be labelled offline");
  assert.ok(r.text.trim().length > 0, "the user still gets something useful");
  assert.ok(r.meta.fallbackNote, "the user is told the primary model was unavailable");
});

await run("the service recovers on the next request with no restart", async () => {
  mode = "down";
  const jar = await signUp("recover");
  const bad = await ask(jar, "write a queue class");
  assert.equal(bad.meta.live, false);

  mode = "ok";
  const good = await ask(jar, "write a stack class");
  assert.equal(good.meta.live, true, "a recovered vendor must be used again");
  assert.ok(good.text.includes("export function add"));
});

await run("a malformed body is refused, not crashed on", async () => {
  mode = "ok";
  const jar = await signUp("malformed");
  const r = await req(BASE, "/api/ai/code", { method: "POST", jar, body: { nope: 1 } });
  assert.equal(r.status, 400);
  assert.ok(r.json.error, "the refusal explains itself");
});

await run("an absurd message is rejected at the edge before any model call", async () => {
  mode = "ok";
  const jar = await signUp("toolong");
  const before = hits;
  const r = await req(BASE, "/api/ai/code", {
    method: "POST",
    jar,
    body: { messages: [{ role: "user", content: "x".repeat(30_000) }] },
  });
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "MESSAGE_TOO_LONG");
  assert.equal(hits, before, "no vendor call for an oversized message");
});

/* ── 4. Project context ──────────────────────────────────── */

async function makeProject(jar, name) {
  const r = await req(BASE, "/api/projects", { method: "POST", jar, body: { action: "create", name } });
  assert.equal(r.status, 200, `project create failed: ${r.text?.slice(0, 160)}`);
  return r.json.project.id;
}

await run("a project's real files are sent to the model as context", async () => {
  mode = "ok";
  const jar = await signUp("ctx");
  const projectId = await makeProject(jar, "Ctx Project");
  const saved = await req(BASE, "/api/projects/files", {
    method: "POST",
    jar,
    body: { projectId, path: "src/util.js", content: "export const MAGIC = 42;", lang: "javascript" },
  });
  assert.equal(saved.status, 200, `file save failed: ${saved.text?.slice(0, 160)}`);

  lastBody = null;
  const r = await ask(jar, "what does util.js export?", { projectId });
  assert.equal(r.status, 200);
  const sent = JSON.stringify(lastBody?.messages || []);
  assert.ok(sent.includes("src/util.js"), "the file path must reach the model");
  assert.ok(sent.includes("MAGIC"), "the file contents must reach the model");
  assert.equal(r.meta.context?.attached, true, "the UI is told context was attached");
});

await run("an unknown project is reported as blind, not silently ignored", async () => {
  mode = "ok";
  const jar = await signUp("badctx");
  lastBody = null;
  const r = await ask(jar, "explain the project layout", { projectId: "proj_does_not_exist" });
  assert.equal(r.status, 200, "a stale project chip must not lose the answer");
  assert.equal(r.meta.context?.attached, false, "the UI must not claim context it never had");
  assert.equal(r.meta.context?.reason, "not_found");
  const sent = JSON.stringify(lastBody?.messages || []);
  assert.ok(
    sent.includes("have NOT been shown its files"),
    "the model must be told it is working blind so it does not invent a structure"
  );
});

await run("another user's project contributes nothing to my context", async () => {
  mode = "ok";
  const alice = await signUp("ctx-alice");
  const bob = await signUp("ctx-bob");
  const projectId = await makeProject(alice, "Alice Secret");
  await req(BASE, "/api/projects/files", {
    method: "POST",
    jar: alice,
    body: { projectId, path: "secret.js", content: "const TOKEN='alice-private-value';", lang: "javascript" },
  });

  lastBody = null;
  const r = await ask(bob, "what is in this project?", { projectId });
  assert.equal(r.status, 200);
  const sent = JSON.stringify(lastBody?.messages || []);
  assert.equal(
    sent.includes("alice-private-value"),
    false,
    "another account's source code must never reach the model on my request"
  );
  assert.notEqual(r.meta.context?.attached, true, "and it must not be reported as attached");
});

/* ── 5. History + isolation ──────────────────────────────── */

await run("a code answer is saved to its own conversation and creations", async () => {
  mode = "ok";
  const jar = await signUp("hist");
  const r = await ask(jar, "write a debounce helper");
  assert.equal(r.status, 200);
  assert.ok(r.meta.conversationId, "a conversation id is returned for follow-ups");

  const hist = await req(BASE, `/api/history?id=${encodeURIComponent(r.meta.conversationId)}`, { jar });
  assert.equal(hist.status, 200);
  const msgs = hist.json.conversation?.messages || hist.json.messages || [];
  assert.ok(
    msgs.some((m) => m.role === "assistant" && m.content.includes("export function add")),
    "the streamed answer must be persisted, not just streamed"
  );
});

await run("a conversation cannot be read or continued by another user", async () => {
  mode = "ok";
  const alice = await signUp("iso-alice");
  const bob = await signUp("iso-bob");
  const mine = await ask(alice, "write a uuid helper");
  const convId = mine.meta.conversationId;

  const peek = await req(BASE, `/api/history?id=${encodeURIComponent(convId)}`, { jar: bob });
  assert.notEqual(peek.status, 200, "another user must not read my code thread");

  const hijack = await ask(bob, "continue", { conversationId: convId });
  assert.equal(hijack.status, 404, "another user must not append to my thread");
});

/* ── 6. Code actions (fix / optimize / refactor / test) ──── */

await run("a canvas action returns the extracted code block", async () => {
  mode = "ok";
  const jar = await signUp("action");
  const r = await req(BASE, "/api/ai/code-action", {
    method: "POST",
    jar,
    body: { code: "function add(a,b){return a-b}", lang: "javascript", action: "fix" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.code.includes("export function add"), "the fenced block is extracted for the canvas");
});

await run("an unknown action is refused", async () => {
  mode = "ok";
  const jar = await signUp("badaction");
  const r = await req(BASE, "/api/ai/code-action", {
    method: "POST",
    jar,
    body: { code: "x=1", lang: "javascript", action: "rm -rf" },
  });
  assert.equal(r.status, 400);
});

await run("code actions resolve BYOK through the shared resolver", () => {
  const route = src("app/api/ai/code-action/route.ts");
  assert.ok(route.includes("userProviderKeys"), "one resolver for every code surface");
  assert.equal(
    route.includes("decryptSecret"),
    false,
    "a hand-rolled decrypt pair drifts from the accepted BYOK set"
  );
  assert.ok(route.includes('from "@/lib/ai/adapter"'), "actions go through the adapter too");
});

/* ── 7. Safety: no server-side execution, no secret leaks ── */

await run("generated code is never executed on the server", () => {
  for (const f of ["app/api/ai/code/route.ts", "app/api/ai/code-action/route.ts"]) {
    const body = src(f);
    for (const danger of ["child_process", "vm.runInNewContext", "new Function(", "eval("]) {
      assert.equal(body.includes(danger), false, `${f} must never execute model output (${danger})`);
    }
  }
});

await run("the browser runs code only in a sandbox it cannot escape", () => {
  const page = src("app/page.tsx");
  assert.ok(page.includes('sandbox="allow-scripts"'), "previews run in a sandboxed iframe");
  assert.equal(
    page.includes("allow-same-origin"),
    false,
    "allow-scripts + allow-same-origin together would defeat the sandbox"
  );
  assert.ok(page.includes("new Worker("), "JS runs in a worker, not on the page");
});

await run("no keys or vendor endpoints reach the browser", () => {
  const api = src("lib/client/api.ts");
  const page = src("app/page.tsx");
  for (const needle of [
    "GROQ_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "api.groq.com",
    "api.anthropic.com",
    "openrouter.ai",
  ]) {
    assert.equal(api.includes(needle), false, `client api must not mention ${needle}`);
    assert.equal(page.includes(needle), false, `page must not mention ${needle}`);
  }
  assert.ok(api.includes('"/api/ai/code"'), "the browser only talks to our own route");
});

await run("the code route goes through the adapter, never a vendor URL", () => {
  const route = src("app/api/ai/code/route.ts");
  assert.ok(route.includes('from "@/lib/ai/adapter"'), "code uses the shared runner");
  assert.ok(route.includes("userProviderKeys"), "BYOK is resolved server-side");
  for (const host of ["api.groq.com", "api.openai.com", "api.anthropic.com", "openrouter.ai"]) {
    assert.equal(route.includes(host), false, `the route must not hard-code ${host}`);
  }
});

if (srv) stopServer(srv);
fixture.close();

process.exit(report("coding feature — end to end") ? 1 : 0);
