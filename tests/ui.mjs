#!/usr/bin/env node
/**
 * Step 1 of the UI plan: the shared primitives in lib/ui/.
 *
 * What a browser-less suite can honestly prove about a popover, and what it can't:
 *
 *   CAN prove  — the placement math (flip / clamp / cross-axis clamp), because
 *                lib/ui/placement.ts is pure and runs here as real compiled code;
 *                the markup a real `next dev` server renders for the lab page
 *                (aria wiring, one selected tab, closed panels absent from the DOM);
 *                the CSS that page actually loads (the classes the components ask for
 *                exist, are theme-aware, and sit before the reduced-motion guard).
 *   CANNOT prove — that a menu visually slides, that focus returns to the trigger,
 *                that a click outside closes it. That is /dev/ui-lab in a browser, and
 *                the checklist there says which keys to press. This file deliberately
 *                does not pretend otherwise.
 *
 * It also asserts the additive-only rule for this step: nothing in the app itself
 * (/, /pricing) may reference the new classes yet, and the two hand-rolled popovers
 * are untouched until Step 11 — a step that "polishes" 400 lines it wasn't asked to
 * touch is how a working product breaks.
 *
 * Run: npm run test:ui
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { report, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3341;

/* ── 1. placement math: compile the real module, no fixtures ───────────── */

const outDir = mkdtempSync(path.join(tmpdir(), "bw-ui-"));
const SRC = path.join(ROOT, "lib", "ui", "placement.ts");
try {
  execFileSync(
    "npx",
    ["tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--strict", "--skipLibCheck"],
    { stdio: "pipe" }
  );
} catch (e) {
  console.error("could not compile lib/ui/placement.ts\n", e.stdout?.toString(), e.stderr?.toString());
  process.exit(1);
}
const emitted = path.join(outDir, "placement.js");
if (!existsSync(emitted)) {
  console.error(`tsc produced no ${emitted}`);
  process.exit(1);
}
const { placePanel, clampViewport, flipOf, roomFor } = await import(pathToFileURL(emitted).href);

const vh = 900;
const vw = 1280;
const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });

await run("fits below → opens below, at its own height", async () => {
  const p = placePanel({ want: "below", trigger: rect(40, 700, 34, 34), panelW: 240, panelH: 120, vw, vh, maxHeight: 340 });
  assert.equal(p.placement, "below");
  assert.equal(p.top, 700 + 34 + 8); // trigger bottom + offset
  assert.equal(p.left, 40);
  // max-height is min(requested, room left): smaller than the caller asked but
  // still >= the panel, so nothing is clipped and a late-growing row scrolls.
  assert.ok(p.maxH >= 120, `panel must still fit (maxH=${p.maxH})`);
  assert.ok(p.maxH <= 340, "must not exceed the caller's own limit");
});

await run("overflow below with room above → flips above", async () => {
  const p = placePanel({ want: "below", trigger: rect(40, 820, 34, 34), panelW: 240, panelH: 300, vw, vh, maxHeight: 340 });
  assert.equal(p.placement, "above");
  assert.equal(p.bottom, vh - 820 + 8);
  assert.equal(p.top, undefined, "a flipped panel must not carry the other axis' coordinate");
});

await run("no room either way → no flip, it scrolls instead", async () => {
  // A 2000px panel with ~30px below and ~800px above: neither side fits, so flipping
  // would only jump the menu sideways. It stays put and scrolls.
  const p = placePanel({ want: "below", trigger: rect(40, 820, 34, 34), panelW: 240, panelH: 2000, vw, vh, maxHeight: 900 });
  assert.equal(p.placement, "below");
  assert.ok(p.maxH <= 900 - 854 - 8 - 8 || p.maxH === 140, `maxH ${p.maxH} must not exceed the room left below`);
  assert.ok(p.maxH >= 140, "never crushed below the readable minimum");
});

await run("near the right edge → clamped into view, never off-screen", async () => {
  const p = placePanel({ want: "below", align: "end", trigger: rect(1230, 100, 40, 34), panelW: 240, panelH: 200, vw, vh });
  assert.ok(p.left + 240 <= vw - 8, `right edge respected (left=${p.left})`);
  assert.ok(p.left >= 8);
});

await run("a submenu opens right, and flips left at the edge", async () => {
  const r = rect(900, 400, 200, 32);
  const a = placePanel({ want: "right", trigger: r, panelW: 170, panelH: 120, vw, vh });
  assert.equal(a.placement, "right");
  assert.equal(a.left, 900 + 200 + 8);
  // Same row 180px from the right edge: 170px of panel cannot fit → flip left.
  const b = placePanel({ want: "right", trigger: rect(1100, 400, 180, 32), panelW: 170, panelH: 120, vw, vh });
  assert.equal(b.placement, "left");
  assert.equal(b.right, vw - 1100 + 8);
  assert.ok(b.top >= 8 && b.top + 120 <= vh - 8, "cross axis stays inside the viewport");
});

await run("placement helpers agree with each other", async () => {
  assert.equal(flipOf("below"), "above");
  assert.equal(flipOf("left"), "right");
  const t = rect(0, 500, 100, 30);
  assert.equal(roomFor("below", t, vw, vh, 8, 8), vh - 530 - 16);
  assert.equal(roomFor("above", t, vw, vh, 8, 8), 500 - 16);
});

