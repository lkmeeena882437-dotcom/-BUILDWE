#!/usr/bin/env node
/**
 * UPDATE 19 PHASE 1 — core provider activation.
 *
 * Six providers are meant to be live on this deployment: Google (Gemini),
 * Groq, OpenRouter, Pollinations, Deepgram, and the existing keyless TTS route.
 * Everything else stays registered but dark until a key appears.
 *
 * The checks that matter most here are the boring ones: that every id in the
 * catalog is a string the vendor will actually accept today, and that a
 * provider with no key is reported unavailable rather than being handed a
 * request it cannot serve.
 *
 * Run: npm run test:providers
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { newJar, report, req, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/* Compile the catalog standalone — it is import-free by design. */
const outDir = path.join(ROOT, ".tmp-providers");
fs.rmSync(outDir, { recursive: true, force: true });
execFileSync(
  "npx",
  ["tsc", "lib/ai/models-catalog.ts", "--outDir", outDir, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
  { cwd: ROOT, stdio: "pipe" }
);
const CAT = createRequire(path.join(ROOT, "noop.cjs"))(path.join(outDir, "models-catalog.js"));


/** Join the {token} frames of a BUILDWE SSE stream into the visible answer. */
function sseText(raw) {
  let out = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      const j = JSON.parse(t.slice(5).trim());
      if (typeof j.token === "string") out += j.token;
    } catch {
      /* partial */
    }
  }
  return out;
}

const CORE = ["google", "groq", "openrouter", "pollinations", "deepgram"];

/**
 * Model ids Groq has shut down. A catalog row carrying one of these is not a
 * fallback, it is a guaranteed 400 — which is exactly what a fallback chain
 * must never contain.
 * Source: console.groq.com/docs/deprecations
 */
const RETIRED_GROQ = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-405b-reasoning",
  "llama-3.2-3b-instruct",
  "qwen-2.5-coder-32b",
  "qwen/qwen3-32b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-guard-4-12b",
  "moonshotai/kimi-k2-instruct-0905",
  "gemma2-9b-it",
];

/* ── 1. The six providers are registered and adapter-backed ── */

await run("all six core providers are registered with an adapter", () => {
  for (const id of CORE) {
    const cfg = CAT.PROVIDER_CONFIG[id];
    assert.ok(cfg, `${id} is not in PROVIDER_CONFIG`);
    assert.ok(
      Object.keys(cfg.adapters).length > 0,
      `${id} has no adapter, so it can never become available`
    );
  }
});

await run("each core provider covers the capability it was activated for", () => {
  const want = {
    google: ["chat", "code", "image"],
    groq: ["chat", "code", "stt"],
    openrouter: ["chat", "code"],
    pollinations: ["image", "audio"],
    deepgram: ["stt"],
  };
  for (const [id, caps] of Object.entries(want)) {
    for (const cap of caps) {
      assert.ok(
        CAT.PROVIDER_CONFIG[id].adapters[cap],
        `${id} must have a ${cap} adapter`
      );
    }
  }
});

await run("routing priority is Gemini, then Groq, then OpenRouter", () => {
  const p = (id) => CAT.PROVIDER_CONFIG[id].priority;
  assert.ok(p("google") < p("groq"), "Gemini leads the chain");
  assert.ok(p("groq") < p("openrouter"), "Groq comes before OpenRouter");
  assert.ok(p("openrouter") < p("pollinations"), "keyless is the last resort");
});

await run("the keyless TTS route is preserved, ElevenLabs stays inactive", () => {
  assert.equal(CAT.PROVIDER_CONFIG.pollinations.keyEnv, null, "TTS stays keyless");
  assert.ok(CAT.PROVIDER_CONFIG.pollinations.adapters.audio, "and still serves audio");
  const audio = CAT.MODEL_CATALOG.filter((m) => m.capability === "audio");
  assert.ok(
    audio.some((m) => m.provider === "pollinations"),
    "the verified TTS row must survive"
  );
  // Registered for the future, but with no key it must stay dark.
  assert.ok(CAT.PROVIDER_CONFIG.elevenlabs, "ElevenLabs stays registered");
  assert.equal(CAT.PROVIDER_CONFIG.elevenlabs.keyEnv, "ELEVENLABS_API_KEY");
});

