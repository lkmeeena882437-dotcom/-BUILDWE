#!/usr/bin/env node
/**
 * Public surfaces against the repository.
 *
 * The README is what a stranger sees on GitHub. It must describe the product,
 * not the internals: no API map, no env-var cookbook, no test-suite table that
 * doubles as a route inventory. Route files and suites are still checked here
 * so they cannot drift from disk — they are just not published in README.md.
 *
 * Run: npm run test:docs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routesOnDisk(dir = path.join(ROOT, "app", "api"), base = "/api") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...routesOnDisk(full, `${base}/${name}`));
      continue;
    }
    if (name !== "route.ts") continue;
    const src = readFileSync(full, "utf8");
    const methods = METHODS.filter(
      (m) =>
        new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src) ||
        new RegExp(`export\\s+const\\s+${m}\\b`).test(src)
    );
    out.push({
      file: path.relative(ROOT, full),
      route: base,
      methods,
    });
  }
  return out;
}

const disk = routesOnDisk();
const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");

await run("the README is product-facing, not an internal runbook", async () => {
  assert.ok(/BUILDWE/i.test(readme), "README still names the product");
  assert.ok(/## Features/i.test(readme), "README has a Features section");
  assert.ok(/## Roadmap/i.test(readme), "README has a Roadmap section");
  assert.equal(readme.includes("## API map"), false, "do not publish an API map");
  assert.equal(readme.includes("## Tests"), false, "do not publish the suite table");
  assert.equal(/\/api\//.test(readme), false, "README must not list /api/ routes");
  const leaks = [];
  for (const needle of [
    "GROQ_API_KEY",
    "SESSION_SECRET",
    "SUPABASE_SERVICE_ROLE",
    "RAZORPAY_KEY_SECRET",
    "gsk_",
    "scrypt",
    "lib/ai/offline-brain",
    "docs/AI_BACKEND",
    "docs/ENV_VARIABLES",
    "docs/KEYS_SETUP",
    "docs/SETUP_GUIDE",
    "docs/PROJECT_BRAIN",
    "audit C1",
    "Wave 0",
  ]) {
    if (readme.includes(needle)) leaks.push(needle);
  }
  assert.deepEqual(leaks, [], `README leaked internals: ${leaks.join(", ")}`);
});

await run("operator markdown is not tracked on the public clone", async () => {
  const listed = execFileSync("git", ["ls-files", "docs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const md = listed
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.endsWith(".md"));
  assert.deepEqual(md, [], `tracked docs/*.md must be empty, got ${md.join(", ")}`);

  // The point of this check is that operator notes are never published in the
  // public clone. It used to ALSO require the files on disk — which a clone can
  // never satisfy, because .gitignore is what keeps them out in the first place.
  // That made the suite permanently red in CI. Assert the durable rule instead:
  // the ignore rule exists, and any copy present locally stays untracked.
  const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(
    ignore,
    /^\/docs\/\*\.md$/m,
    "the ignore rule is what keeps operator notes off the public clone"
  );
  const present = ["AI_BACKEND.md", "ENV_VARIABLES.md", "KEYS_SETUP.md", "SETUP_GUIDE.md"].filter(
    (n) => existsSync(path.join(ROOT, "docs", n))
  );
  for (const name of present) {
    assert.equal(
      md.includes(`docs/${name}`),
      false,
      `${name} is on disk for operators and must stay untracked`
    );
  }
});

await run("the README promises no demo mode", async () => {
  const lower = readme.toLowerCase();
  for (const phrase of ["demo mode", "demo text", "mock ", "fake ", "placeholder response"]) {
    assert.equal(lower.includes(phrase), false, `"${phrase}" is not what this app does — say what it does instead`);
  }
  for (const m of lower.match(/\b[a-z ]{0,30}demo\b/g) || []) {
    assert.ok(/no\b|without\b|never\b|removed/.test(m), `"${m.trim()}" reads like a claim that a demo path exists`);
  }
});

await run("every route file still exports a real HTTP handler", async () => {
  assert.ok(
    disk.length >= 40,
    `found ${disk.length} route files — a walk that lost app/api would be a green test doing nothing`
  );
  const mute = disk.filter((r) => r.methods.length === 0).map((r) => r.route);
  assert.deepEqual(mute, [], "a route.ts with no GET/POST/… is a file the framework will never call");
});

await run("no suite is orphaned between npm test and CI", async () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const scripts = Object.keys(pkg.scripts).filter((k) => k.startsWith("test:"));
  for (const s of scripts) {
    const file = pkg.scripts[s].replace(/^node\s+/, "").trim();
    assert.ok(existsSync(path.join(ROOT, file)), `${s} points at ${file}, which does not exist`);
  }
  const chain = new Set([...pkg.scripts.test.matchAll(/npm run (test:[a-z]+)/g)].map((m) => m[1]));
  const ciPath = path.join(ROOT, "docs", "ci", "github-actions.ci.yml");
  const ci = readFileSync(ciPath, "utf8");
  const orphaned = scripts.filter((k) => !chain.has(k) && !ci.includes(`npm run ${k}`)).sort();
  assert.deepEqual(orphaned, [], "either in the chain or named in the workflow — otherwise it quietly stops being run");
  assert.ok(ci.includes("actions/checkout@v4"), "the workflow file is still a real workflow draft");
});

await run("metadata resolves absolute URLs and pages self-reference", () => {
  const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
  // Without metadataBase, Next resolves every relative `alternates.canonical`
  // against localhost:3000 — /tools shipped <link rel="canonical" href="/tools">.
  assert.match(layout, /metadataBase: new URL\(SITE\)/, "metadataBase must be set from SITE");
  // A canonical in the ROOT layout is inherited by every page that lacks one.
  // In #20 that made /pricing, /about and 13 others each claim to be "/" and
  // ask crawlers to drop them. The root may only declare "/" while EVERY other
  // public route declares its own — so the guard is on that invariant, not on
  // the root key's absence.
  const meta = layout.slice(layout.indexOf("export const metadata"));
  const rootCanonical = meta
    .slice(0, meta.indexOf("openGraph"))
    .match(/alternates:\s*\{\s*canonical:\s*"([^"]*)"/);
  if (rootCanonical) {
    assert.equal(rootCanonical[1], "/", "the root canonical may only ever be \"/\"");
    const pages = readdirSync(path.join(ROOT, "app"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("_"))
      .map((d) => d.name)
      // Route groups that are not public marketing pages set their own rules.
      .filter((n) => !["api", "dev", "s", "print", "reset", "verify", "studios", "tools"].includes(n))
      .filter((n) => existsSync(path.join(ROOT, "app", n, "page.tsx")));
    for (const name of pages) {
      const own =
        readFileSync(path.join(ROOT, "app", name, "page.tsx"), "utf8") +
        (existsSync(path.join(ROOT, "app", name, "layout.tsx"))
          ? readFileSync(path.join(ROOT, "app", name, "layout.tsx"), "utf8")
          : "");
      assert.match(
        own,
        new RegExp(`canonical: "/${name}"`),
        `/${name} must set its own canonical or it silently inherits "/"`
      );
    }
  }
  assert.equal(/url: "https:\/\//.test(meta), false, "og:url must come from SITE, not a literal");
  for (const page of ["about", "help", "terms", "privacy", "security"]) {
    const f = path.join(ROOT, `app/${page}/page.tsx`);
    if (!existsSync(f)) continue;
    assert.match(
      readFileSync(f, "utf8"),
      new RegExp(`canonical: "/${page}"`),
      `${page} must self-reference`
    );
  }
});

await run("a render crash and a bad URL both stay inside the product", () => {
  const err = readFileSync(path.join(ROOT, "app/error.tsx"), "utf8");
  assert.match(err, /^"use client"/, "an error boundary must be a client component");
  assert.match(err, /reset/, "the user needs a way to retry");
  // React redacts the message in production; showing it would leak internals.
  assert.equal(/\{error\.message\}/.test(err), false, "never render the raw error message");
  const nf = readFileSync(path.join(ROOT, "app/not-found.tsx"), "utf8");
  assert.match(nf, /robots:\s*\{\s*index: false/, "a 404 must not be indexed");
  assert.match(nf, /href="\/"/, "a 404 needs a route back");
});

await run("the Open Graph card has no runtime dependency", () => {
  const og = readFileSync(path.join(ROOT, "app/opengraph-image.tsx"), "utf8");
  assert.match(og, /export const size = \{ width: 1200, height: 630 \}/, "OG cards are 1200x630");
  assert.match(og, /contentType = "image\/png"/, "must declare the type");
  // A webfont here would make every social share depend on fonts.googleapis.com
  // at render time, so a font outage turns unfurls into 500s.
  // Strip comments first — the file explains this rule in prose, and matching
  // its own documentation would be a test that passes for the wrong reason.
  const code = og.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/fetch\(/.test(code), false, "the OG image must not fetch anything at render");
  assert.equal(/googleapis|\.woff|\.ttf/.test(code), false, "no external font may be loaded");
});

await run("the rate-limit cleanup is actually scheduled", () => {
  const schema = readFileSync(path.join(ROOT, "supabase/schema.sql"), "utf8");
  // The function existed since the hardening pass but nothing ran it, so
  // buildwe_rate_limits grew forever.
  assert.match(schema, /create or replace function buildwe_rate_cleanup/, "the function must exist");
  // Strip SQL comments: the job name is documented in prose above the call, so
  // matching the raw file would pass even if the schedule itself were deleted.
  const sql = schema.replace(/^\s*--.*$/gm, "");
  assert.match(sql, /cron\.schedule\(/, "…and something must schedule it");
  // A NAMED job is what makes re-running this file update rather than stack
  // duplicate schedules.
  assert.match(
    sql,
    /cron\.schedule\(\s*'buildwe-rate-cleanup'/,
    "the schedule must pass a job name as its first argument"
  );
  // Must not hard-fail a project without pg_cron installed.
  assert.match(
    schema,
    /pg_extension where extname = 'pg_cron'/,
    "the schedule must be guarded so the file still runs without pg_cron"
  );
  assert.match(schema, /buildwe_rate_cleanup\(\);/, "the job must call the cleanup function");
});

process.exit(report("README · tracked docs · suites") ? 1 : 0);
