#!/usr/bin/env node
/**
 * The README against the repository.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API map in README.md was the only API doc a newcomer would read, and the scan in
 * docs/internal/scan/API-ROUTES.csv counted 44 route files against 24 rows in it: `/api/ai/agent`,
 * `/api/ai/code-action`, `/api/ai/compare`, `/api/credits`, the OAuth and reset routes,
 * `/api/preview`, `/api/projects/files`, `/api/tools`, `/api/user/skills` and `/api/metrics` were
 * simply absent, and the checkout row claimed one method where that file exports two.
 * That is not decoration: a documented-out route is a feature nobody finds, and a README row that
 * lists the wrong method is a bug report waiting to be filed by someone who trusts it.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. every route.ts under app/api on disk has a row whose path matches it exactly
 *      ([id] and [provider] in the doc are wildcards — the same shape Next uses);
 *   2. that row lists every method the file exports, and no method it doesn't (a documented
 *      DELETE that the file never had is worse than a missing row);
 *   3. the word 'demo' is not used as a promise anywhere in this file — this app has no
 *      demo/mock mode, and "demo text" was how the offline brain was being described until
 *      step 11 named it properly;
 *   4. the Tests table and package.json's test:* scripts agree in both directions, every
 *      suite file exists, and no suite is orphaned: anything outside 'npm test' must be named
 *      in the proposed workflow file, so a suite cannot quietly stop being run.
 *
 * Run: npm run test:docs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Every route file on disk, as { file, route, methods }. */
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

/** The README's API map, as rows of { pattern, methods }. */
function rowsInReadme(readme) {
  const start = readme.indexOf("## API map");
  assert.ok(start >= 0, "README has an API map section");
  const rest = readme.slice(start + "## API map".length);
  const section = rest.slice(0, rest.indexOf("\n## "));
  const rows = [];
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    // One row may document more than one route ("POST /a · POST /b"), so every backticked
    // span in it is read — the middle column is a description, and prose there must not
    // be mistaken for a route.
    for (const span of line.match(/`[^`]+`/g) || []) {
      const text = span.slice(1, -1);
      const methods = METHODS.filter((m) => new RegExp(`\\b${m}\\b`).test(text));
      const found = text.match(/\/api\/[^\s`]+/g) || [];
      for (let route of found) {
        route = route.replace(/[).,]+$/, "").split("?")[0];
        rows.push({ pattern: route, methods, text });
      }
    }
  }
  return { rows, section };
}

const toMatch = (pattern) =>
  new RegExp(
    "^" +
      pattern
        .split("/")
        .map((part) =>
          part.startsWith("[") && part.endsWith("]")
            ? "[^/]+"
            : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        )
        .join("/") +
      "$"
  );

/* ── 1–2. every route, and only the methods it has ─────────────────────────── */

const disk = routesOnDisk();
let readme = "";
let parsed = { rows: [], section: "" };

await run("the README knows about every route file", async () => {
  readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  parsed = rowsInReadme(readme);
  assert.ok(disk.length >= 40, `found ${disk.length} route files — a walk that lost app/api would be a green test doing nothing`);
  const missing = disk.filter((r) => !parsed.rows.some((row) => toMatch(row.pattern).test(r.route)));
  assert.deepEqual(
    missing.map((r) => r.route),
    [],
    "undocumented routes (add a row, do not delete the check)"
  );
});

await run("and does not invent verbs for them", async () => {
  const wrong = [];
  for (const r of disk) {
    const rows = parsed.rows.filter((row) => toMatch(row.pattern).test(r.route));
    const claimed = new Set(rows.flatMap((row) => row.methods));
    for (const m of r.methods) if (!claimed.has(m)) wrong.push(`${r.route}: ${m} is exported but not documented`);
    for (const m of claimed) if (!r.methods.includes(m)) wrong.push(`${r.route}: ${m} is documented but not exported`);
  }
  assert.deepEqual(wrong, [], "every verb in the table is a real handler, and every handler has a row");
});

/* ── 3. no promise of a demo path ─────────────────────────────────────────── */

await run("the README promises no demo mode", async () => {
  const lower = readme.toLowerCase();
  for (const phrase of ["demo mode", "demo text", "mock ", "fake ", "placeholder response"]) {
    assert.equal(lower.includes(phrase), false, `"${phrase}" is not what this app does — say what it does instead`);
  }
  // "demo" may only survive as a negation, which is a sentence about its absence.
  for (const m of lower.match(/\b[a-z ]{0,30}demo\b/g) || []) {
    assert.ok(/no\b|without\b|never\b|removed/.test(m), `"${m.trim()}" reads like a claim that a demo path exists`);
  }
});

/* ── 4. the suite list, in both directions ────────────────────────────────── */

await run("every suite is listed, and every listing is a suite", async () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const scripts = Object.keys(pkg.scripts).filter((k) => k.startsWith("test:"));
  const table = readme.slice(readme.indexOf("## Tests"), readme.indexOf("## Tests") + 4000);
  const listed = new Set([...table.matchAll(/npm run (test:[a-z]+)/g)].map((m) => m[1]));
  assert.deepEqual(
    scripts.filter((s) => !listed.has(s)).sort(),
    [],
    "a suite a contributor cannot find in the README is a suite nobody runs"
  );
  assert.deepEqual(
    [...listed].filter((s) => !scripts.includes(s)).sort(),
    [],
    "and the table must not advertise a script that was renamed away"
  );
  for (const s of scripts) {
    const file = pkg.scripts[s].replace(/^node\s+/, "").trim();
    assert.ok(existsSync(path.join(ROOT, file)), `${s} points at ${file}, which does not exist`);
  }
});

await run("no suite is orphaned between npm test and CI", async () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const chain = new Set([...pkg.scripts.test.matchAll(/npm run (test:[a-z]+)/g)].map((m) => m[1]));
  const ciPath = path.join(ROOT, "docs", "ci", "github-actions.ci.yml");
  const ci = readFileSync(ciPath, "utf8");
  const orphaned = Object.keys(pkg.scripts)
    .filter((k) => k.startsWith("test:") && !chain.has(k) && !ci.includes(`npm run ${k}`))
    .sort();
  assert.deepEqual(orphaned, [], "either in the chain or named in the workflow — otherwise it quietly stops being run");
  assert.ok(ci.includes("actions/checkout@v4"), "the workflow file is still a real workflow draft");
});

process.exit(report("README ↔ routes ↔ suites") ? 1 : 0);
