#!/usr/bin/env node
/**
 * UPDATE 14 — voice generation, end to end.
 *
 * A real BUILDWE server against a local TTS fixture standing in for the keyless
 * vendor, so the whole path runs offline and deterministically:
 *
 *   voice UI → /api/ai/audio → catalog → adapter → provider → artifact → history
 *
 * The interesting cases are the dishonest ones. The keyless endpoint is a *chat*
 * model asked to produce speech, so it can answer with prose, with a truncated
 * clip, or with something that merely looks like a data URL. None of those are
 * audio, and none of them may be billed.
 *
 * Run: npm run test:voice
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { newJar, report, req, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PORT = 3420;
const FIXTURE_PORT = 3421;

/** A believable MP3: ID3 header + frame sync, comfortably over the size floor. */
function fakeMp3(bytes = 8000) {
  const buf = Buffer.alloc(bytes, 0x55);
  Buffer.from("ID3\u0004\u0000\u0000\u0000", "binary").copy(buf, 0);
  buf[10] = 0xff;
  buf[11] = 0xfb;
  return buf;
}

let mode = "ok";
let hits = 0;
const fixture = http.createServer((r, res) => {
  hits++;
  const send = (code, type, body) => {
    res.writeHead(code, { "Content-Type": type });
    res.end(body);
  };
  switch (mode) {
    case "down":
      return send(503, "text/plain", "tts unavailable");
    case "prose":
      // The failure that started this update: a chat reply containing a token
      // that pattern-matches a data URL but decodes to a few bytes.
      return send(
        200,
        "text/plain",
        "Sorry, I can't do that. See data:audio/mpeg;base64,AAAA for details."
      );
    case "tiny":
      // Correct container, truncated stream — a click, not speech.
      return send(200, "audio/mpeg", Buffer.from([0xff, 0xfb, 0x00, 0x00]));
    case "htmlaudio":
      // Claims audio in the header, actually serves an error page.
      return send(200, "audio/mpeg", Buffer.from("<html>rate limited</html>".repeat(80)));
    default:
      return send(200, "audio/mpeg", fakeMp3());
  }
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));

let srv = null;
srv = await startServer({
  port: PORT,
  label: "bw-voice",
  env: {
    AI_BASE_URL_POLLINATIONS_TEXT: `http://127.0.0.1:${FIXTURE_PORT}`,
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
      email: `voice-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "Str0ng-Passw0rd!x",
      name: `Voice ${tag}`,
    },
  });
  assert.equal(r.status, 200, `register failed: ${r.text?.slice(0, 200)}`);
  return jar;
}

const balance = async (jar) => (await req(BASE, "/api/credits", { jar })).json?.balance;
const speak = (jar, body) => req(BASE, "/api/ai/audio", { method: "POST", jar, body });

/**
 * The contract for "the vendor did not give us audio", whatever the shape of
 * the junk. Either the route reports the failure outright, or it degrades to
 * the device's own voice — but it must never present junk as a generated clip,
 * and it must never charge for it.
 */
function assertNotSoldAsAudio(r) {
  if (r.status === 200) {
    assert.notEqual(r.json.type, "mp3", "junk must not be returned as a generated clip");
    assert.notEqual(r.json.verified, true, "junk must never be marked verified");
    assert.equal(r.json.live, false, "nothing was generated, so this is not live AI audio");
    assert.equal(r.json.credits?.charged ?? 0, 0, "a failed synthesis is never billed");
  } else {
    assert.equal(r.json.code, "PROVIDER_EMPTY", `unexpected failure shape: ${r.status}`);
  }
}

/* ── 1. Success ──────────────────────────────────────────── */

await run("a script returns real, playable audio through the adapter chain", async () => {
  mode = "ok";
  const jar = await signUp("happy");
  const r = await speak(jar, { text: "Welcome to BuildWe.", voice: "nova", speed: 1 });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text?.slice(0, 200)}`);
  assert.equal(r.json.type, "mp3", "a reachable vendor must produce a clip, not browser TTS");
  assert.ok(r.json.audioUrl, "the clip must reach the browser");
  assert.equal(r.json.verified, true, "the bytes were confirmed to be audio");
  assert.equal(r.json.live, true, "a real generation is reported as live");
  assert.equal(r.json.provider, "buildwe", "the vendor name must never reach the browser");
  assert.ok(r.json.id, "the generation is recorded for history");
});