/* ── 2. Every id is one the vendor accepts today ─────────── */

await run("no catalog row points at a model Groq has shut down", () => {
  const dead = CAT.MODEL_CATALOG.filter(
    (m) => m.provider === "groq" && RETIRED_GROQ.includes(m.id)
  ).map((m) => `${m.id} (${m.capability})`);
  assert.deepEqual(dead, [], "a retired id is a guaranteed 400, not a fallback");
});

await run("the last-resort ids are live models too", () => {
  const providers = src("lib/ai/providers.ts");
  const block = providers.slice(
    providers.indexOf("const GROQ_CHAT_MODELS"),
    providers.indexOf("export type ProviderKeys")
  );
  for (const dead of RETIRED_GROQ) {
    assert.equal(
      block.includes(`"${dead}"`),
      false,
      `the emergency fallback still lists the retired ${dead}`
    );
  }
  const seats = src("lib/ai/compare-seats.ts");
  for (const dead of RETIRED_GROQ) {
    assert.equal(seats.includes(`"${dead}"`), false, `a compare seat still uses ${dead}`);
  }
});

await run("every default compare seat is a real catalog chat row", () => {
  const seats = src("lib/ai/compare-seats.ts");
  const ids = [...seats.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => CAT.MODEL_CATALOG.some((m) => m.id === v));
  const chat = new Set(
    CAT.MODEL_CATALOG.filter((m) => m.capability === "chat").map((m) => m.id)
  );
  for (const id of ids) {
    assert.ok(chat.has(id), `${id} is not a chat row`);
  }
});

await run("the emergency fallback resolves to a row that exists", () => {
  const cat = src("lib/ai/models-catalog.ts");
  const m = cat.match(/MODEL_CATALOG\.find\(\(m\) => m\.id === "([^"]+)"\)!/);
  assert.ok(m, "the last-resort lookup is still there");
  assert.ok(
    CAT.MODEL_CATALOG.some((row) => row.id === m[1]),
    `the last-resort id ${m[1]} is not in the catalog — that lookup would throw`
  );
});

/* ── 3. The Phase 1 models are registered ────────────────── */

await run("the requested chat and code models are in the catalog", () => {
  const want = [
    ["gemini-3.7-flash", "chat"],
    ["gemini-3.6-flash", "chat"],
    ["openai/gpt-oss-120b", "chat"],
    ["gemini-3.7-flash", "code"],
    ["gemini-3.6-flash", "code"],
    ["openai/gpt-oss-120b", "code"],
    ["nvidia/nemotron-3-ultra-550b-a55b:free", "chat"],
    ["nvidia/nemotron-3-ultra-550b-a55b:free", "code"],
    ["groq/compound", "chat"],
  ];
  for (const [id, cap] of want) {
    assert.ok(
      CAT.MODEL_CATALOG.some((m) => m.id === id && m.capability === cap),
      `${id} is missing for ${cap}`
    );
  }
});

await run("the Nano Banana image models map to real Gemini ids", () => {
  const want = {
    "Nano Banana Pro": "gemini-3-pro-image",
    "Nano Banana 2": "gemini-3.1-flash-image",
    "Nano Banana 2 Lite": "gemini-3.1-flash-lite-image",
  };
  for (const [label, id] of Object.entries(want)) {
    const row = CAT.MODEL_CATALOG.find((m) => m.id === id && m.capability === "image");
    assert.ok(row, `${label} (${id}) is not registered as an image model`);
    assert.equal(row.provider, "google");
    assert.equal(row.label, label, "the nickname is what the UI shows");
  }
});

await run("Pollinations image models are untouched", () => {
  for (const id of ["flux", "turbo"]) {
    const row = CAT.MODEL_CATALOG.find((m) => m.id === id && m.capability === "image");
    assert.ok(row, `${id} must survive`);
    assert.equal(row.provider, "pollinations");
    assert.ok(row.tiers.includes("free"), "the keyless lane stays free");
  }
});

