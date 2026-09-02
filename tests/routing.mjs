#!/usr/bin/env node
/**
 * UPDATE 18 — central AI provider & routing system.
 *
 *   feature → adapter (one door) → catalog router → vendor adapter → normalized result
 *
 * Updates 12–17 already routed chat, code, agent, image and TTS through the
 * catalog. STT was the last capability still choosing its own vendor order in
 * code, so the catalog could not influence it at all. This suite locks the
 * whole arrangement down: every feature goes through the one door, and STT in
 * particular now obeys the registry like everything else.
 *
 * Run: npm run test:routing
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { newJar, report, req, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PORT = 3460;
const GROQ_PORT = 3462;
const DG_PORT = 3463;

const GROQ_SECRET = "bw-routing-groq-key";
const DG_SECRET = "bw-routing-deepgram-key";

/* ── STT vendor fixtures ─────────────────────────────────── */

let groqMode = "ok";
let dgMode = "down";
let groqHits = [];
let dgHits = [];

/** Groq: OpenAI-compatible multipart /audio/transcriptions. */
const groqFixture = http.createServer((rq, res) => {
  let raw = "";
  rq.on("data", (c) => (raw += c.toString("binary")));
  rq.on("end", () => {
    const m = raw.match(/name="model"\r?\n\r?\n([^\r\n]+)/);
    groqHits.push({ model: m ? m[1] : null, auth: rq.headers.authorization || "" });
    if (groqMode === "down") {
      res.writeHead(503);
      return res.end("groq stt down");
    }
    if (groqMode === "empty") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ text: "   " }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: "transcribed by whisper" }));
  });
});
await new Promise((r) => groqFixture.listen(GROQ_PORT, "127.0.0.1", r));

/** Deepgram: raw body, model in the query string. */
const dgFixture = http.createServer((rq, res) => {
  rq.on("data", () => {});
  rq.on("end", () => {
    const url = new URL(rq.url, "http://x");
    dgHits.push({
      model: url.searchParams.get("model"),
      auth: rq.headers.authorization || "",
    });
    if (dgMode === "down") {
      res.writeHead(503);
      return res.end("deepgram down");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        results: { channels: [{ alternatives: [{ transcript: "transcribed by nova" }] }] },
      })
    );
  });
});
await new Promise((r) => dgFixture.listen(DG_PORT, "127.0.0.1", r));

/* ── server ──────────────────────────────────────────────── */

const srv = await startServer({
  port: PORT,
  label: "bw-routing",
  env: {
    GROQ_API_KEY: GROQ_SECRET,
    DEEPGRAM_API_KEY: DG_SECRET,
    AI_BASE_URL_GROQ_STT: `http://127.0.0.1:${GROQ_PORT}/v1/audio/transcriptions`,
    AI_BASE_URL_DEEPGRAM_STT: `http://127.0.0.1:${DG_PORT}/v1/listen`,
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
      email: `route-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "Str0ng-Passw0rd!x",
      name: `Route ${tag}`,
    },
  });
  assert.equal(r.status, 200, `register failed: ${r.text?.slice(0, 200)}`);
  return jar;
}

/** POST an audio clip to /api/ai/transcribe. */
async function transcribe(jar, bytes = 4096) {
  const form = new FormData();
  form.append("audio", new Blob([Buffer.alloc(bytes, 0x41)], { type: "audio/webm" }), "clip.webm");
  const res = await fetch(`${BASE}/api/ai/transcribe`, {
    method: "POST",
    headers: { ...(jar?.header() ? { cookie: jar.header() } : {}) },
    body: form,
  });
  jar?.absorb(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text };
}

const balance = async (jar) => (await req(BASE, "/api/credits", { jar })).json?.balance;

function reset(g = "ok", d = "down") {
  groqMode = g;
  dgMode = d;
  groqHits = [];
  dgHits = [];
}

/* ── 1. One door: every feature routes through the adapter ── */

await run("every AI feature route goes through the adapter, not a vendor", () => {
  const routes = {
    "app/api/ai/chat/route.ts": "runChat",
    "app/api/ai/code/route.ts": "runChat",
    "app/api/ai/image/route.ts": "runImage",
    "app/api/ai/audio/route.ts": "runAudio",
    "app/api/ai/transcribe/route.ts": "runStt",
  };
  for (const [file, runner] of Object.entries(routes)) {
    const s = src(file);
    assert.match(s, /from "@\/lib\/ai\/adapter"/, `${file} must import the adapter`);
    assert.ok(s.includes(runner), `${file} must use ${runner}`);
  }
  // The agent resolves its own chain but still through the adapter's chainFor.
  assert.match(src("lib/ai/agent.ts"), /from "@\/lib\/ai\/adapter"/, "agent uses the adapter");
});

await run("no route reaches a vendor endpoint or raw key directly", () => {
  for (const f of [
    "app/api/ai/chat/route.ts",
    "app/api/ai/code/route.ts",
    "app/api/ai/image/route.ts",
    "app/api/ai/audio/route.ts",
    "app/api/ai/transcribe/route.ts",
    "app/api/ai/agent/route.ts",
  ]) {
    const s = src(f);
    assert.equal(/https:\/\/api\./.test(s), false, `${f} holds a vendor endpoint`);
    assert.equal(s.includes("AI_KEYS"), false, `${f} touches raw platform keys`);
  }
});

await run("the adapter exposes one runner per capability", () => {
  const a = src("lib/ai/adapter.ts");
  for (const r of ["runChat", "runImage", "runAudio", "runStt", "chainFor", "pickFor"]) {
    assert.ok(a.includes(`export const ${r}`) || a.includes(`export function ${r}`), `missing ${r}`);
  }
});

/* ── 2. STT is now catalog-routed (the update 18 gap) ────── */

await run("STT picks its vendor from the catalog, not a hardcoded order", () => {
  const s = src("lib/ai/stt.ts");
  assert.match(s, /modelChain\(\{/, "STT resolves a chain from the catalog");
  assert.match(s, /capability: "stt"/, "…for the stt capability");
  assert.match(s, /availableProvidersFor\("stt"/, "…filtered by real availability");
  // The old code named the vendors in sequence inside transcribeAudio.
  const body = s.slice(s.indexOf("export async function transcribeAudio"));
  assert.equal(
    /const dg = await deepgramNova|const wk = await groqWhisper/.test(body),
    false,
    "the vendor order must no longer be written into the function"
  );
});

await run("a free-tier caller gets the free catalog STT model", async () => {
  reset("ok", "ok");
  const jar = await signUp("free");
  const r = await transcribe(jar);
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text.slice(0, 200)}`);
  assert.equal(r.json.text, "transcribed by whisper");
  // nova-2 is pro/byok only, so a free caller must not reach Deepgram even
  // though its key is configured and it would otherwise be preferred.
  assert.equal(dgHits.length, 0, "a pro-only STT row must not serve a free caller");
  assert.equal(groqHits.length, 1, "the free row answered");
  assert.equal(groqHits[0].model, "whisper-large-v3", "the catalog model id is what was requested");
});