await run("the returned audio is a decodable container with the right MIME", async () => {
  mode = "ok";
  const jar = await signUp("mime");
  const r = await speak(jar, { text: "Testing one two three.", voice: "atlas", speed: 1 });
  assert.equal(r.status, 200);
  const m = /^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i.exec(r.json.audioUrl);
  assert.ok(m, "the clip must be a well-formed audio data URL");
  assert.equal(m[1], "audio/mpeg", "the MIME must describe the real container");
  const bytes = Buffer.from(m[2], "base64");
  assert.ok(bytes.length >= 1024, `too small to be audio: ${bytes.length} bytes`);
  assert.ok(
    bytes.subarray(0, 3).toString("ascii") === "ID3" || bytes[0] === 0xff,
    "the bytes must carry an MP3 signature"
  );
});

/* ── 2. Invalid / empty audio is not success ─────────────── */

await run("prose that merely looks like a data URL is not accepted as audio", async () => {
  const jar = await signUp("prose");
  mode = "ok";
  const before = await balance(jar);

  mode = "prose";
  const r = await speak(jar, { text: "Read this aloud please.", voice: "nova", speed: 1 });
  assertNotSoldAsAudio(r);
  assert.equal(await balance(jar), before, "nothing was generated, so nothing is charged");
});

await run("a truncated clip is rejected rather than sold as speech", async () => {
  const jar = await signUp("tiny");
  mode = "ok";
  const before = await balance(jar);

  mode = "tiny";
  const r = await speak(jar, { text: "Hello there.", voice: "nova", speed: 1 });
  assertNotSoldAsAudio(r);
  assert.equal(await balance(jar), before, "no charge for an unusable clip");
});

await run("an error page served as audio/mpeg is caught by the signature check", async () => {
  const jar = await signUp("htmlaudio");
  mode = "ok";
  const before = await balance(jar);

  // Big enough to pass any size-only check — only the container sniff catches it.
  mode = "htmlaudio";
  const r = await speak(jar, { text: "Announce the news.", voice: "nova", speed: 1 });
  assertNotSoldAsAudio(r);
  assert.equal(await balance(jar), before, "no charge for an error page");
});

/* ── 3. Provider failure, fallback, retry ────────────────── */

await run("a dead provider refunds the credit and reports the failure", async () => {
  const jar = await signUp("down");
  mode = "ok";
  const before = await balance(jar);

  mode = "down";
  const r = await speak(jar, { text: "This will not synthesise.", voice: "nova", speed: 1 });
  assertNotSoldAsAudio(r);
  assert.equal(await balance(jar), before, `credit must be returned: ${before}`);
});

await run("browser TTS is never reported as an AI generation", async () => {
  const jar = await signUp("browsertts");
  mode = "down";
  const r = await speak(jar, { text: "Fall back to the device.", voice: "nova", speed: 1 });
  // Whichever way the route answers a total outage, it must not claim a live
  // AI clip: the device's own voice is not something we generated or may bill.
  if (r.status === 200) {
    assert.equal(r.json.type, "browser-tts", "no vendor ran, so this cannot be an mp3");
    assert.equal(r.json.live, false, "browser TTS must be reported as offline");
    assert.notEqual(r.json.verified, true, "browser TTS is not verified AI audio");
    assert.equal(r.json.credits?.charged ?? 0, 0, "the device's own voice is free");
  } else {
    assert.equal(r.json.code, "PROVIDER_EMPTY");
  }
});

await run("retry after an outage succeeds and charges exactly once", async () => {
  const jar = await signUp("retry");
  mode = "down";
  await speak(jar, { text: "First attempt.", voice: "nova", speed: 1 });

  mode = "ok";
  const before = await balance(jar);
  const ok = await speak(jar, { text: "First attempt.", voice: "nova", speed: 1 });
  assert.equal(ok.status, 200, "a recovered vendor must work with no restart");
  const after = await balance(jar);
  assert.ok(after < before, "the successful retry is charged");
  assert.equal(before - after, ok.json.credits.charged, "charged exactly the quoted amount");
});

/* ── 4. Catalog / chain wiring ───────────────────────────── */

await run("the chain is catalog-driven and skips unreachable vendors", () => {
  const p = src("lib/ai/providers.ts");
  assert.ok(p.includes("modelChain({"), "the audio chain comes from the catalog");
  assert.ok(p.includes('capability: "audio"'), "it asks for the audio capability");
  assert.ok(
    p.includes("availableProviders: availableAudioProviders()"),
    "only vendors with a usable key enter the chain"
  );
  assert.ok(p.includes("ELEVENLABS_VOICE_IDS"), "the ElevenLabs voice mapping is preserved");
  assert.ok(p.includes("pollinationsTTS"), "the keyless fallback adapter is preserved");
});

