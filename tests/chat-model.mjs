#!/usr/bin/env node
/**
 * UPDATE 12 — chat AI model integration.
 *
 * Compiles `lib/ai/model-chain.ts` (plus the catalog it reads) and checks the
 * behaviour the chat route now depends on: only reachable models are attempted,
 * the operator override and routing policy are respected, off-catalog legacy ids
 * stay a last resort, and a failing model is benched instead of being retried
 * first on every request.
 *
 * Run: npm run test:chat-model
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const outDir = path.join(ROOT, "node_modules", ".cache", "bw-chat-model");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const cfgPath = path.join(outDir, "tsconfig.json");
fs.writeFileSync(
  cfgPath,
  JSON.stringify({
    compilerOptions: {
      outDir,
      rootDir: ROOT,
      target: "es2022",
      module: "commonjs",
      moduleResolution: "node",
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      baseUrl: ROOT,
      paths: { "@/*": ["./*"] },
    },
    files: [path.join(ROOT, "lib/ai/model-chain.ts")],
  })
);

try {
  execFileSync(path.join(ROOT, "node_modules", ".bin", "tsc"), ["-p", cfgPath], {
    cwd: ROOT,
    stdio: "pipe",
  });
} catch (e) {
  console.error(
    "could not compile lib/ai/model-chain.ts\n",
    e.stdout?.toString(),
    e.stderr?.toString()
  );
  process.exit(1);
}

// tsc type-checks `@/*` but does not rewrite it in the emit. Point the compiled
// requires at the sibling files so the module can be loaded here.
for (const rel of ["lib/ai/model-chain.js", "lib/ai/models-catalog.js"]) {
  const f = path.join(outDir, rel);
  if (!fs.existsSync(f)) continue;
  fs.writeFileSync(
    f,
    fs.readFileSync(f, "utf8").replace(/require\("@\/([^"]+)"\)/g, (_m, p) =>
      `require(${JSON.stringify(path.relative(path.dirname(f), path.join(outDir, p)).replace(/\\/g, "/").replace(/^(?!\.)/, "./"))})`
    )
  );
}

const req = createRequire(path.join(ROOT, "noop.cjs"));
const CHAIN = req(path.join(outDir, "lib/ai/model-chain.js"));
const CAT = req(path.join(outDir, "lib/ai/models-catalog.js"));

const idsFor = (cap) =>
  new Set(CAT.MODEL_CATALOG.filter((m) => m.capability === cap).map((m) => m.id));
const rowsFor = (cap, provider) =>
  CAT.MODEL_CATALOG.filter((m) => m.capability === cap && m.provider === provider);

const base = {
  capability: "chat",
  plan: "free",
  prompt: "explain how a hash map works",
  availableProviders: ["groq"],
};

const build = (o = {}) => {
  CHAIN.resetModelHealth();
  return CHAIN.buildChatChain({ ...base, ...o });
};

await run("the chain only offers models this deployment can actually call", () => {
  const { models } = build({ availableProviders: ["groq"] });
  assert.ok(models.length, "a keyed deployment must produce a chain");
  const chat = idsFor("chat");
  for (const id of models) {
    assert.ok(chat.has(id), `${id} is not a chat model in the catalog`);
    const row = CAT.MODEL_CATALOG.find((m) => m.id === id && m.capability === "chat");
    assert.equal(row.provider, "groq", `${id} needs a vendor key this deployment does not have`);
  }
});

await run("free plan never gets a pro-only model", () => {
  const providers = Array.from(new Set(CAT.MODEL_CATALOG.map((m) => m.provider)));
  const { models } = build({ plan: "free", availableProviders: providers });
  for (const id of models) {
    const row = CAT.MODEL_CATALOG.find((m) => m.id === id && m.capability === "chat");
    assert.ok(row.tiers.includes("free"), `${id} is not in the free pool`);
  }
});

await run("the operator's env override leads — but only when reachable", () => {
  const groqChat = rowsFor("chat", "groq")[0];
  assert.ok(groqChat, "catalog must have a groq chat model for this check");
  const led = build({ availableProviders: ["groq"], envModel: groqChat.id, plan: "pro" });
  assert.equal(led.models[0], groqChat.id, "a reachable override must be attempted first");

  // Same override, no groq key: it must be dropped rather than wasting attempt #1.
  const openaiChat = rowsFor("chat", "openai")[0];
  if (openaiChat) {
    const dropped = build({ availableProviders: ["openai"], envModel: groqChat.id, plan: "pro" });
    assert.equal(
      dropped.models.includes(groqChat.id),
      false,
      "an unreachable override must not be attempted"
    );
    assert.ok(dropped.models.length, "dropping the override still leaves a usable chain");
  }
});

await run("off-catalog legacy ids are a last resort, never ahead of the catalog", () => {
  const legacy = ["gemma2-9b-it"];
  assert.equal(
    idsFor("chat").has("gemma2-9b-it"),
    false,
    "this check assumes gemma2-9b-it is NOT a catalog row"
  );
  const keyed = build({ availableProviders: ["groq"], legacy });
  assert.equal(
    keyed.models.includes("gemma2-9b-it"),
    false,
    "a catalog chain exists — the legacy id must not be attempted"
  );

  // Nothing reachable at all: the legacy list is better than an empty chain.
  const bare = build({ availableProviders: [], legacy });
  assert.deepEqual(bare.models, legacy, "with no reachable vendor, legacy is the fallback");
});

await run("a forced model is honoured exactly — no fallbacks, no benching", () => {
  CHAIN.resetModelHealth();
  CHAIN.noteModelFailure("forced-x");
  CHAIN.noteModelFailure("forced-x");
  const { models } = CHAIN.buildChatChain({ ...base, forceModel: "forced-x" });
  assert.deepEqual(models, ["forced-x"], "comparison lanes must answer as the model they named");
});

await run("preferOffset skips the leading model for 'use another model'", () => {
  const first = build({ availableProviders: ["groq"] }).models;
  if (first.length > 1) {
    const second = build({ availableProviders: ["groq"], preferOffset: 1 }).models;
    assert.notEqual(second[0], first[0], "the retry must not re-run the model that just answered");
    assert.equal(second[0], first[1]);
  }
});

await run("two failures bench a model; one does not", () => {
  CHAIN.resetModelHealth();
  const id = rowsFor("chat", "groq")[0].id;
  CHAIN.noteModelFailure(id);
  assert.equal(CHAIN.isCoolingDown(id), false, "a single blip is not an outage");
  CHAIN.noteModelFailure(id);
  assert.equal(CHAIN.isCoolingDown(id), true, "a repeatedly dead model must be benched");
  CHAIN.noteModelSuccess(id);
  assert.equal(CHAIN.isCoolingDown(id), false, "an answer clears the strikes immediately");
});

await run("a benched model drops to the back of the chain, never out of it", () => {
  CHAIN.resetModelHealth();
  const full = CHAIN.buildChatChain({ ...base, availableProviders: ["groq"] }).models;
  if (full.length > 1) {
    CHAIN.noteModelFailure(full[0]);
    CHAIN.noteModelFailure(full[0]);
    const cooled = CHAIN.buildChatChain({ ...base, availableProviders: ["groq"] });
    assert.notEqual(cooled.models[0], full[0], "the dead model must not lead again");
    assert.equal(
      cooled.models.at(-1),
      full[0],
      "it stays available at the back — cooldown is an optimisation, not a removal"
    );
    assert.deepEqual(cooled.cooling, [full[0]], "health is reported for /api/health");
  }

  // Every model benched → the chain must still be attempted, not emptied.
  CHAIN.resetModelHealth();
  for (const id of full) {
    CHAIN.noteModelFailure(id);
    CHAIN.noteModelFailure(id);
  }
  const allCold = CHAIN.buildChatChain({ ...base, availableProviders: ["groq"] });
  assert.deepEqual(
    allCold.models.slice().sort(),
    full.slice().sort(),
    "an all-cold chain must still try every model rather than go offline"
  );
});

await run("cooldown expires on its own", () => {
  CHAIN.resetModelHealth();
  const id = rowsFor("chat", "groq")[0].id;
  const t = Date.now();
  CHAIN.noteModelFailure(id, t);
  CHAIN.noteModelFailure(id, t);
  assert.equal(CHAIN.isCoolingDown(id, t + 1000), true);
  assert.equal(
    CHAIN.isCoolingDown(id, t + CHAIN.COOLDOWN_MS + 1),
    false,
    "a recovered vendor must be retried without a restart"
  );
});

await run("the chat runtime uses the shared chain and records model health", () => {
  const p = src("lib/ai/providers.ts");
  assert.ok(p.includes('from "@/lib/ai/model-chain"'), "chat/code chain is not rebuilt inline");
  assert.ok(p.includes("buildChatChain({"), "one chain builder for chat and code");
  assert.ok(p.includes("noteModelSuccess(model)"), "a working model clears its strikes");
  assert.ok(p.includes("noteModelFailure(model)"), "a failing model is benched for the next request");
  assert.equal(
    /const preferred = \[/.test(p),
    false,
    "the old inline chain assembly must be gone, not duplicated"
  );
});

await run("the chat route still streams through the adapter with BYOK keys", () => {
  const route = src("app/api/ai/chat/route.ts");
  assert.ok(route.includes('from "@/lib/ai/adapter"'), "chat still goes through the adapter");
  assert.ok(route.includes("userProviderKeys(session.userId)"), "BYOK keys still reach the chain");
  assert.ok(route.includes("webSearchDetailed"), "web search grounding is untouched");
  assert.ok(route.includes("conversationId"), "chat history persistence is untouched");
});

process.exit(report("chat model integration") ? 1 : 0);