await run("the STT rows are Whisper on Groq, then Nova-2 on Deepgram", () => {
  const stt = CAT.MODEL_CATALOG.filter((m) => m.capability === "stt");
  const whisper = stt.find((m) => m.id === "whisper-large-v3");
  const nova = stt.find((m) => m.id === "nova-2");
  assert.ok(whisper && whisper.provider === "groq", "Whisper is the Groq row");
  assert.ok(nova && nova.provider === "deepgram", "Nova-2 is the Deepgram row");
  assert.ok(whisper.tiers.includes("free"), "Whisper is the free/primary STT lane");
});

/* ── 4. Paid models are not marked free ──────────────────── */

await run("a paid provider model is never sold as free", () => {
  // Gemini image inference is billed per image; a free consumer app tier is
  // not the same thing, and marking it free would be a billing bypass.
  for (const id of ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image"]) {
    const row = CAT.MODEL_CATALOG.find((m) => m.id === id);
    assert.equal(row.tiers.includes("free"), false, `${id} must not be a free tier row`);
    assert.ok(row.tiers.includes("byok"), `${id} should be reachable with a user key`);
  }
});

await run("every row declares a tier the entitlement system understands", () => {
  const ok = new Set(["free", "pro", "byok"]);
  for (const m of CAT.MODEL_CATALOG) {
    assert.ok(m.tiers.length, `${m.id} has no tiers`);
    for (const t of m.tiers) assert.ok(ok.has(t), `${m.id} has unknown tier ${t}`);
  }
});

/* ── 5. Availability follows the key, not the wish ───────── */

await run("a provider with no key is reported unavailable", async () => {
  const srv = await startServer({ port: 3480, label: "bw-nokeys", env: {} });
  try {
    const r = await req(srv.base, "/api/ai/models");
    assert.equal(r.status, 200);
    // `selectable` lists every row and flags reachability, so assert the flag —
    // a row being listed is the picker explaining WHY it is dark.
    for (const dead of ["gemini-3.7-flash", "nvidia/nemotron-3-ultra-550b-a55b:free"]) {
      const row = (r.json.selectable?.chat || []).find((m) => m.id === dead);
      assert.ok(row, `${dead} should still be listed`);
      assert.equal(row.available, false, `${dead} must not be available with no key`);
      assert.ok(row.whyNot, "and the UI is told why");
    }
    // Keyless routes still work — that is the whole point of the free lane.
    const flux = (r.json.selectable?.image || []).find((m) => m.id === "flux");
    assert.ok(flux?.available, "the keyless image lane stays available");
  } finally {
    stopServer(srv);
  }
});

await run("a keyed provider becomes available and never leaks the key", async () => {
  const SECRET = "bw-phase1-google-key";
  const srv = await startServer({
    port: 3481,
    label: "bw-keyed",
    env: { GOOGLE_API_KEY: SECRET, GROQ_API_KEY: "bw-phase1-groq-key" },
  });
  try {
    const r = await req(srv.base, "/api/ai/models");
    const chat = r.json.selectable?.chat || [];
    const gem = chat.find((m) => m.id === "gemini-3.7-flash");
    const grq = chat.find((m) => m.id === "openai/gpt-oss-120b");
    assert.ok(gem?.available, "a keyed Gemini row becomes available");
    assert.ok(grq?.available, "and so does the keyed Groq row");

    const flat = JSON.stringify(r.json);
    for (const leak of [SECRET, "bw-phase1-groq-key", "GOOGLE_API_KEY", "GEMINI_API_KEY", "generativelanguage", "api.groq.com"]) {
      assert.equal(flat.includes(leak), false, `/api/ai/models leaked ${leak}`);
    }
  } finally {
    stopServer(srv);
  }
});

await run("GEMINI_API_KEY is accepted as well as GOOGLE_API_KEY", async () => {
  const srv = await startServer({
    port: 3482,
    label: "bw-geminienv",
    env: { GEMINI_API_KEY: "bw-phase1-gemini-alias" },
  });
  try {
    const r = await req(srv.base, "/api/ai/models");
    const gem = (r.json.selectable?.chat || []).find((m) => m.id === "gemini-3.7-flash");
    assert.ok(
      gem?.available,
      "an operator following Google's own docs must not get a dead provider"
    );
  } finally {
    stopServer(srv);
  }
});

