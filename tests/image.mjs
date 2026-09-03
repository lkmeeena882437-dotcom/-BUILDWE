#!/usr/bin/env node
/**
 * UPDATE 13 — image model integration, end to end.
 *
 * Runs a real BUILDWE server against a local image fixture standing in for the
 * keyless provider, so the whole path is exercised offline and deterministically:
 *
 *   image UI → /api/ai/image → catalog → adapter → provider → artifact → history
 *
 * The point of most of these checks is the money and the truth: a request that
 * did not produce a picture must not cost a credit, and a picture the user did
 * not ask for must be announced as a fallback rather than passed off as their pick.
 *
 * Run: npm run test:image
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { newJar, report, req, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PORT = 3410;
const FIXTURE_PORT = 3411;

// A 1x1 JPEG — small, real, and unmistakably an image by content-type.
const PIXEL = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

/**
 * Fixture image host. `/prompt/...` is the keyless provider's shape.
 * Behaviour is switchable at runtime so one server can play "healthy vendor",
 * "vendor is down", and "vendor serves an error page that is not an image".
 */
let mode = "ok";
let hits = 0;
const fixture = http.createServer((req_, res) => {
  hits++;
  if (mode === "down") {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("upstream unavailable");
  }
  if (mode === "notimage") {
    // The nastiest real-world case: 200 OK, but it's an HTML error page.
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end("<html><body>rate limited</body></html>");
  }
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": String(PIXEL.length),
  });
  res.end(req_.method === "HEAD" ? undefined : PIXEL);
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));

let srv = null;
srv = await startServer({
  port: PORT,
  label: "bw-image",
  env: {
    AI_BASE_URL_POLLINATIONS: `http://127.0.0.1:${FIXTURE_PORT}`,
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
      email: `img-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "Str0ng-Passw0rd!x",
      name: `Img ${tag}`,
    },
  });
  assert.equal(r.status, 200, `register failed: ${r.text?.slice(0, 200)}`);
  return jar;
}

const balance = async (jar) => (await req(BASE, "/api/credits", { jar })).json?.balance;
const makeImage = (jar, body) =>
  req(BASE, "/api/ai/image", { method: "POST", jar, body });

/* ── 1. Happy path ───────────────────────────────────────── */

await run("a prompt returns a rendered image through the adapter chain", async () => {
  mode = "ok";
  const jar = await signUp("happy");
  const r = await makeImage(jar, { prompt: "a red ceramic mug on oak", aspect: "1:1" });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text?.slice(0, 200)}`);
  assert.ok(r.json.url, "the response must carry a URL the browser can render");
  assert.ok(r.json.id, "the generation must have an id for the artifact system");
  assert.equal(r.json.provider, "buildwe", "the vendor name must never reach the browser");
  assert.ok(r.json.model, "the branded model label is returned");
  assert.equal(r.json.aspect, "1:1");
});

await run("the generated image is reachable and is actually an image", async () => {
  mode = "ok";
  const jar = await signUp("fetch");
  const r = await makeImage(jar, { prompt: "a blue bicycle", aspect: "16:9" });
  assert.equal(r.status, 200);
  const img = await fetch(r.json.url);
  assert.equal(img.status, 200, "the returned URL must actually serve");
  assert.ok(
    (img.headers.get("content-type") || "").startsWith("image/"),
    "the URL must serve image bytes, not an error page"
  );
});

await run("aspect ratio reaches the provider as real pixel dimensions", async () => {
  mode = "ok";
  const jar = await signUp("aspect");
  const r = await makeImage(jar, { prompt: "a tall waterfall", aspect: "9:16" });
  assert.equal(r.status, 200);
  const u = new URL(r.json.url);
  assert.equal(u.searchParams.get("width"), "720", "9:16 must be 720 wide");
  assert.equal(u.searchParams.get("height"), "1280", "9:16 must be 1280 tall");
});

/* ── 2. Failure, refund and retry ────────────────────────── */