await run("every TTS adapter shares one definition of valid audio", () => {
  const p = src("lib/ai/providers.ts");
  assert.ok(p.includes('from "@/lib/ai/audio-verify"'), "verification is centralised");
  assert.equal(
    /buf\.length < 1000/.test(p),
    false,
    "the old per-adapter length checks must be gone, not duplicated"
  );
  const v = src("lib/ai/audio-verify.ts");
  assert.ok(v.includes("export function sniffAudioMime"), "containers are identified, not assumed");
  assert.ok(v.includes("MIN_AUDIO_BYTES"), "there is one size floor");
});

/* ── 5. History, isolation, auth ─────────────────────────── */

await run("the clip lands in history and is scoped to its owner", async () => {
  mode = "ok";
  const alice = await signUp("alice");
  const bob = await signUp("bob");

  const made = await speak(alice, { text: "Alice's private script.", voice: "nova", speed: 1 });
  assert.equal(made.status, 200);

  const hers = await req(BASE, "/api/ai/generations?type=audio", { jar: alice });
  const ids = (hers.json.generations || hers.json.items || []).map((g) => g.id);
  assert.ok(ids.includes(made.json.id), "the clip must appear in its owner's history");

  const his = await req(BASE, "/api/ai/generations?type=audio", { jar: bob });
  const hisIds = (his.json.generations || his.json.items || []).map((g) => g.id);
  assert.equal(hisIds.includes(made.json.id), false, "another user must never see it");
});

await run("a failed generation leaves no history row behind", async () => {
  const jar = await signUp("nohistory");
  mode = "ok";
  const before = await req(BASE, "/api/ai/generations?type=audio", { jar });
  const beforeCount = (before.json.generations || before.json.items || []).length;

  mode = "prose";
  await speak(jar, { text: "This should not be saved.", voice: "nova", speed: 1 });

  mode = "ok";
  const after = await req(BASE, "/api/ai/generations?type=audio", { jar });
  const afterCount = (after.json.generations || after.json.items || []).length;
  assert.equal(afterCount, beforeCount, "a failure must not be saved as a creation");
});

/* ── 6. Input handling ───────────────────────────────────── */

await run("an empty script is refused before any provider call or charge", async () => {
  mode = "ok";
  const jar = await signUp("empty");
  const before = await balance(jar);
  const hitsBefore = hits;
  const r = await speak(jar, { text: "   ", voice: "nova", speed: 1 });
  assert.equal(r.status, 400);
  assert.equal(hits, hitsBefore, "no provider call for an empty script");
  assert.equal(await balance(jar), before, "no charge for a rejected script");
});

await run("an over-long script is rejected at the edge", async () => {
  mode = "ok";
  const jar = await signUp("long");
  const r = await speak(jar, { text: "la ".repeat(4000), voice: "nova", speed: 1 });
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "SCRIPT_TOO_LONG");
});

/* ── 7. Secrets stay server-side ─────────────────────────── */

await run("no keys, vendor hosts or voice ids reach the browser", () => {
  const api = src("lib/client/api.ts");
  const studio = src("components/workspace/AudioStudio.tsx");
  for (const needle of [
    "ELEVENLABS_API_KEY",
    "OPENAI_API_KEY",
    "xi-api-key",
    "api.elevenlabs.io",
    "api.openai.com",
    "text.pollinations.ai",
    "EXAVITQu4vr4xnSDxMaL",
  ]) {
    assert.equal(api.includes(needle), false, `client api must not mention ${needle}`);
    assert.equal(studio.includes(needle), false, `AudioStudio must not mention ${needle}`);
  }
  assert.ok(api.includes('"/api/ai/audio"'), "the browser only talks to our own route");
});

await run("the audio route uses the adapter and never a vendor directly", () => {
  const route = src("app/api/ai/audio/route.ts");
  assert.ok(route.includes('from "@/lib/ai/adapter"'), "audio goes through the adapter");
  assert.ok(route.includes("runAudio"), "it uses the shared capability runner");
  assert.ok(route.includes("refundArtifact"), "failures give the credit back");
  assert.ok(route.includes("plan.verified === true"), "only verified audio is billable");
  assert.ok(route.includes("if (!generated)"), "one honest branch decides whether anything was made");
  assert.ok(route.includes('provider: "buildwe"'), "the vendor is not named to the browser");
  for (const host of ["api.elevenlabs.io", "api.openai.com", "text.pollinations.ai"]) {
    assert.equal(route.includes(host), false, `the route must not hard-code ${host}`);
  }
});

if (srv) stopServer(srv);
fixture.close();

process.exit(report("voice generation — end to end") ? 1 : 0);
