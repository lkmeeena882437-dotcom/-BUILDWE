#!/usr/bin/env node
/**
 * UPDATE 9+10 — four-feature wiring + capability adapter.
 *
 * Source-level: the browser must never call a vendor, keys stay server-side,
 * feature routes go through the adapter, and a missing import cannot sneak
 * back in as a runtime ReferenceError.
 *
 * Run: npm run test:adapter
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const VENDOR_HOSTS = [
  "api.openai.com",
  "api.groq.com",
  "api.anthropic.com",
  "openrouter.ai",
  "api.elevenlabs.io",
  "generativelanguage.googleapis.com",
  "fal.run",
  "api.stability.ai",
];

await run("the browser client never talks to a vendor", () => {
  const api = src("lib/client/api.ts");
  for (const host of VENDOR_HOSTS) {
    assert.equal(api.includes(host), false, `lib/client/api.ts must not mention ${host}`);
  }
  assert.ok(api.includes('"/api/ai/chat"'), "chat goes through the feature API");
  assert.ok(api.includes('"/api/ai/code"'), "code goes through the feature API");
  assert.ok(api.includes('"/api/ai/image"'), "image goes through the feature API");
  assert.ok(api.includes('"/api/ai/audio"'), "audio goes through the feature API");
  assert.ok(api.includes('"/api/ai/agent"'), "the agent goes through the feature API");
  assert.ok(api.includes('"/api/ai/search"'), "web search goes through the feature API");
  assert.equal(api.includes("GROQ_API_KEY"), false, "no provider key name in the client");
  assert.equal(api.includes("ELEVENLABS_API_KEY"), false);
});

await run("page.tsx does not call vendors or ship keys", () => {
  const page = src("app/page.tsx");
  for (const host of VENDOR_HOSTS) {
    assert.equal(page.includes(host), false, `app/page.tsx must not mention ${host}`);
  }
  assert.ok(page.includes("streamAI("), "chat/code stream through the client helper");
  assert.ok(page.includes("generateImage("), "image studio posts to the feature API");
  assert.ok(page.includes("generateAudio("), "voice studio posts to the feature API");
  assert.ok(page.includes("runAgentApi("), "the agent button posts to the feature API");
  assert.equal(page.includes("from \"@/lib/config\""), false, "AI_KEYS must not land in the page bundle");
});

await run("opening a chat no longer throws on an undefined streamAtOpen", () => {
  const page = src("app/page.tsx");
  const at = page.indexOf("const openHist");
  assert.ok(at > 0, "openHist still exists");
  const fn = page.slice(at, at + 1800);
  assert.ok(
    fn.includes("const streamAtOpen = streamEpochRef.current"),
    "streamAtOpen must be captured from the epoch ref — a bare identifier is a ReferenceError after loadConversation"
  );
  assert.ok(fn.includes("streamEpochRef.current !== streamAtOpen"), "stale loads still bail when a newer stream started");
});

await run("the agent route imports getProject before using it", () => {
  const route = src("app/api/ai/agent/route.ts");
  assert.match(
    route,
    /import \{[^}]*getProject[^}]*\} from \"@\/lib\/db\/store\"/,
    "getProject used without an import is a ReferenceError when the client sends projectId"
  );
  assert.ok(route.includes("if (!getProject(projectId, session.userId))"), "a guessed project id is 404, not a crash");
});

await run("feature routes go through the adapter, not vendor URLs", () => {
  const chat = src("app/api/ai/chat/route.ts");
  const code = src("app/api/ai/code/route.ts");
  const image = src("app/api/ai/image/route.ts");
  const audio = src("app/api/ai/audio/route.ts");
  assert.ok(chat.includes('from "@/lib/ai/adapter"'), "chat route uses the adapter");
  assert.ok(code.includes('from "@/lib/ai/adapter"'), "code route uses the adapter");
  assert.ok(image.includes('from "@/lib/ai/adapter"'), "image route uses the adapter");
  assert.ok(audio.includes('from "@/lib/ai/adapter"'), "audio route uses the adapter");
  for (const [name, body] of [
    ["chat", chat],
    ["code", code],
    ["image", image],
    ["audio", audio],
  ]) {
    for (const host of VENDOR_HOSTS) {
      assert.equal(body.includes(host), false, `${name} route must not hard-code ${host}`);
    }
  }
  assert.ok(code.includes("userProviderKeys"), "code BYOK uses the shared resolver, not a one-off decrypt");
  assert.equal(code.includes("decryptSecret"), false, "code route no longer decrypts keys itself");
  assert.ok(audio.includes('provider: "buildwe"'), "audio responses do not leak the vendor name");
  assert.ok(image.includes('provider: "buildwe"'), "image responses do not leak the vendor name");
});

await run("the adapter is catalog-driven: chain + availability, no new vendors", () => {
  const adapter = src("lib/ai/adapter.ts");
  assert.ok(adapter.includes("export function availableFor"), "availability is centralized");
  assert.ok(adapter.includes("export function chainFor"), "fallback chains are centralized");
  assert.ok(adapter.includes("export const runChat"), "chat is a named capability runner");
  assert.ok(adapter.includes("export const runImage"), "image is a named capability runner");
  assert.ok(adapter.includes("export const runAudio"), "audio is a named capability runner");
  assert.ok(adapter.includes("modelChain"), "chains come from the catalog, not a per-feature list");
  assert.equal(adapter.includes("api.openai.com"), false, "the adapter does not own vendor URLs");
  assert.ok(adapter.includes("availableProvidersFor"), "availability is one function over the provider config");
  const cfg = src("lib/ai/provider-config.ts");
  assert.ok(cfg.includes('resolveCapability(capability)'), "agent aliases code rather than duplicating models");
  assert.equal(cfg.includes("api.openai.com"), false, "readiness does not embed vendor URLs");
});

await run("audio walks the catalog instead of a hardcoded vendor list", () => {
  const providers = src("lib/ai/providers.ts");
  assert.ok(providers.includes("export function availableAudioProviders"), "audio availability is exported");
  assert.ok(providers.includes('capability: "audio"'), "TTS selection reads the audio catalog");
  assert.ok(providers.includes("ELEVENLABS_VOICE_IDS"), "ElevenLabs uses its own voice ids, not OpenAI names");
  assert.ok(providers.includes("pollinationsTTS"), "the keyless fallback is still a real adapter");
  assert.match(
    providers,
    /type: \"browser-tts\"[\s\S]*live: false/,
    "browser TTS is reported as offline so the credit refund stays honest"
  );
});

await run("the agent loop asks the adapter for its code chain", () => {
  const agent = src("lib/ai/agent.ts");
  assert.ok(agent.includes('from "@/lib/ai/adapter"'), "agent does not rebuild the chain itself");
  assert.ok(agent.includes("chainFor("), "one function, same fallback policy as chat/code");
  assert.ok(agent.includes("completeVia"), "steps still go through the provider registry");
});

await run("models discovery uses availableFor per capability", () => {
  const route = src("app/api/ai/models/route.ts");
  assert.ok(route.includes("availableFor(cap, userKeys)"), "image/audio/stt readiness is not chat's key list");
  assert.ok(route.includes('from "@/lib/ai/adapter"'), "the sheet and the gateway share one availability function");
});

process.exit(report("adapter + four-feature wiring") ? 1 : 0);