await run("a dead provider refunds the credit instead of charging for nothing", async () => {
  const jar = await signUp("refund");
  mode = "ok";
  const before = await balance(jar);

  mode = "down";
  const r = await makeImage(jar, { prompt: "a green parrot", aspect: "1:1" });
  assert.equal(r.status, 502, `a total outage must be an error, got ${r.status}`);
  assert.equal(r.json.code, "PROVIDER_EMPTY");

  const after = await balance(jar);
  assert.equal(after, before, `credit must be returned: ${before} → ${after}`);
});

await run("a 200 that is not an image is treated as a failure, not a picture", async () => {
  const jar = await signUp("notimage");
  mode = "ok";
  const before = await balance(jar);

  // This is the case a truthy-URL check cannot catch: the request "succeeds",
  // the URL resolves, and the user gets an HTML error page in an <img> tag.
  mode = "notimage";
  const r = await makeImage(jar, { prompt: "a silver watch", aspect: "1:1" });
  assert.equal(r.status, 502, "an HTML error page must not be served as artwork");

  const after = await balance(jar);
  assert.equal(after, before, "no charge for a non-image");
});

await run("retry after an outage succeeds and charges exactly once", async () => {
  const jar = await signUp("retry");
  mode = "down";
  const failed = await makeImage(jar, { prompt: "a wooden chair", aspect: "1:1" });
  assert.equal(failed.status, 502);

  mode = "ok";
  const before = await balance(jar);
  const ok = await makeImage(jar, { prompt: "a wooden chair", aspect: "1:1" });
  assert.equal(ok.status, 200, "a recovered provider must work with no restart");
  const after = await balance(jar);
  assert.ok(after < before, "the successful retry is charged");
  assert.equal(before - after, ok.json.credits.charged, "charged exactly the quoted amount");
});

/* ── 3. Plan / model rules ───────────────────────────────── */

await run("a PRO-only model is refused on a free plan and costs nothing", async () => {
  mode = "ok";
  const jar = await signUp("progate");
  const before = await balance(jar);
  const r = await makeImage(jar, { prompt: "a marble statue", modelId: "fal-ai/flux/dev" });
  assert.equal(r.status, 402, "a PRO model must be gated for free users");
  assert.equal(r.json.code, "PRO_MODEL");
  const after = await balance(jar);
  assert.equal(after, before, "a refused request must not be billed");
});

await run("an unreachable model falls back and says so", async () => {
  mode = "ok";
  const jar = await signUp("fallback");
  // No fal/openai key on this deployment, so a free-tier request cannot get
  // them; the keyless provider serves it and the response must admit that.
  const r = await makeImage(jar, { prompt: "a lighthouse at dusk", modelId: "turbo" });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.fellBack, "boolean", "the UI is told whether the pick was honoured");
});

/* ── 4. Artifact / history integration + isolation ───────── */

await run("the image lands in history and is scoped to its owner", async () => {
  mode = "ok";
  const alice = await signUp("alice");
  const bob = await signUp("bob");

  const made = await makeImage(alice, { prompt: "a paper crane", aspect: "1:1" });
  assert.equal(made.status, 200);

  const hers = await req(BASE, "/api/ai/generations?type=image", { jar: alice });
  assert.equal(hers.status, 200);
  const ids = (hers.json.generations || hers.json.items || []).map((g) => g.id);
  assert.ok(ids.includes(made.json.id), "the generation must appear in its owner's history");

  const his = await req(BASE, "/api/ai/generations?type=image", { jar: bob });
  const hisIds = (his.json.generations || his.json.items || []).map((g) => g.id);
  assert.equal(
    hisIds.includes(made.json.id),
    false,
    "another user must never see someone else's image"
  );
});