await run("absolute clamp: only fires when the panel would hang off the bottom", async () => {
  assert.equal(clampViewport({ panelTop: 100, panelBottom: 300, vh, maxHeight: 340 }), null);
  const h = clampViewport({ panelTop: 700, panelBottom: 1000, vh, maxHeight: 340 });
  assert.equal(h, vh - 700 - 8);
  assert.equal(clampViewport({ panelTop: 10, panelBottom: 2000, vh, maxHeight: 340 }), null, "a panel taller than the limit still gets its own max");
});

/* ── 2 + 3 + 4. the real server: lab markup, loaded CSS, additive-only ─── */

/* The CSS is fetched over HTTP (the dev server owns it, and minification differs
   from the source file) and memoised so both CSS checks share one round trip. */
const cssCache = new Map();
async function fetchCss(url) {
  if (!cssCache.has(url)) cssCache.set(url, await (await fetch(url)).text());
  return cssCache.get(url);
}

const srv = await startServer({ port: PORT, label: "bw-ui" });
try {
  const labHtml = await (await fetch(`${srv.base}/dev/ui-lab`)).text();
  const homeHtml = await (await fetch(`${srv.base}/`)).text();
  const pricingHtml = await (await fetch(`${srv.base}/pricing`)).text();

  await run("the lab page is server-rendered and not indexed", async () => {
    assert.ok(labHtml.includes('data-testid="lab-log"'), "log element must exist for the checklist");
    assert.match(labHtml, /UI lab/);
    assert.match(labHtml, /noindex/, "a dev surface must not be crawlable");
  });

  await run("menu triggers carry the ARIA wiring a screen reader needs", async () => {
    const haspopup = labHtml.match(/aria-haspopup="menu"/g) || [];
    const expanded = labHtml.match(/aria-expanded="false"/g) || [];
    assert.ok(haspopup.length >= 2, `expected >=2 menu triggers, got ${haspopup.length}`);
    assert.equal(expanded.length, haspopup.length, "every trigger must expose a closed state");
    assert.ok(labHtml.includes('aria-live="polite"'), "the log must announce itself");
  });

  await run("a closed popover is not in the DOM at all", async () => {
    // The plan's premise for Step 4/6: menu rows must not be reachable — or
    // tabbable — before the menu is opened, so nothing may be rendered for them.
    assert.ok(!labHtml.includes("data-bw-popover"), "closed panels must not be hidden-but-present");
    assert.ok(!labHtml.includes("Nothing attached"), "rows inside a closed menu must not render");
  });

  await run("segmented control renders one selected tab over N segments", async () => {
    assert.ok(labHtml.includes('role="tablist"'));
    const items = labHtml.match(/data-bw-seg-item="[^"]+"/g) || [];
    assert.equal(items.length, 4, `4 segments expected, got ${items.length}`);
    assert.equal((labHtml.match(/aria-selected="true"/g) || []).length, 1, "exactly one selected");
    assert.ok(labHtml.includes('data-bw-seg-item="pro"'), "the SSR value must be the one the page passed in");
    assert.ok(labHtml.includes('data-bw-seg=""'), "the indicator element must exist (measured after paint)");
  });

  await run("the CSS the components ask for is the CSS the page loads", async () => {
    const hrefs = [...labHtml.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)[^"]*"/g)].map((m) => m[1]);
    assert.ok(hrefs.length, "no stylesheet link found in dev HTML");
    const css = (await Promise.all(hrefs.map((h) => fetchCss(`${srv.base}${h}`)))).join("\n");
    for (const sel of ["bw-pop__panel", "bw-pop--dark", "bw-menu-row", "bw-seg__ind", "bw-menu-divider", "surface-dark"]) {
      assert.ok(css.includes(sel), `globals.css lost .${sel}`);
    }
    assert.match(css, /@keyframes bw-pop-in/, "the entrance animation must exist");
    assert.match(css, /color-mix\(in srgb,\s*currentColor 8%/, "menu hover must come from the surface, not a fixed hex");
  });

  await run("reduced motion still wins over the new animation", async () => {
    const hrefs = [...labHtml.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)[^"]*"/g)].map((m) => m[1]);
    const css = (await Promise.all(hrefs.map((h) => fetchCss(`${srv.base}${h}`)))).join("\n");
    const animAt = css.indexOf("bw-pop-in");
    const guardAt = css.lastIndexOf("prefers-reduced-motion");
    assert.ok(animAt >= 0 && guardAt > animAt, "the guard must be emitted with the new rules present");
    assert.match(css, /prefers-reduced-motion[^)]*\)\s*\{?\s*\*[^}]*animation-duration:\s*0\.01ms/s, "the global guard must still zero animations");
  });

  await run("this step changed nothing in the app itself (additive-only)", async () => {
    for (const [name, html] of [["/", homeHtml], ["/pricing", pricingHtml]]) {
      assert.ok(!html.includes("bw-pop"), `${name} must not use the popover yet`);
      assert.ok(!html.includes("data-bw-seg"), `${name} must not use the segmented control yet`);
    }
    // app/page.tsx owns three hand-rolled menus (project, style, history) that each
    // fake dismissal with a full-screen invisible button. Step 1 sweeps NONE of them;
    // Step 11 moves all three onto useDismiss. Counting them here is what makes
    // "I only added primitives" a checked claim instead of a promise.
    const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
    const overlays = (page.match(/fixed inset-0 z-40 cursor-default/g) || []).length;
    assert.equal(overlays, 3, "the three existing menus must still be wired the way they were");
    assert.ok(!page.includes('from "@/lib/ui"'), "nothing in the app may import the primitives yet");
  });
} finally {
  await srv.stop();
}

rmSync(outDir, { recursive: true, force: true });
process.exit(report("UI primitives (lib/ui) + Step 1 additive-only") ? 1 : 0);
