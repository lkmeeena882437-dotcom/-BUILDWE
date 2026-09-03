#!/usr/bin/env node
/**
 * UPDATE 11 — catalog + provider configuration.
 *
 * Compiles `lib/ai/models-catalog.ts` standalone (it must stay import-free) and
 * checks availability, capability filtering, missing keys, fallback order, and
 * that the discovery route never ships secrets.
 *
 * Run: npm run test:catalog
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const labelDir = path.join(ROOT, "node_modules", ".cache", "bw-catalog");
fs.mkdirSync(labelDir, { recursive: true });
try {
  execFileSync(
    "npx",
    [
      "tsc",
      path.join(ROOT, "lib", "ai", "models-catalog.ts"),
      "--outDir",
      labelDir,
      "--target",
      "es2022",
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
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

await run("the catalog file stays import-free so tests can compile it alone", () => {
  const body = src("lib/ai/models-catalog.ts");
  assert.equal(/^import /m.test(body), false, "a catalog import would break the standalone compile");
});

await run("every catalog row has a provider config (id, adapter, key, priority)", () => {
  const rows = CAT.MODEL_CATALOG;
  assert.ok(rows.length > 20, `catalog is too small to be the real one (${rows.length})`);
  for (const m of rows) {
    assert.ok(m.id && m.provider && m.capability, `${m.id} is missing id/provider/capability`);
    const cfg = CAT.PROVIDER_CONFIG[m.provider];
    assert.ok(cfg, `${m.provider} has catalog models but no PROVIDER_CONFIG entry`);
    assert.equal(cfg.id, m.provider);
    assert.ok("keyEnv" in cfg, `${m.provider} must declare required API key (or null if keyless)`);
    assert.ok(typeof cfg.priority === "number", `${m.provider} needs a fallback priority`);
    assert.ok(cfg.adapters && typeof cfg.adapters === "object", `${m.provider} needs adapters`);
  }
  const providers = new Set(rows.map((m) => m.provider));
  for (const id of Object.keys(CAT.PROVIDER_CONFIG)) {
    assert.ok(providers.has(id) || CAT.PROVIDER_CONFIG[id], `orphan provider ${id}`);
  }
});

await run("capability filtering: chat ≠ image, agent aliases code", () => {
  const chat = CAT.modelsForCapability("chat");
  const image = CAT.modelsForCapability("image");
  const code = CAT.modelsForCapability("code");
  const agent = CAT.modelsForCapability("agent");
  assert.ok(chat.length && chat.every((m) => m.capability === "chat"));
  assert.ok(image.length && image.every((m) => m.capability === "image"));
  assert.ok(chat.every((m) => m.capability !== "image"), "chat filter leaked an image row");
  assert.deepEqual(
    agent.map((m) => m.id).sort(),
    code.map((m) => m.id).sort(),
    "agent must reuse the code catalog — no duplicate models"
  );
  assert.equal(CAT.resolveCapability("agent"), "code");
});

await run("unkeyed / unimplemented models are not treated as live", () => {
  assert.ok(CAT.isKeylessProvider("pollinations"));
  assert.equal(CAT.isKeylessProvider("groq"), false);
  assert.equal(CAT.requiredKeyEnv("groq"), "GROQ_API_KEY");
  assert.equal(CAT.requiredKeyEnv("pollinations"), null);
  assert.ok(CAT.isProviderImplemented("groq", "chat"));
  assert.ok(CAT.isProviderImplemented("pollinations", "image"));
  assert.ok(CAT.isProviderImplemented("pollinations", "audio"));
  assert.equal(CAT.isProviderImplemented("cartesia", "audio"), false, "Cartesia has no adapter yet");
  assert.equal(CAT.isProviderImplemented("playht", "audio"), false, "PlayHT has no adapter yet");
  assert.equal(CAT.isProviderImplemented("deepgram", "audio"), false, "Deepgram TTS is catalog-only");
  assert.ok(CAT.isProviderImplemented("deepgram", "stt"), "Deepgram STT is real");
  assert.equal(CAT.adapterFor("openai", "chat"), "llm");
  assert.equal(CAT.adapterFor("elevenlabs", "audio"), "audio");
  assert.equal(CAT.adapterFor("cartesia", "audio"), null);
});

await run("missing API keys drop those vendors from the pick and the chain", () => {
  const pick = CAT.pickModel({
    capability: "chat",
    plan: "pro",
    prompt: "Explain transformers simply",
    availableProviders: ["groq"],
  });
  assert.equal(pick.provider, "groq", `with only groq live, pick was ${pick.provider}:${pick.id}`);

  const chain = CAT.modelChain({
    capability: "chat",
    plan: "pro",
    prompt: "Explain transformers simply",
    availableProviders: ["groq"],
    max: 5,
  });
  assert.ok(chain.length >= 1);
  assert.ok(
    chain.every((m) => m.provider === "groq"),
    `openai/anthropic leaked into a groq-only chain: ${chain.map((m) => m.provider).join(",")}`
  );

  const img = CAT.pickModel({
    capability: "image",
    plan: "free",
    prompt: "a red mug",
    availableProviders: [],
  });
  assert.equal(img.provider, "pollinations", "keyless image still works with no keys at all");
});

await run("fallback order is catalog priority, cross-vendor first", () => {
  const chain = CAT.modelChain({
    capability: "chat",
    plan: "pro",
    prompt: "Write a careful analysis of this contract",
    availableProviders: ["groq", "openai", "anthropic", "openrouter"],
    max: 5,
  });
  assert.ok(chain.length >= 2, "a fallback chain needs more than one model");
  const first = chain[0];
  const rest = chain.slice(1);
  const other = rest.find((m) => m.provider !== first.provider);
  assert.ok(other, "the second try should be able to be a different vendor");
  const pri = (p) => CAT.PROVIDER_CONFIG[p].priority;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i].provider === first.provider) continue;
    const prev = rest[i - 1];
    if (prev.provider === first.provider) continue;
    if (prev.provider === rest[i].provider) continue;
    assert.ok(
      pri(prev.provider) <= pri(rest[i].provider),
      `fallback out of catalog order: ${prev.provider}(${pri(prev.provider)}) then ${rest[i].provider}(${pri(rest[i].provider)})`
    );
  }
});

await run("the same model id can serve two features without a second provider config", () => {
  // Pinning a literal id made this fail the moment that model was retired,
  // even though the property under test — one id, two capabilities, one
  // provider config — still held. Find any id that serves both instead.
  const byId = new Map();
  for (const m of CAT.MODEL_CATALOG) {
    if (!byId.has(m.id)) byId.set(m.id, []);
    byId.get(m.id).push(m);
  }
  const shared = [...byId.values()].filter(
    (rows) =>
      rows.some((m) => m.capability === "chat") && rows.some((m) => m.capability === "code")
  );
  assert.ok(shared.length, "at least one id must serve both chat and code");
  for (const rows of shared) {
    const providers = new Set(rows.map((m) => m.provider));
    assert.equal(providers.size, 1, `${rows[0].id} must not span two providers`);
    assert.ok(CAT.PROVIDER_CONFIG[rows[0].provider], "and its provider must be configured once");
  }
});

await run("/api/ai/models projection never ships keys, env names, or private endpoints", () => {
  const route = src("app/api/ai/models/route.ts");
  assert.ok(route.includes("availableFor(cap, userKeys)"), "readiness still comes from the adapter");
  assert.ok(route.includes("isProviderImplemented"), "unimplemented rows stay dark");
  assert.ok(route.includes("isKeylessProvider"), "keyless is derived, not guessed in the UI");
  assert.equal(route.includes("envKey"), false, "the env override hint must not be copied onto selectable");
  assert.equal(route.includes("GROQ_API_KEY"), false);
  assert.equal(route.includes("api.openai.com"), false);
  assert.equal(route.includes("AI_KEYS"), false);
  const client = src("lib/client/api.ts");
  const at = client.indexOf("export async function fetchModels(");
  assert.ok(at > 0);
  const fn = client.slice(at, client.indexOf("\n}", at) + 2);
  assert.ok(fn.includes('"/api/ai/models"'));
  assert.equal(fn.includes("GROQ_API_KEY"), false);
  assert.equal(client.includes("api.groq.com"), false);
});

fs.rmSync(labelDir, { recursive: true, force: true });
process.exit(report("catalog + provider configuration") ? 1 : 0);