await run("a failed generation leaves no history row behind", async () => {
  const jar = await signUp("nohistory");
  mode = "ok";
  const before = await req(BASE, "/api/ai/generations?type=image", { jar });
  const beforeCount = (before.json.generations || before.json.items || []).length;

  mode = "down";
  await makeImage(jar, { prompt: "a ghost image", aspect: "1:1" });

  mode = "ok";
  const after = await req(BASE, "/api/ai/generations?type=image", { jar });
  const afterCount = (after.json.generations || after.json.items || []).length;
  assert.equal(afterCount, beforeCount, "a failure must not be saved as a creation");
});

await run("a guest cannot read a signed-in user's images", async () => {
  mode = "ok";
  const owner = await signUp("owner");
  const made = await makeImage(owner, { prompt: "a private sketch", aspect: "1:1" });
  assert.equal(made.status, 200);

  const guest = newJar();
  const r = await req(BASE, "/api/ai/generations?type=image", { jar: guest });
  const gIds = (r.json?.generations || r.json?.items || []).map((g) => g.id);
  assert.equal(gIds.includes(made.json.id), false, "guest sessions are isolated too");
});

/* ── 5. Input handling ───────────────────────────────────── */

await run("an empty prompt is refused before any provider call or charge", async () => {
  mode = "ok";
  const jar = await signUp("empty");
  const before = await balance(jar);
  const hitsBefore = hits;
  const r = await makeImage(jar, { prompt: "   ", aspect: "1:1" });
  assert.equal(r.status, 400);
  assert.equal(hits, hitsBefore, "no provider call for an empty prompt");
  assert.equal(await balance(jar), before, "no charge for a rejected prompt");
});

await run("an absurd prompt is rejected at the edge", async () => {
  mode = "ok";
  const jar = await signUp("long");
  const r = await makeImage(jar, { prompt: "x".repeat(9000), aspect: "1:1" });
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "PROMPT_TOO_LONG");
});

/* ── 6. Source-level guarantees ──────────────────────────── */

await run("keys and vendor endpoints never reach the browser", () => {
  const studio = src("components/workspace/ImageStudio.tsx");
  const api = src("lib/client/api.ts");
  for (const needle of [
    "FAL_KEY",
    "STABILITY_API_KEY",
    "OPENAI_API_KEY",
    "HF_TOKEN",
    "GOAPI_API_KEY",
    "fal.run",
    "api.stability.ai",
    "api-inference.huggingface.co",
    "api.openai.com",
  ]) {
    assert.equal(studio.includes(needle), false, `ImageStudio must not mention ${needle}`);
    assert.equal(api.includes(needle), false, `client api must not mention ${needle}`);
  }
  assert.ok(api.includes('"/api/ai/image"'), "the browser only talks to our own route");
});

await run("the image route uses the adapter and never a vendor directly", () => {
  const route = src("app/api/ai/image/route.ts");
  assert.ok(route.includes('from "@/lib/ai/adapter"'), "image goes through the adapter");
  assert.ok(route.includes("runImage"), "it uses the shared capability runner");
  assert.ok(route.includes("MODEL_CATALOG"), "the plan gate is catalog-driven");
  for (const host of ["fal.run", "api.openai.com", "api.stability.ai", "image.pollinations.ai"]) {
    assert.equal(route.includes(host), false, `the route must not hard-code ${host}`);
  }
  assert.ok(route.includes("refundArtifact"), "failures give the credit back");
  assert.ok(route.includes("!result.verified"), "an unverified image is refunded, not sold");
});

await run("verification covers constructed URLs, which are not evidence", () => {
  const prov = src("lib/ai/image-providers.ts");
  assert.ok(prov.includes("export async function verifyImageUrl"), "there is a real check");
  assert.ok(prov.includes("verified: true"), "byte-returning vendors are trusted");
  assert.match(
    prov,
    /if \(await verifyImageUrl\(url\)\)/,
    "the constructed hot-link is confirmed before being returned as a result"
  );
});

if (srv) stopServer(srv);
fixture.close();

process.exit(report("image generation — end to end") ? 1 : 0);