/* ── 6. Live routing through a Gemini fixture ────────────── */

await run("chat routes to Gemini first and sends the catalog id upstream", async () => {
  let seen = null;
  const fixture = http.createServer((rq, res) => {
    let b = "";
    rq.on("data", (c) => (b += c));
    rq.on("end", () => {
      seen = { url: rq.url, auth: rq.headers["x-goog-api-key"] || "" };
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      for (const piece of ["Gemini ", "answered."]) {
        res.write(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: piece }] } }] })}\n\n`
        );
      }
      res.end();
    });
  });
  await new Promise((r) => fixture.listen(3484, "127.0.0.1", r));

  const srv = await startServer({
    port: 3483,
    label: "bw-gemlive",
    env: {
      GEMINI_API_KEY: "bw-live-gemini",
      AI_BASE_URL_GOOGLE: "http://127.0.0.1:3484/v1beta/models",
      CREDITS_WELCOME: "500",
      SIGNUPS_PER_IP_PER_HOUR: "1000",
      SIGNUPS_GLOBAL_PER_DAY: "1000",
    },
  });
  try {
    const jar = newJar();
    await req(srv.base, "/api/auth/register", {
      method: "POST",
      jar,
      body: {
        email: `gem-${Date.now()}@buildwe.test`,
        password: "Str0ng-Passw0rd!x",
        name: "Gem",
      },
    });
    const res = await fetch(`${srv.base}/api/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header() },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello there" }] }),
    });
    const raw = await res.text();

    assert.ok(seen, "Gemini was never called — the chain did not lead with it");
    assert.match(seen.url, /gemini-3\.7-flash/, "the catalog id is what went upstream");
    assert.equal(seen.auth, "bw-live-gemini", "the key travels server-side in the header");
    assert.match(sseText(raw), /Gemini answered/, "and the answer reaches the client");
    assert.equal(raw.includes("bw-live-gemini"), false, "the key never reaches the client");
  } finally {
    stopServer(srv);
    fixture.close();
  }
});

await run("a dead Gemini falls back to the next provider, not to an error", async () => {
  const dead = http.createServer((rq, res) => {
    rq.on("data", () => {});
    rq.on("end", () => {
      res.writeHead(503);
      res.end("gemini down");
    });
  });
  await new Promise((r) => dead.listen(3486, "127.0.0.1", r));

  let groqHit = false;
  const groq = http.createServer((rq, res) => {
    let b = "";
    rq.on("data", (c) => (b += c));
    rq.on("end", () => {
      groqHit = true;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      for (const piece of ["Groq ", "answered."]) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`
        );
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => groq.listen(3487, "127.0.0.1", r));

  const srv = await startServer({
    port: 3485,
    label: "bw-fallback",
    env: {
      GEMINI_API_KEY: "bw-dead-gemini",
      GROQ_API_KEY: "bw-live-groq",
      AI_BASE_URL_GOOGLE: "http://127.0.0.1:3486/v1beta/models",
      AI_BASE_URL_GROQ: "http://127.0.0.1:3487/v1/chat/completions",
      CREDITS_WELCOME: "500",
      SIGNUPS_PER_IP_PER_HOUR: "1000",
      SIGNUPS_GLOBAL_PER_DAY: "1000",
    },
  });
  try {
    const jar = newJar();
    await req(srv.base, "/api/auth/register", {
      method: "POST",
      jar,
      body: {
        email: `fb-${Date.now()}@buildwe.test`,
        password: "Str0ng-Passw0rd!x",
        name: "FB",
      },
    });
    const res = await fetch(`${srv.base}/api/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header() },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    const raw = await res.text();
    assert.equal(groqHit, true, "the chain must fall through to the next provider");
    assert.match(sseText(raw), /Groq answered/, "and the user gets that answer");
    for (const leak of ["bw-dead-gemini", "bw-live-groq", "gemini down", "127.0.0.1"]) {
      assert.equal(raw.includes(leak), false, `the failure leaked ${leak}`);
    }
  } finally {
    stopServer(srv);
    dead.close();
    groq.close();
  }
});

fs.rmSync(outDir, { recursive: true, force: true });

process.exit(report("core provider activation") ? 1 : 0);