await run("the model id sent upstream comes from the catalog row", async () => {
  reset("ok", "ok");
  const jar = await signUp("modelid");
  await transcribe(jar);
  const ids = new Set(
    src("lib/ai/models-catalog.ts")
      .split("\n")
      .filter((l) => /^\s*id: "/.test(l))
      .map((l) => l.match(/id: "([^"]+)"/)[1])
  );
  for (const h of groqHits) {
    assert.ok(ids.has(h.model), `${h.model} is not a registered catalog id`);
  }
});

await run("STT falls back to the next catalog model when one vendor dies", async () => {
  reset("down", "ok");
  const jar = await signUp("fallback");
  const r = await transcribe(jar);
  // Groq (free row) is dead. A free caller has no other free STT row, so this
  // must be an honest refusal rather than a silent jump to a pro model.
  assert.equal(groqHits.length >= 1, true, "the free row was attempted");
  assert.equal(dgHits.length, 0, "a dead free row must not escalate to a pro row");
  assert.equal(r.status, 503, "no reachable model for this plan is a clean refusal");
  assert.ok(r.json?.error, "with a user-facing message");
});

await run("all STT models failing is a refusal, never an invented transcript", async () => {
  reset("down", "down");
  const jar = await signUp("alldown");
  const r = await transcribe(jar);
  assert.equal(r.status, 503, "a total STT outage is reported, not faked");
  assert.equal(
    /transcribed by/.test(JSON.stringify(r.json || {})),
    false,
    "no fixture text may leak into a failed transcription"
  );
});

await run("an empty transcript is treated as failure, not success", async () => {
  reset("empty", "down");
  const jar = await signUp("blank");
  const r = await transcribe(jar);
  assert.equal(r.status, 503, "whitespace is not a transcript");
});

/* ── 3. Credits ──────────────────────────────────────────── */

await run("a failed transcription is refunded; a successful one is charged", async () => {
  const jar = await signUp("credits");

  reset("down", "down");
  const before = await balance(jar);
  const failed = await transcribe(jar);
  assert.equal(failed.status, 503);
  assert.equal(await balance(jar), before, "a failed STT run must not be billed");

  reset("ok", "ok");
  const ok = await transcribe(jar);
  assert.equal(ok.status, 200);
  const after = await balance(jar);
  assert.ok(after < before, "a real transcript is charged");
});

await run("one request charges once", async () => {
  reset("ok", "ok");
  const jar = await signUp("once");
  const before = await balance(jar);
  await transcribe(jar);
  const mid = await balance(jar);
  const first = before - mid;
  await transcribe(jar);
  const second = mid - (await balance(jar));
  assert.equal(first, second, "two identical calls must cost the same — no double charge");
  assert.ok(first > 0, "and a successful call does cost something");
});

/* ── 4. Registry is configuration, not code ──────────────── */

await run("the registry carries what an admin surface would need", () => {
  const cat = src("lib/ai/models-catalog.ts");
  for (const field of ["id:", "provider:", "capability:", "tiers:", "quality:", "cost:", "latency:"]) {
    assert.ok(cat.includes(field), `catalog rows must carry ${field}`);
  }
  for (const field of ["adapters:", "keyEnv:", "priority:"]) {
    assert.ok(cat.includes(field), `provider config must carry ${field}`);
  }
});

await run("a vendor with no adapter never becomes available", () => {
  const cfg = src("lib/ai/provider-config.ts");
  assert.match(cfg, /if \(!cfg\.adapters\[cap\]\) continue;/, "no adapter, no availability");
  assert.match(cfg, /keyOk\(/, "a placeholder key must not count as configured");
});

await run("capabilities are declared centrally and agent aliases code", () => {
  const cat = src("lib/ai/models-catalog.ts");
  for (const cap of ["chat", "code", "image", "audio", "stt", "vision"]) {
    assert.ok(cat.includes(`"${cap}"`), `capability ${cap} must be declared`);
  }
  assert.match(cat, /resolveCapability/, "one place resolves capability aliases");
});

/* ── 5. Security ─────────────────────────────────────────── */

await run("a caller cannot inject a provider, endpoint or model of their own", async () => {
  reset("ok", "ok");
  const jar = await signUp("inject");
  const form = new FormData();
  form.append("audio", new Blob([Buffer.alloc(2048, 0x41)], { type: "audio/webm" }), "c.webm");
  form.append("endpoint", "http://127.0.0.1:9/steal");
  form.append("provider", "evil");
  form.append("model", "../../etc/passwd");
  const res = await fetch(`${BASE}/api/ai/transcribe`, {
    method: "POST",
    headers: { cookie: jar.header() },
    body: form,
  });
  assert.ok(res.status === 200 || res.status === 503, `unexpected ${res.status}`);
  for (const h of [...groqHits, ...dgHits]) {
    assert.notEqual(h.model, "../../etc/passwd", "a user-supplied model id was honoured");
  }
  const stt = src("lib/ai/stt.ts");
  assert.equal(stt.includes("body.endpoint"), false, "no caller-supplied endpoint");
  assert.equal(stt.includes("body.url"), false, "no caller-supplied URL");
});

await run("STT keys and endpoints never reach the client", async () => {
  reset("down", "down");
  const jar = await signUp("leak");
  const bad = await transcribe(jar);
  reset("ok", "ok");
  const good = await transcribe(jar);
  for (const blob of [bad.text, good.text]) {
    for (const leak of [
      GROQ_SECRET,
      DG_SECRET,
      "127.0.0.1",
      "api.groq.com",
      "api.deepgram.com",
      "Bearer ",
      "Token ",
      "AI_BASE_URL",
    ]) {
      assert.equal(blob.includes(leak), false, `the client was shown ${leak}`);
    }
  }
});

await run("transcription requires a session and is rate limited", async () => {
  reset("ok", "ok");
  const anon = await transcribe(null);
  assert.notEqual(anon.status, 500, "an unauthenticated call must not crash");

  const jar = await signUp("rl");
  let limited = false;
  for (let i = 0; i < 40; i++) {
    const r = await transcribe(jar, 512);
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true, "an unbounded STT endpoint is an open transcription proxy");
});

await run("the durable limiter still guards the AI endpoints", () => {
  const guard = src("lib/rate-limit/guard.ts");
  assert.match(guard, /rateLimitDurable\(`ai:\$\{scope\}/, "AI limits stay durable, not process-local");
});

/* ── 6. Cooldown stays an optimisation ───────────────────── */

await run("STT joins the shared two-strike cooldown", () => {
  const s = src("lib/ai/stt.ts");
  assert.ok(s.includes("noteModelFailure"), "a dead STT vendor is recorded");
  assert.ok(s.includes("noteModelSuccess"), "a working one clears its strikes");
  const chain = src("lib/ai/model-chain.ts");
  assert.match(chain, /const strikes = new Map/, "cooldown stays process-local by design");
  assert.match(chain, /\[\.\.\.hot, \.\.\.cooling\]/, "benched models are reordered, never removed");
});

stopServer(srv);
groqFixture.close();
dgFixture.close();

process.exit(report("AI provider & routing system") ? 1 : 0);
