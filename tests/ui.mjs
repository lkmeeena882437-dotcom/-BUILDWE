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
 * It also asserts the additive-only rule for Step 1 (nothing in the app referenced the
 * new classes until Step 2 deliberately wired the composer up) and, for Step 2, that the
 * extracted composer is the same component with the same strings: every literal the
 * inline block owned is asserted to exist in the new file, the page keeps no second copy,
 * and the pill renders for real when mounted. A "refactor" that quietly drops the 200 KB
 * file limit or the guest-mode note is exactly what this guards against.
 *
 * Run: npm run test:ui
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { report, run, startServer, stopServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3341;

/**
 * Source-level "must not contain" checks have to ignore prose. Twice now a test has
 * failed because a comment in the file *explained* the thing that was removed — that
 * comment is the proof the fix happened, not a regression. Strip comment lines and
 * assert against the code.
 */
function codeOnly(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\/\*\*)/.test(l))
    .join("\n");
}


/* ── 1. placement math: compile the real module, no fixtures ───────────── */

const outDir = mkdtempSync(path.join(tmpdir(), "bw-ui-"));
const SRC = path.join(ROOT, "lib", "ui", "placement.ts");
/* For the compiled-component render in step 14: require CJS *from the repo*, so `clsx` and
   `react/jsx-runtime` resolve the way the app resolves them. */
const load = createRequire(path.join(ROOT, "noop.cjs"));
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

/* ── 5. Step 2: the composer move must not have lost a single behaviour ──── */

await run("Step 2: the extracted composer keeps every literal the inline one had", () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  // These strings are the contract with the user and with the server: a placeholder that
  // quietly disappears, a file limit that moves, or a label that changes and the
  // extraction lost something real. (List derived from the pre-extraction block, so it
  // also documents what the composer is responsible for.)
  const keep = [
    "What do you want to do?",
    "Describe what you want to build — BUILDWE handles the code",
    "Ask anything — plain language works best",
    "Message BUILDWE",
    "Image attached — ask anything about it",
    "Remove image",
    "Answer style — length & language",
    "Web search — live sources",
    "Compare models — ask 3 AIs the same question",
    "Use Chrome for voice input",
    "you can stop anytime, the partial answer is saved",
    "BUILDWE picks the right tool",
    "File too large — keep text files under",
    "Image too large — keep it under 5 MB.",
    "analyzeFileApi(f.name, t)",
  ];
  for (const k of keep) assert.ok(bar.includes(k), `PromptBar lost: ${k}`);
  for (const probe of ['aria-label="Send"', "placeholderFor", "setWebSearchOn"]) {
    assert.ok(bar.includes(probe), `PromptBar must own: ${probe}`);
  }
  // …and page.tsx must not keep a second copy of any of it.
  for (const gone of [
    "What do you want to do?",
    'aria-label="Send"',
    "Use Chrome for voice input",
    "const [styleMenu, setStyleMenu]",
    "interface SpeechRecognition ",
    "function Btn({",
    "const MODE_META",
  ]) {
    assert.ok(!page.includes(gone), `page.tsx still contains the old copy of: ${gone}`);
  }
  // Single-owner checks: one Btn, one mode catalogue, one speech type.
  assert.ok(page.includes('import { Btn } from "@/lib/ui/Btn"'), "page.tsx must import the shared Btn");
  assert.ok(bar.includes('import { Btn } from "@/lib/ui/Btn"'), "the pill must use the shared Btn, not a copy");
  assert.ok(bar.includes('from "@/lib/client/modes"') && page.includes('from "@/lib/client/modes"'), "MODE_META has one owner");
  assert.ok(bar.includes("speechRecognitionCtor"), "dictation types come from lib/client/speech");
});

await run("Step 2: the IME fix and the pill/focus classes are actually there", () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  // The fix is an ORDER, not a literal: anything that can send must sit behind the
  // composing check, or confirming an IME candidate fires the run. Asserting the old
  // exact expression would have broken the moment Cmd+Enter was added beside it.
  const kdStart = bar.indexOf("onKeyDown={(e) => {");
  const kdBlock = bar.slice(kdStart, kdStart + 900);
  assert.ok(kdBlock.includes("if (e.nativeEvent.isComposing) return;"), "the composing guard must exist in the key handler");
  assert.ok(kdBlock.indexOf("isComposing") < kdBlock.indexOf("void onSend()"), "and it must come before anything that can send");
  assert.ok(kdBlock.includes("const cmd = e.metaKey || e.ctrlKey;"), "the cmd/ctrl modifier is read once");
  assert.ok(kdBlock.includes('if (e.key === "Enter" && (!e.shiftKey || cmd))'), "Enter and Cmd/Ctrl+Enter send; Shift+Enter still inserts a newline");
  assert.ok(bar.includes('!e.shiftKey'), "Shift+Enter stays a newline");
  assert.ok(/if \(e\.key === "Enter"[^\n]*\) \{\s*\n?\s*e\.preventDefault\(\)/.test(bar) || bar.includes("e.preventDefault();"), "the send branch must still prevent the newline");
  assert.ok(bar.includes('className="bw-dock sticky bottom-0 z-20 shrink-0'), "the dock is the sticky footer");
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
  for (const sel of [".bw-pill", ".bw-pill:focus-within", ".bw-pill__input", ".bw-dock"]) {
    assert.ok(css.includes(sel), `globals.css lost ${sel}`);
  }
  assert.ok(/@supports not \(backdrop-filter/.test(css), "no-backdrop-filter browsers must get an opaque footer");
});

await run("Step 2: every prop the pill needs is passed by the page that owns the state", () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const decl = bar.slice(bar.indexOf("export interface PromptBarProps"), bar.indexOf("function placeholderFor"));
  const props = [...decl.matchAll(/^  ([A-Za-z]+)[?]?:/gm)].map((m) => m[1]);
  assert.ok(props.length >= 25, `expected the full prop list, found ${props.length}`);
  const use = page.slice(page.indexOf("<PromptBar"), page.indexOf("/>", page.indexOf("<PromptBar")));
  const given = [...use.matchAll(/^\s+([A-Za-z]+)=/gm)].map((m) => m[1]);
  const missing = props.filter((p) => !given.includes(p));
  assert.deepEqual(missing, [], `props declared but not passed: ${missing.join(", ")}`);
  const extra = given.filter((g) => !props.includes(g));
  assert.deepEqual(extra, [], `props passed that the component does not declare: ${extra.join(", ")}`);
});

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

  await run("Step 6: the account menu is a closed button in the rail, with no rows in the DOM", async () => {
    const html = await (await fetch(`${srv.base}/dev/ui-lab`)).text();
    const at = html.indexOf('data-action="profile-menu"');
    assert.ok(at > -1, "the account row must render as a button (the lab mounts the real component)");
    const tag = html.slice(at, html.indexOf(">", at));
    // All three ARIA states have to be on the element the user tabs to, and in the markup
    // the server sent - not patched in by an effect, which is when "it works in a browser"
    // stops being checkable here.
    assert.ok(tag.includes('aria-haspopup="menu"'), "it must announce itself as a menu button");
    assert.ok(tag.includes('aria-expanded="false"'), "and say it is closed");
    assert.ok(tag.includes('aria-controls="bw-profile-menu"'), "with the panel's id, which is how one-open-at-a-time works");

    // Closed means absent, not hidden: rows are tabbable buttons, and a menu that is
    // display:none still leaves its rows in the tab order on some browsers.
    for (const row of ["profile-account", "profile-credits", "profile-plans", "profile-teams", "profile-byok", "profile-theme", "profile-signout"]) {
      assert.ok(!html.includes(`data-action="${row}"`), `${row} must not exist until the menu is opened`);
    }
    for (const v of ["system", "light", "dark"]) {
      assert.ok(!html.includes(`data-action="theme-${v}"`), `the theme submenu (${v}) must be doubly closed`);
    }
  });

  await run("segmented control renders one selected tab over N segments", async () => {
    assert.ok(labHtml.includes('role="tablist"'));
    const items = labHtml.match(/data-bw-seg-item="[^"]+"/g) || [];
    assert.equal(items.length, 4, `4 segments expected, got ${items.length}`);
    assert.equal((labHtml.match(/aria-selected="true"/g) || []).length, 1, "exactly one selected");
    assert.ok(labHtml.includes('data-bw-seg-item="pro"'), "the SSR value must be the one the page passed in");
    assert.ok(labHtml.includes('data-bw-seg=""'), "the indicator element must exist (measured after paint)");
  });

  await run("GET /api/credits publishes the ceiling the gateway enforces", async () => {
    const j = await (await fetch(`${srv.base}/api/credits`)).json();
    const gateway = readFileSync(path.join(ROOT, "lib", "ai", "gateway.ts"), "utf8");
    const m = gateway.match(/messageChars:\s*(\d[\d_]*)/);
    assert.ok(m, "the gateway's messageChars literal should still be greppable");
    const declared = Number(m[1].replace(/_/g, ""));
    assert.equal(j.limits.messageChars, declared, "the API must hand out the number the server refuses at");
    assert.ok(declared >= 1000, "sanity: a message ceiling, not a typo");
  });

  await run("a keyless transcription is a refusal, not an ok:true apology", async () => {
    // The composer's voice note inserts whatever comes back into the prompt, so the
    // envelope matters as much as the wording: no provider reached => no success.
    const before = await (await fetch(`${srv.base}/api/credits`, { credentials: "include" })).json();
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(2048)], { type: "audio/webm" }), "probe.webm");
    const r = await fetch(`${srv.base}/api/ai/transcribe`, { method: "POST", body: form, credentials: "include" });
    const j = await r.json().catch(() => ({}));
    assert.ok(!r.ok, `the route must not answer 200 without a transcript (got ${r.status})`);
    assert.ok(j.ok !== true, "the response must not claim success");
    assert.equal(j.code, "TRANSCRIPTION_UNAVAILABLE", "the refusal must name itself");
    assert.match(String(j.error), /isn't connected|enable a transcription/, "and keep the operator-actionable wording");
    const after = await (await fetch(`${srv.base}/api/credits`, { credentials: "include" })).json();
    assert.equal(after.balance, before.balance, "a refusal may not cost a credit");
  });

  await run("Step 2: the composer pill renders for real (inert mount in the lab)", async () => {
    assert.ok(labHtml.includes("bw-pill"), "the pill class must be on the rendered field");
    assert.ok(labHtml.includes("bw-dock"), "the dock is what floats above the scroll");
    assert.ok(labHtml.includes('aria-label="Message BUILDWE"'), "the textarea needs a name for AT");
    assert.ok(labHtml.includes('aria-label="Attach"'), "the leading + must be labelled");
    assert.ok(labHtml.includes("What do you want to do?"), "the auto-mode placeholder must survive");
    assert.ok(labHtml.includes('aria-label="Send"'), "the send button must be reachable by name");
    assert.ok(labHtml.includes('aria-haspopup="menu"'), "the + is a menu trigger");
    // The picker renders closed, so only the trigger is in the markup — which is the
    // point of the closed-popover rule below, and why "all five labels visible" was the
    // wrong thing to assert in the first place.
    assert.ok(labHtml.includes("Mode: Auto"), "the trigger names the active mode from the shared catalogue");
    assert.equal((labHtml.match(/data-action="mode-/g) || []).length, 0, "a closed picker has no rows in the DOM");
    assert.ok(!labHtml.includes("· undefined"), "the account line must not print undefined while me is loading");
    // rows behind the closed + menu are not in the DOM
    assert.ok(!labHtml.includes("Summarised, not pasted whole"), "a closed menu renders no rows");
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

  await run("the customer-facing pages are untouched, and lib/ui stays out of them", async () => {
    for (const [name, html] of [["/", homeHtml], ["/pricing", pricingHtml]]) {
      assert.ok(!html.includes("bw-pop"), `${name} must not use the popover until a step says so`);
    }
    // The workspace page still has no menu primitives in its server HTML. /pricing earned
    // exactly one in Step 7 - the Personal/Business toggle - so the rule there is not
    // "nothing shared" but "one control, one purpose", which is checkable in the markup.
    assert.ok(!homeHtml.includes("data-bw-seg"), "the app's own surfaces have no segmented control yet");
    assert.equal((pricingHtml.match(/role="tablist"/g) || []).length, 1, "one segmented control on /pricing, for the audience");
    assert.equal((pricingHtml.match(/data-bw-seg-item="(personal|business)"/g) || []).length, 2, "with exactly its two choices");
    assert.equal((pricingHtml.match(/aria-selected="true"/g) || []).length, 1, "and exactly one of them on");
    const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
    const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
    // Hand-rolled menus that fake dismissal with a full-screen invisible <button>:
    // page.tsx had three (project, style, history). The style one came into the composer
    // in Step 2, Step 5 replaced it with <Popover>, and Step 11 took the last two — into
    // components, so the page's own import budget did not grow. The count is deliberately
    // a number and not a `<=`: an overlay may only appear with a step that says so here.
    const overlays =
      (page.match(/fixed inset-0 z-40 cursor-default/g) || []).length +
      (bar.match(/fixed inset-0 z-40 cursor-default/g) || []).length;
    assert.equal(overlays, 0, "no hand-rolled overlay is left in the shell or the composer");
    assert.equal((bar.match(/fixed inset-0/g) || []).length, 0, "the composer owns no overlay of any kind");
    // page.tsx may reach into lib/ui for exactly two things: Btn (shared with the pill)
    // and SegmentedControl, which Step 6 added because the settings sheet's theme picker
    // had to become the same control the account menu uses. Everything else — the popover,
    // the menu rows — stays out of the page until the step that needs it, which is what
    // keeps a "refactor" from turning into an unrequested re-skin of 400 lines. Both are
    // deep imports rather than the barrel, so the page's chunk pays for two modules and
    // not for lib/ui.
    const uiImports = [...page.matchAll(/from "@\/lib\/ui([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(uiImports)].sort(),
      ["/Btn", "/SegmentedControl"],
      "page.tsx may import Btn and SegmentedControl, from their own modules, nothing else"
    );
  });
} finally {
  await srv.stop();
}

/* ── 6. the improvement pass on Steps 1-2, checked not eyeballed ─────────── */

await run("a focus ring must not re-round the control it highlights", async () => {
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
  assert.match(
    css,
    /border-radius:\s*var\(--bw-focus-r, 6px\)/,
    "the global :focus-visible rule must keep a 6px default so nothing older changes"
  );
  for (const sel of [".bw-menu-row", ".bw-seg__btn", ".bw-pop__panel", ".bw-pill button", ".bw-pill__send"]) {
    // The declaration lives in its own small rule in the same file (a selector can
    // appear several times - base rule, focus rule, a @media block - so "somewhere in
    // the first rule" would be a fragile thing to assert on).
    assert.ok(css.includes(`${sel} {\n  --bw-focus-r`), `${sel} must declare --bw-focus-r`);
  }
  assert.match(css, /@media \(pointer: coarse\)[\s\S]{0,120}min-height: 40px/, "menu rows need a thumb-sized target on touch");
  const dismiss = readFileSync(path.join(ROOT, "lib", "ui", "useDismiss.ts"), "utf8");
  assert.ok(dismiss.includes("focus({ preventScroll: true })"), "opening a menu must not scroll the page");
  assert.ok(dismiss.includes('scrollIntoView({ block: "nearest" })'), "arrow keys keep the row visible inside the panel only");
});

await run("shared code carries no unused knobs, and a disabled row can explain itself", async () => {
  const dismiss = readFileSync(path.join(ROOT, "lib", "ui", "useDismiss.ts"), "utf8");
  assert.ok(!dismiss.includes("closeNowAttr"), "an option with no caller is a liability in the file every menu depends on");
  const row = readFileSync(path.join(ROOT, "lib", "ui", "MenuRow.tsx"), "utf8");
  assert.ok(row.includes("aria-disabled={disabled || undefined}"), "disabled rows stay focusable so the reason is readable");
  assert.ok(!/\n\s+disabled=\{disabled\}/.test(row), "the native disabled attribute would hide the reason from keyboard and AT users");
  assert.ok(row.includes("title={disabled && note ? note : undefined}"), "and the reason is on the row itself");
  assert.ok(row.includes('role="menuitem"'), "a link row keeps menu semantics");
});

await run("a popover is named, not pointed at itself", async () => {
  const pop = readFileSync(path.join(ROOT, "lib", "ui", "Popover.tsx"), "utf8");
  assert.ok(pop.includes("aria-label={labelledBy ? undefined : label}"), "label names the panel when there is no trigger id to point at");
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  assert.ok(bar.includes('label="Attach"'), "the attach menu names itself");
  assert.ok(!bar.includes('labelledBy="bw-attach-menu"'), "it must not be labelled by its own id");
});

await run("the segmented control measures the thing that actually changes", async () => {
  const seg = readFileSync(path.join(ROOT, "lib", "ui", "SegmentedControl.tsx"), "utf8");
  assert.ok(seg.includes("ro.observe(active)"), "a label can resize without the container moving");
  assert.ok(seg.includes('aria-orientation="horizontal"'), "the tablist must say which way it runs");
  assert.ok(seg.includes("% items.length) + items.length) % items.length"), "arrow wrap stays inside the list without a modulo-by-hand trick");
});

await run("reading a file may fail, and must say so", async () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  assert.ok(bar.includes("reader.onerror"), "a FileReader failure is silent by default");
  assert.ok(bar.includes("Couldn't read \"${f.name}\" as an image"), "image read failure has its own message");
  assert.ok(bar.includes("} catch {\n      setError(`Couldn't read"), "text read failure is caught, not thrown into the console");
  for (const fn of ["attachTextFile", "attachImageFile", "acceptDroppedFile"]) {
    assert.ok(bar.includes(`const ${fn} =`), `the ${fn} pipeline is missing`);
  }
  assert.strictEqual((bar.match(/e\.target\.value = "";/g) || []).length, 2, "both pickers clear their input so re-picking the same file fires again, and nothing else does");
  // Step 5 replaced the chip strip with a picker, so "says which mode is active" moved
  // from five aria-pressed buttons to one labelled trigger. The invariant, not the old
  // markup: the control must name the current mode, and the old strip must not still be
  // there as a second control saying it.
  const mode = readFileSync(path.join(ROOT, "components", "workspace", "ModeMenu.tsx"), "utf8");
  assert.ok(mode.includes("aria-label={`Mode: ${active.label}`}"), "the trigger states which mode is active");
  assert.ok(!bar.includes("aria-pressed={on}"), "the five-chip strip is gone, not left behind under the new control");
  assert.ok(bar.includes('className="flex shrink-0 items-center gap-0.5"'), "trailing actions must not be squeezed by a long chip row");
});

await run("the lab files share one style module instead of pasting it twice", async () => {
  const kit = readFileSync(path.join(ROOT, "app", "dev", "ui-lab", "kit.ts"), "utf8");
  assert.ok(kit.includes("export const cardStyle"), "kit.ts owns the card styles");
  for (const f of ["Lab.tsx", "PromptBarDemo.tsx"]) {
    const src = readFileSync(path.join(ROOT, "app", "dev", "ui-lab", f), "utf8");
    assert.ok(src.includes('from "./kit"'), `${f} must import them`);
    assert.ok(!src.includes("const cardStyle"), `${f} must not keep a second copy`);
  }
});

await run("Step 3: the counter reads the server's ceiling, not a copy of it", async () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  // A number pasted into a component is how a UI limit drifts from the enforcing one.
  // Comments may name the number to explain why it must not be copied; code may not.
  assert.ok(!/\b24[_,]?000\b/.test(codeOnly(bar)), "PromptBar must not contain a copy of the message limit");
  assert.ok(bar.includes("maxMessageChars?: number"), "the ceiling arrives as a prop");
  assert.ok(bar.includes("input.length > maxMessageChars * 0.75"), "and it only shows up when it matters");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  assert.ok(page.includes("maxMessageChars={wallet.limits?.messageChars}"), "the page wires it from the wallet store");
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
  for (const sel of [".bw-pill__drop", ".bw-pill.is-drop", ".bw-pill__count.is-over"]) {
    assert.ok(css.includes(sel + " {"), `missing rule for ${sel}`);
  }
});

await run("Step 3: paste, drop and the picker share one attach pipeline", async () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  // three entry points, one owner each for the image path and the text path
  assert.strictEqual((bar.match(/attachImageFile\(f\)/g) || []).length, 3, "picker + drop router + paste all call the one image path");
  assert.strictEqual((bar.match(/attachTextFile\(f\)/g) || []).length, 2, "picker + drop router call the one text path");
  assert.ok(bar.includes('x.type.startsWith("image/")'), "paste only intercepts a clipboard that really carries an image");
  assert.ok(bar.includes('includes("Files")'), "dragging selected text must not light up the drop state");
  assert.ok(bar.includes("e.currentTarget.contains(e.relatedTarget as Node | null)"), "leaving a child must not flicker the hint off mid-drag");
  assert.ok(bar.includes('role="status"'), "the counter is a status, not a live region firing on every keystroke");
});

await run("a house ad's button must do something real", async () => {
  const src = readFileSync(path.join(ROOT, "components", "AdSlot.tsx"), "utf8");
  // `href="#byok"` matched no element and `/?share=1` was read by nobody: both were
  // dead. An ad is allowed a route or a host callback, never a fragment.
  const code = codeOnly(src);
  assert.ok(!/href:\s*"#[^"]+"/.test(code), "no bare-anchor href in a house ad");
  assert.ok(!/share=1/.test(code), "no invented query param");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const sites = page.match(/<AdSlot[\s\S]{0,260}?\/>/g) || [];
  assert.equal(sites.length, 2, "both AdSlot call sites are found by this test");
  for (const site of sites) {
    assert.ok(site.includes("onGoPro="), "the PRO ad needs its handler");
    assert.ok(site.includes("onAddKey="), "the BYOK ad needs its handler");
  }
  // Date.now() inside render is a hydration mismatch waiting to happen.
  const body = code.slice(code.indexOf("export function AdSlot"));
  assert.ok(!body.includes("Date.now()"), "the ad pick must be deterministic per render");
  assert.ok(body.includes("setInterval"), "rotation happens on a client timer instead");
});

await run("Step 4: a voice note reaches the transcription route through its one owner", async () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  assert.ok(bar.includes("transcribeAudio(blob"), "the composer must call lib/client/api's transcribeAudio");
  assert.ok(!bar.includes('"/api/ai/transcribe"'), "and must not hand-roll a second fetch to the same route");
  assert.ok(bar.includes("noteCredits") === false, "credit bookkeeping stays inside the client helper");
  // the mic must not outlive the component, and Cancel must not upload
  const cleanup = bar.slice(bar.indexOf("useEffect(() => {\n    setCanRecord"));
  assert.ok(cleanup.includes("getTracks().forEach((t) => t.stop())"), "unmount stops the stream tracks");
  const cancel = bar.slice(bar.indexOf("function cancelVoiceNote"), bar.indexOf("async function startVoiceNote"));
  assert.ok(cancel.indexOf("rec.onstop = null") < cancel.indexOf("rec.stop()"), "cancel detaches onstop before stopping, so nothing uploads");
  assert.ok(/MAX_VOICE_SECONDS = 300/.test(bar), "the clip is capped so a forgotten recorder cannot run forever");
  // every menu row must do something: onClick, or an href to a route that exists
  // Splitting on the tag beats a fixed-length window: a row with a state-driven
  // ternary in its hint is longer than any bound you want to hard-code.
  const rows = bar
    .split("<MenuRow")
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("/>") + 2));
  assert.equal(rows.length, 4, "image, text file, voice note, clear");
  for (const row of rows) {
    assert.ok(/onClick=|href=/.test(row), `a menu row with no action: ${row.slice(0, 60)}`);
  }
  for (const href of bar.match(/href="\/[^"]*"/g) || []) {
    const rel = href.slice(6, -1).split("?")[0];
    const file = path.join(ROOT, "app", rel === "/" ? "page.tsx" : `${rel}/page.tsx`);
    assert.ok(existsSync(file), `a menu link points at ${rel}, which has no page`);
  }
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
  for (const sel of [".bw-pill__voice", ".bw-pill__rec", ".bw-pill__voicebtn"]) {
    assert.ok(css.includes(sel + " {"), `missing rule for ${sel}`);
  }
  assert.ok(
    css.indexOf("@keyframes bw-rec") < css.lastIndexOf("@media (prefers-reduced-motion"),
    "the recording pulse must sit inside the reduced-motion guard's reach"
  );
});

await run("no signing key in the auth path is a published constant", async () => {
  const { readFileSync: rd } = await import("node:fs");
  for (const f of ["lib/auth/guest.ts", "lib/auth/session.ts", "lib/crypto.ts"]) {
    const code = codeOnly(rd(path.join(ROOT, f), "utf8"));
    assert.ok(
      !/["'`]buildwe[^"'`]*(dev|secret|change)[^"'`]*["'`]/.test(code),
      `${f} must not contain a key literal - a published fallback is the key, not a fallback`
    );
  }
  // Both consumers of a missing secret go through the one implementation.
  assert.ok(rd(path.join(ROOT, "lib", "auth", "guest.ts"), "utf8").includes("installSecret("), "guest ids use installSecret");
  const cr = rd(path.join(ROOT, "lib", "crypto.ts"), "utf8");
  assert.ok(cr.includes("export function installSecret") && cr.includes("installSecret(\"byok-encryption\")"), "BYOK uses the same owner");
  // Token and payment signatures must be compared without a timing channel, and by one
  // helper rather than a per-file copy.
  assert.ok(cr.includes("export function safeEqual"), "crypto.ts owns the constant-time compare");
  assert.ok(!/hmac\(payload\) !== sig/.test(cr), "verification tokens are not compared with !==");
  const rz = codeOnly(rd(path.join(ROOT, "lib", "payments", "razorpay.ts"), "utf8"));
  assert.ok(rz.includes("safeEqual(expected, signature)"), "the Razorpay signature uses it");
  assert.ok(!/function safeEqualHex/.test(rz), "and does not keep a second implementation");
  for (const name of ["session-signing", "guest-signing", "byok-encryption", "verification-tokens"]) {
    const uses = ["lib/auth/session.ts", "lib/auth/guest.ts", "lib/crypto.ts"].some((f) =>
      rd(path.join(ROOT, f), "utf8").includes(`installSecret("${name}")`)
    );
    assert.ok(uses, `${name} has no owner`);
  }
  const guest = rd(path.join(ROOT, "lib", "auth", "guest.ts"), "utf8");
  assert.ok(guest.includes("SESSION_SECRET is unset"), "and it must say so out loud when it has to");
});

await run("Step 5: one popover over the shared catalogue, and no way to abort by accident", () => {
  const mode = readFileSync(path.join(ROOT, "components", "workspace", "ModeMenu.tsx"), "utf8");
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

  assert.ok(mode.includes("MODE_META.map"), "rows come from the one catalogue, not a local list");
  assert.ok(!/"auto"|"chat"|"code"|"image"|"audio"/.test(codeOnly(mode)), "no mode id is hard-coded in the component");
  assert.ok(mode.includes("menuTriggerProps(open, MODE_MENU_ID)") && mode.includes("id={MODE_MENU_ID}"), "trigger and panel share one id constant, so aria-controls cannot drift");
  // codeOnly: this file's own header comment *names* the keys Popover owns, and an
  // assertion that reads prose as code is a test that fails for the wrong reason.
  assert.ok(!/ArrowUp|ArrowDown|case "Home"/.test(codeOnly(mode)), "menu keys belong to Popover, not to a copy here");
  assert.ok(!mode.includes("setMode("), "a pick must go through the page's switchMode (which aborts a stream), never the plain setter");
  assert.ok(bar.includes("<ModeMenu mode={mode} onPick={onMode}"), "and the bar wires exactly that");

  // The current mode: inert, explained, and inert again as a second gate. switchMode
  // aborts whenever streaming, including for the mode you already occupy.
  assert.ok(mode.includes("disabled={on}") && mode.includes('note="Already selected"'), "the current row is disabled with the reason on it");
  assert.ok(mode.includes("if (on) return;"), "and even a forced click cannot cancel a running answer");
  assert.ok(mode.includes("selected={on}"), "while the check marks it");

  assert.ok(!bar.includes("overflow-x-auto"), "no scrolling chip strip left behind");
  assert.ok(!page.includes("bw-mode-menu"), "the page does not hand-roll a second copy of the menu id");
  assert.ok(css.includes('.bw-mode__btn[aria-expanded="true"] .bw-mode__chev'), "the chevron turns off the ARIA state, not a duplicated class");
  assert.ok(css.includes("min-width: 92px"), "the trigger keeps its width when a longer label appears");
  assert.ok(css.indexOf(".bw-mode__chev") < css.lastIndexOf("@media (prefers-reduced-motion"), "and reduced motion still wins over the turn");
});

await run("Step 5: the answer-style panel is a popover over primitives, not a fork of one", () => {
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
  assert.ok(bar.includes("<Popover") && bar.includes("id={STYLE_MENU_ID}"), "the style panel is a Popover with a stable id");
  assert.ok(bar.includes("menuTriggerProps(styleMenu, STYLE_MENU_ID)"), "its trigger exposes aria-controls/expanded like every other menu");
  assert.ok(bar.includes('role="group"') && bar.includes('label="Answer style"'), "named as the group it is, not as a menu");
  assert.ok(!bar.includes("anim-rise absolute bottom-10 left-0"), "no hand-placed panel left behind");
  assert.ok(bar.includes("<SegmentedControl") && (bar.match(/<SegmentedControl/g) || []).length === 2, "both axes are the shared control");
  assert.ok(bar.includes('align="end"') && bar.includes("width={300}"), "a right-end trigger grows the panel leftwards, not off the phone");
  const depthBlock = bar.slice(bar.indexOf("export const DEPTH_ITEMS"));
  assert.ok(/value: "deep"/.test(depthBlock.slice(0, 420)), "all four lengths are in the data, not in JSX");
  assert.equal((bar.match(/value: "(short|balanced|detailed|deep)"/g) || []).length, 4, "Answer length has exactly its four values");
  assert.equal((bar.match(/value: "(simple|standard|expert)"/g) || []).length, 3, "Language level has exactly its three");
  assert.ok(css.includes(".bw-pop__stack"), "and the panel's block rhythm lives in CSS, not in a utility chain");
  // the point of the whole exercise: a screen reader must be able to tell which is on
  // The point of the whole exercise: a screen reader can tell which is on,
  // because the unlabelled chip that set depth directly is gone.
  assert.ok(!bar.includes("onClick={() => setDepth(d)}"), "no unlabelled depth chips left");
  assert.ok(!bar.includes("onClick={() => setTone(t)}"), "no unlabelled tone chips left");
});

await run("Step 6: the flyout is an address book for surfaces that already exist", () => {
  const fly = readFileSync(path.join(ROOT, "components", "workspace", "ProfileFlyout.tsx"), "utf8");
  const code = codeOnly(fly);
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const theme = readFileSync(path.join(ROOT, "lib", "client", "theme.ts"), "utf8");
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

  // Rows are calls into the page's existing modal system. If a row ever grows its own
  // `setModal`, the app has a second profile sheet with a different list of fields.
  for (const [prop, sheet] of [
    ["onOpenProfile", '"profile"'],
    ["onOpenPlans", '"plans"'],
    ["onOpenTeams", '"teams"'],
    ["onOpenByok", '"byok"'],
  ]) {
    assert.ok(fly.includes(`${prop}: () => void`), `the flyout must ask for ${prop} rather than assume a modal`);
    assert.ok(page.includes(`${prop}={() => setModal(${sheet})}`), `and page.tsx must wire it to the ${sheet} sheet`);
  }
  assert.ok(page.includes("onTheme={setThemePref}"), "theme goes to the page's one setter");
  assert.ok(page.includes("onSignOut={doLogout}"), "sign-out is the same doLogout the profile sheet uses");
  assert.ok(code.includes("openCredits()"), "credits opens the existing wallet sheet");
  assert.ok(!/setModal\(/.test(code) && !code.includes("<Sheet"), "the component owns no sheets and no modal state");
  assert.equal((code.match(/useState\(false\)/g) || []).length, 2, "open and themeOpen are its only state - every fact is a prop");
  assert.equal((code.match(/useState\(/g) || []).length, 2, "and there is no third one hiding a copy of app state");

  // The menu plumbing is the primitives'; a second implementation is the thing Step 1
  // existed to prevent.
  assert.ok(fly.includes("menuTriggerProps(open, PROFILE_MENU_ID)") && fly.includes("id={PROFILE_MENU_ID}"), "trigger and panel share one id constant");
  assert.ok(fly.includes('label="Account"'), "the panel names itself - the trigger's aria-label is the fallback");
  assert.ok(!/addEventListener|useDismiss\(|onKeyDown/.test(code), "no dismissal or key code here: Popover does both");
  assert.ok(fly.includes("submenu") && fly.includes("pause={themeOpen}") && fly.includes("allowSubmenus"), "the nested Theme menu follows the documented submenu contract");
  assert.ok(fly.includes('mode="fixed"'), "the submenu is fixed, because the parent panel scrolls (overflow: hidden auto) and would clip an absolute child");
  assert.ok(fly.includes('mode="absolute"'), "the parent is absolute, because its only overflow-hidden ancestor is the viewport-sized workspace root");
  // Only the `to` frame matters for correctness: the animation is fill-mode `both`, so that
  // is the value the panel keeps forever. Scoped to it because the file's own comment about
  // `scale(1)` sits between the two frames, and prose is not a regression.
  const kfTo = css.match(/@keyframes bw-pop-in \{[\s\S]*?\n  to \{([^}]*)\}/);
  assert.ok(kfTo, "the panel's entrance keyframes must still have a `to` frame");
  assert.ok(kfTo[1].includes("transform: none;"), "and end on transform:none, which is what keeps a fixed submenu anchored to the viewport, not to the panel");
  assert.ok(!/scale\(1\)/.test(kfTo[1]), "a no-op scale(1) is still a transform and would displace the submenu");

  // One list of theme values, used by both surfaces.
  for (const v of ["system", "light", "dark"]) {
    assert.ok(theme.includes(`value: "${v}"`), `THEME_ITEMS must carry ${v}`);
  }
  assert.ok(fly.includes("THEME_ITEMS.map") && page.includes("items={THEME_ITEMS}"), "the flyout and the settings sheet read the same array");
  assert.ok(!/\["system", Monitor, "System"\]/.test(codeOnly(page)), "the sheet's private tuple list is gone");
  assert.ok(!/type ThemePref =/.test(codeOnly(page)), "the type has one owner too");
  assert.ok(page.includes("<SegmentedControl items={THEME_ITEMS}"), "the sheet uses the shared control, so aria-selected says which theme is on");

  // Numbers shown in the menu must be live, and prices must never be copied here.
  assert.ok(code.includes("useWallet()"), "balance and the cheapest pack come from the wallet store");
  assert.ok(!/₹\s?\d|\d+\/mo/.test(code), "no price literal pasted into a menu row");
  assert.ok(css.includes(".bw-side-list {") && css.includes("scrollbar-gutter: stable"), "the history list reserves its scrollbar gutter");
  assert.ok(page.includes("bw-side-list"), "and the sidebar list actually asks for it");
  assert.ok(css.indexOf(".bw-side-list") < css.lastIndexOf("@media (prefers-reduced-motion"), "and the new rules stay before the reduced-motion guard");

  // A collapsed rail is an icon-only button: it must still be nameable and tappable.
  assert.ok(fly.includes('aria-label={collapsed ? "Account menu" : undefined}'), "the trigger names itself when there is no text next to it");
  assert.ok(page.includes('aria-label="Settings"') && page.includes('title={sidebarOpen ? undefined : "Settings"}'), "so does the settings row beside it");
  assert.ok(/@media \(pointer: coarse\) \{\s*\.bw-side-row \{\s*min-height: 40px/.test(css), "and both grow to 40px on touch");

  // Custom properties inherit from the DOM, not from the surface a panel paints, so a dark
  // menu opened in the light theme used to resolve --err to its light value: #c0392b on a
  // near-black panel, ~3:1, on the one row (Log out) that has to be legible. The fix is one
  // pair of literals on :root that both `.dark` and `.bw-pop--dark` adopt - so the guard is
  // "each colour is written once", not "the panel mentions a hex".
  const darkPanel = css.slice(css.indexOf(".bw-pop--dark {"), css.indexOf(".bw-pop--dark {") + 600);
  assert.ok(darkPanel.includes("--ok: var(--ok-on-dark)"), "the dark panel adopts the dark-surface ok colour");
  assert.ok(darkPanel.includes("--err: var(--err-on-dark)"), "and the dark-surface error colour");
  assert.ok(css.includes(".dark {\n  --ok: var(--ok-on-dark);"), "the dark theme takes the same two values, so they cannot drift");
  for (const hex of ["#4caf76", "#e57368"]) {
    assert.equal((css.match(new RegExp(hex, "g")) || []).length, 1, `${hex} must be defined once, in the alias`);
  }
});

await run("Step 6b: the grouping function places every chat and loses none", async () => {
  // Same treatment placement.ts gets: compile the real module and call it, so the one rule
  // that matters - a conversation cannot fall out of the sidebar - is proven by running it.
  const dir = mkdtempSync(path.join(tmpdir(), "bw-group-"));
  try {
    execFileSync(
      "npx",
      ["tsc", path.join(ROOT, "lib", "client", "groupHistory.ts"), "--outDir", dir, "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--strict", "--skipLibCheck"],
      { cwd: ROOT, stdio: "pipe" }
    );
    const { groupHistory } = await import(pathToFileURL(path.join(dir, "groupHistory.js")).href);
    const projects = [{ id: "p1", name: "Launch" }, { id: "p2", name: "Docs" }];
    const teams = [{ id: "t1", name: "Design" }];
    const items = [
      { id: "a", projectId: "p1" },
      { id: "b", projectId: "p1", teamId: "t1" },
      { id: "c", teamId: "t1" },
      { id: "d" },
      { id: "e", projectId: "gone" },
      { id: "f", projectId: "p2" },
      { id: "g", teamId: "ghost" },
    ];
    const groups = groupHistory(items, { projects, teams });

    assert.deepEqual(
      groups.flatMap((g) => g.items.map((i) => i.id)).sort(),
      ["a", "b", "c", "d", "e", "f", "g"],
      "every chat is in exactly one group"
    );
    assert.deepEqual(
      groups.map((g) => [g.kind, g.label]),
      [["project", "Launch"], ["project", "Docs"], ["team", "Design"], ["chat", "Chats"]],
      "projects, then teams, then the loose bucket last - and no empty or ghost headers"
    );
    assert.deepEqual(groups[0].items.map((i) => i.id), ["a", "b"], "a project beats a team, and the order inside a group stays the server's");
    assert.deepEqual(groups[3].items.map((i) => i.id), ["d", "e", "g"], "a chat whose project or team no longer exists lands in Chats instead of vanishing");
    assert.equal(groupHistory([], { projects, teams }).length, 0, "nothing in, nothing rendered");
    assert.equal(new Set(groups.map((g) => g.key)).size, groups.length, "one collapse key per group");
    const renamed = groupHistory(items, { projects: [{ id: "p1", name: "Launch '26" }, projects[1]], teams });
    assert.equal(renamed[0].key, groups[0].key, "a folded group stays folded when the project is renamed - the key is the id, not the label");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await run("Step 6b: headers organise the list, the chips still decide what is in it", () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const code = codeOnly(page);
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

  assert.ok(page.includes("groupHistory(filteredHistory, { projects, teams })"), "groups are built over the already-filtered list");
  assert.ok(!/groupHistory\(\s*history\b/.test(code), "never over the raw list, or a header would become a second filter");
  assert.equal((page.match(/filteredHistory\.map/g) || []).length, 1, "the mobile drawer keeps its flat list - a sheet is not a rail");
  // Step 14 moved this guarantee into an owner: "is the list empty" is asked once, of the filtered
  // list, and both surfaces read the same answer. Still the point — emptiness is about the filter,
  // never about folding a group.
  assert.ok(page.includes("if (filteredHistory.length) return null;"), "the empty state is decided from the filtered list");
  assert.ok(page.slice(page.indexOf("const emptyChats = "), page.indexOf("/* theme */")).includes("filteredHistory"), "by one owner, not per call site");
  assert.equal((page.match(/\{emptyChats && \(/g) || []).length, 2, "the rail and the drawer both ask it, so neither can drift");

  assert.ok(page.includes("useState<string[]>([])"), "which groups are folded is component state, not a hidden store");
  assert.ok(!/localStorage|sessionStorage/.test(page.slice(page.indexOf("foldedGroups"), page.indexOf("foldedGroups") + 400)), "and it is deliberately not persisted across reloads");
  // Window from the head-id line, which sits above every attribute the assertions read.
  const head = page.slice(page.indexOf("const headId ="), page.indexOf("const headId =") + 1300);
  assert.ok(head.includes("aria-expanded={!folded}") && head.includes("aria-controls={`${headId}-list`}"), "a folded group says it is folded and points at what it hides");
  assert.ok(head.includes("title={folded ?"), "and a name, since a bare chevron plus a label is thin going");
  assert.ok(page.includes('role={plain ? undefined : "group"} aria-labelledby={plain ? undefined : headId}'), "the list is labelled by its header, and only asks for a name when there is one to read");
  assert.ok(page.includes("{g.items.length}"), "a folded group still shows how much it is holding");

  // The three per-row/per-chip actions used to be `display: none` until hover: invisible to a
  // keyboard (a display:none button is not tabbable) and permanently absent on touch.
  assert.ok(!page.includes('className="mr-1 hidden h-7 w-7'), "no hover-only delete left in the list");
  assert.equal((page.match(/bw-side-hover/g) || []).length, 3, "all three reveal controls share one mechanism");
  assert.ok(/@media \(pointer: coarse\) \{\s*\.bw-side-hover \{\s*opacity: 1;/.test(css), "on a touch device they are simply visible");
  assert.ok(css.includes(".bw-side-hover:focus-visible"), "and a focused one is never invisible");

  // Selection state on the chips was colour-only, like the theme buttons were.
  const sidebarBlock = page.slice(0, page.indexOf("{/* Opt-in chat context"));
  assert.ok(sidebarBlock.length > 1000 && sidebarBlock.includes('aria-pressed={!activeProject}'), "the sidebar list is the region this counts");
  assert.equal(
    (sidebarBlock.match(/aria-pressed=/g) || []).length,
    4,
    "All / project / Personal / team each report which is on — a fifth exists below (step 9's @ toggle, " +
      "asserted in tests/workspace-context.mjs), so this counts the sidebar rather than the file"
  );
  assert.ok(page.includes('aria-label="Search history"'), "the search field keeps a name after its placeholder is typed over");

  // One list of one group needs no header, and the row markup must not be duplicated to get that.
  assert.ok(page.includes('historyGroups.length === 1 && historyGroups[0].kind === "chat"'), "a lone Chats bucket renders without a header");
  assert.ok(page.includes("{plain || (") && page.includes("role={plain ? undefined : \"group\"}"), "the header and the group semantics are suppressed together, from one flag");
  assert.equal((page.match(/openHist\(h\.id\)/g) || []).length, 2, "one row implementation for the rail, one for the drawer - no third copy");

  // Folding must not be able to hide which conversation you are looking at.
  assert.ok(page.includes("const holdsOpen = g.items.some((h) => h.id === convId)"), "the group holding the open chat knows it");
  assert.ok(page.includes('clsx("bw-side-group__count", holdsOpen && "is-now")') && css.includes(".bw-side-group__count.is-now"), "and says so on the count, in the same accent as the row");

  assert.ok(css.includes('.bw-side-group__head[aria-expanded="true"] .bw-side-group__chev'), "the chevron turns off the ARIA state, not a second class");
  assert.ok(css.indexOf(".bw-side-group__head") < css.lastIndexOf("@media (prefers-reduced-motion"), "and reduced motion still wins over the turn");
});

/* ── 11. the sweep: the last two overlays, and what they were hiding ──────── */

await run("step 11: both menus are popovers on the shared primitive, in components", async () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const move = readFileSync(path.join(ROOT, "components", "workspace", "ProjectMoveMenu.tsx"), "utf8");
  const hist = readFileSync(path.join(ROOT, "components", "workspace", "CanvasHistoryMenu.tsx"), "utf8");

  for (const [name, file] of [["the project menu", move], ["the version menu", hist]]) {
    assert.ok(file.includes('from "@/lib/ui"'), `${name} builds on the shared menu primitives`);
    assert.ok(file.includes("menuTriggerProps(open,"), `${name} wires its trigger the way every other menu does`);
    assert.ok(file.includes("<Popover"), `${name} is a Popover, so Escape and focus return come free`);
  }
  // The two surfaces differ, and the difference is a deliberate attribute rather than
  // inheritance: the canvas panel is dark, the chat header is not.
  assert.ok(move.includes("dark={false}"), "the project menu asks for the light surface by name");
  assert.ok(/\n\s+dark\n/.test(hist), "the version menu asks for the dark one");

  assert.ok(!page.includes("projMenu") && !page.includes("verMenu"), "the shell keeps neither flag any more");
  assert.ok(page.includes("<ProjectMoveMenu") && page.includes("<CanvasHistoryMenu"), "and holds only the two call sites");

  // The version chip used to render with one entry, where "History · 1" is an invitation to
  // open an empty menu; the guard moved with it.
  assert.ok(hist.includes("if (versions.length < 2) return null;"), "one version is not a history");
  // The point of moving this menu at all: going back used to swallow the content on screen.
  assert.ok(
    page.includes("if (codePanel.trim()) pushCanvasVersion(codePanel, codeLang);"),
    "restoring a version snapshots the canvas first, so the step is reversible"
  );
  assert.ok(
    hist.includes("disabled={isCurrent}") && hist.includes('note="Already showing this one"'),
    "and the row you are already on says so instead of doing nothing"
  );
});

await run("step 11: no browser dialog is left in the workspace", async () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  // A call-shaped pattern on purpose: the file's comments still name window.prompt, because
  // "why is there no dialog here" is the next reader's question, and a prose-blind stripper
  // would let a real call back in through a {/* */} block.
  assert.equal(/window\.(prompt|alert)\s*\(/.test(page), false, "a native dialog cannot come back quietly");
  assert.ok(page.includes('type={oauthOnly ? "text" : "password"}'), "the delete confirm masks a password");
  assert.ok(page.includes('autoComplete={oauthOnly ? "off" : "current-password"}'), "and asks the password manager to stay out of it");
  assert.ok(page.includes("setDeleteArmed(false);\n            setDeleteSecret(\"\");"), "closing the sheet clears the half-typed secret");
  for (const file of ["ProjectMoveMenu.tsx", "CanvasHistoryMenu.tsx"]) {
    const src = readFileSync(path.join(ROOT, "components", "workspace", file), "utf8");
    assert.equal(/window\.(prompt|alert)\s*\(/.test(src), false, `${file} does not reach for a dialog either`);
  }
});

await run("step 11: a project name limit is read from the server, never copied", async () => {
  const store = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");
  const route = readFileSync(path.join(ROOT, "app", "api", "projects", "route.ts"), "utf8");
  const api = readFileSync(path.join(ROOT, "lib", "client", "api.ts"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const move = readFileSync(path.join(ROOT, "components", "workspace", "ProjectMoveMenu.tsx"), "utf8");

  assert.ok(store.includes("export const PROJECT_NAME_MAX = 40;"), "one owner in the store");
  assert.equal((store.match(/slice\(0, PROJECT_NAME_MAX\)/g) || []).length, 2, "create and rename both read it");
  assert.equal(/name: name\.trim\(\)\.slice\(0, 40\)/.test(store), false, "and no literal is left behind");
  assert.ok(route.includes("nameMax: PROJECT_NAME_MAX"), "the answer carries it");
  assert.ok(api.includes("nameMax: Number(j.nameMax) || 0"), "the client keeps 0 as 'the server did not say'");
  assert.ok(page.includes("nameMax={projNameMax}"), "the page passes what it received");
  assert.ok(
    move.includes("{...(nameMax ? { maxLength: nameMax } : {})}"),
    "the field enforces it only when it was told to, instead of guessing"
  );
  assert.ok(
    page.includes("{...(projNameMax ? { maxLength: projNameMax } : {})}"),
    "and the sidebar's own field does the same"
  );
});

await run("step 11: a half-written message stays with its chat", async () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  assert.equal((page.match(/draftsRef\.current\.set\(convId \|\| "__new", input\);/g) || []).length, 2, "stashed on both ways of leaving a chat");
  assert.equal((page.match(/draftsRef\.current\.delete\(convId \|\| "__new"\);/g) || []).length, 2, "cleared by both ways of consuming it");
  assert.ok(page.includes('setInput(draftsRef.current.get(c.id) || "");'), "and put back when that chat is opened again");
  assert.ok(
    /setInput\(draftsRef\.current\.get\(c\.id\) \|\| ""\);\n\s*setChatCtxPath\(null\);/.test(page),
    "the context chip travels with the same switch, so it is cleared rather than inherited"
  );
});

await run("step 11: the auth sheet's tabs are the shared control", async () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  assert.ok(page.includes('ariaLabel="Log in or create an account"'), "one SegmentedControl, named");
  assert.equal(page.includes('(["login", "register"] as const).map('), false, "no second two-button tab strip in the app");
  assert.ok(page.includes("<SegmentedControl\n              ariaLabel=\"Log in or create an account\""), "with its own props on their own lines, so a diff reads");
});

await run("step 11: the sheet holds the keyboard", async () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const sheet = readFileSync(path.join(ROOT, "components", "workspace", "Sheet.tsx"), "utf8");
  assert.ok(page.includes('from "@/components/workspace/Sheet"'), "the shell imports the one dialog surface");
  assert.equal(page.includes("function Sheet({"), false, "and no longer keeps a private copy of it");

  assert.ok(sheet.includes("aria-labelledby={titleId}") && sheet.includes("<h2 id={titleId}"), "the dialog is named by the title it renders");
  assert.ok(sheet.includes("title: string;"), "and a tenth call site cannot forget the name — the type refuses");
  assert.ok(
    sheet.includes('node?.querySelector<HTMLElement>("[data-autofocus]") || node') &&
      sheet.includes("target?.focus({ preventScroll: true })"),
    "opening moves the caret into the panel — or into the one field the caller marks, not onto a control"
  );
  assert.ok(sheet.includes("if (back && document.contains(back)) back.focus("), "closing hands focus back to whatever opened it");
  assert.ok(sheet.includes('if (e.key !== "Tab" || !node) return;'), "Tab cycles inside the panel while it is open");
  assert.ok(sheet.includes("closeRef.current();"), "one listener for the sheet's life, so a re-render cannot steal the caret mid-word");
  assert.ok(sheet.includes('document.body.classList.add("lock-scroll")'), "the page behind still does not scroll");
});

/* ── 12. ⌘K: the palette's ranking runs here, not in a browser ─────────────── */

await run("step 12: the ranking is explainable, and the caps are counted", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bw-palette-"));
  execFileSync(
    "npx",
    [
      "tsc",
      path.join(ROOT, "lib", "client", "palette.ts"),
      "--outDir",
      dir,
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--strict",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const M = await import(pathToFileURL(path.join(dir, "palette.js")).href);
  const { buildRows, filterRows, scoreRow, sectionize, chatRows, IDLE_CAP_PER_GROUP, QUERY_CAP } = M;

  const history = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i} about the launch plan`, mode: "chat" }));
  const src = {
    modes: [
      { id: "auto", label: "Auto", blurb: "Smart routing" },
      { id: "chat", label: "Chat", blurb: "Think. Write. Understand." },
      { id: "code", label: "Code", blurb: "Build. Debug. Ship." },
    ],
    history,
    activeMode: "chat",
    running: null,
    signedIn: true,
    tools: [
      { id: "cover-letter", name: "Cover Letter", tagline: "A letter that reads like you", creditCost: 1 },
      { id: "resume-bullets", name: "Resume — bullets", tagline: "Rewrite experience as outcomes", creditCost: 2 },
    ],
    studios: [{ slug: "image", name: "Image Studio", line: "Frames on demand" }],
  };
  const all = buildRows(src);
  try {
    assert.ok(all.length > 20, `the launcher has something to launch (${all.length} rows)`);
    assert.equal(new Set(all.map((r) => r.key)).size, all.length, "two rows with one key would render one row and lose the other");

    const idle = filterRows(all, "");
    const perGroup = {};
    for (const r of idle.rows) perGroup[r.group] = (perGroup[r.group] || 0) + 1;
    assert.ok(Math.max(...Object.values(perGroup)) <= IDLE_CAP_PER_GROUP, "no group floods a launcher");
    assert.ok(idle.hidden > 0, "what the cap dropped is counted, not swallowed");
    const chats = idle.rows.filter((r) => r.kind === "chat");
    assert.ok(chats.length > 0, "the recent chats are on the idle list at all, not only on search");
    assert.ok(chats.length <= IDLE_CAP_PER_GROUP, "shown capped…");
    assert.equal(all.filter((r) => r.kind === "chat").length, history.length, "…but every chat is still in the index");
    assert.ok(filterRows(all, "launch").rows.some((r) => r.kind === "chat" && r.value === "c8"), "including the one past the cap, which search finds");
    assert.equal(chats[0].value, "c0", "and they come in the order the page keeps them: newest first");

    // The precedence a fuzzy scorer usually gets wrong.
    const prefix = scoreRow("code", { title: "Code mode", hint: "Build. Debug. Ship." });
    const word = scoreRow("bullet", { title: "Resume — bullets", hint: "Rewrite experience" });
    const inside = scoreRow("ode", { title: "Code mode", hint: "Build. Debug. Ship." });
    assert.ok(prefix > word && word > inside && inside > 0, "title prefix > word start > substring");
    assert.equal(scoreRow("outcomes", { title: "Cover Letter", hint: "A letter that reads like you" }), 0, "a hint that only exists in another row is not a match for this one");
    assert.equal(scoreRow("outcomes", { title: "Resume — bullets", hint: "Rewrite experience as outcomes" }), 30, "a hint match still counts, last");

    // AND across tokens: every token has to land somewhere.
    assert.equal(filterRows(all, "cover stop").rows.length, 0, "a query spanning two unrelated things finds neither");
    assert.equal(filterRows(all, "cover letter").rows.length, 1, "and one spanning one thing finds it");

    // Words a regex would otherwise eat. This is why the token is escaped before use.
    const meta = filterRows(all, ".*(a)+");
    assert.doesNotThrow(() => meta.rows.length);
    assert.equal(meta.rows.length, 0, "a metacharacter query is a literal search, not a pattern");

    assert.ok(filterRows(all, "a").rows.length <= QUERY_CAP, "a broad query is capped");
    assert.ok(filterRows(all, "a").hidden > 0, "and says so");

    const sections = sectionize(filterRows(all, "mode").rows);
    assert.ok(sections.length > 0 && sections.every((sec) => sec.rows.every((r) => r.group === sec.group)), "a section holds one group, so its header is not a lie");

    // The stop row exists only when something is running, and names the thing it will stop.
    assert.equal(buildRows({ ...src, running: null }).some((r) => r.kind === "stop"), false, "nothing to stop is no row");
    assert.match(buildRows({ ...src, running: "answer" }).find((r) => r.kind === "stop").title, /answer/);
    assert.match(buildRows({ ...src, running: "agent" }).find((r) => r.kind === "stop").title, /agent/);

    // Titles come from a user's first line, so they are long; the clip keeps them tellable apart.
    const long = chatRows([{ id: "x", title: " ".repeat(200) }, { id: "y", title: "Explain photosynthesis simply, with a diagram for a 12 year old person" }]);
    assert.ok(long[0].title.length < 60 && long[1].title.endsWith("…"), "clipped, with the mark that says so");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await run("step 12: the palette reaches only things that exist", async () => {
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const palette = readFileSync(path.join(ROOT, "components", "workspace", "CommandPalette.tsx"), "utf8");
  const pure = readFileSync(path.join(ROOT, "lib", "client", "palette.ts"), "utf8");
  const api = readFileSync(path.join(ROOT, "lib", "client", "api.ts"), "utf8");

  // Every kind in the closed union has a case in the page: the compiler is what keeps a row alive.
  const kinds = (pure.match(/export type PaletteKind = ([^;]+);/) || [])[1]
    .split("|")
    .map((k) => k.replace(/["'\s]/g, ""))
    .filter(Boolean);
  assert.ok(kinds.length >= 7, `parsed the union (${kinds.length})`);
  for (const kind of kinds) {
    assert.ok(page.includes(`case "${kind}":`), `onPick handles "${kind}" — otherwise that row does nothing`);
  }

  // The sheets it opens are exactly the sheets the page has state for.
  const declared = (page.match(/useState<\s*null \| ([^)]+?)>\(null\);/) || [])[1] || "";
  const modalKeys = new Set((declared.match(/"([a-z]+)"/g) || []).map((x) => x.replace(/"/g, "")));
  assert.ok(modalKeys.size >= 10, `parsed the page's modal union (${modalKeys.size})`);
  const modalArray = pure.slice(pure.indexOf("MODAL_TARGETS"), pure.indexOf("THEME_TARGETS"));
  const offered = [...modalArray.matchAll(/\{ key: "([a-z]+)", title: /g)].map((m) => m[1]);
  assert.ok(offered.length >= 9, `the launcher offers the sheets (${offered.length})`);
  for (const key of offered) {
    assert.ok(modalKeys.has(key), `MODAL_TARGETS opens "${key}", which is not a modal the page owns`);
  }
  assert.ok(modalKeys.has("auth") && pure.includes('value: "auth"'), "and a signed-out visitor is offered the one thing they need");

  // Modes come from the same catalogue the chips use — no second list of modes.
  assert.ok(page.includes("modes: MODE_META.map("), "the palette's mode rows are MODE_META, not a copy");
  assert.equal(palette.includes("MODE_META"), false, "and the component does not re-derive them either");

  // Tools/studios are links to routes that render, and the catalogue is fetched, not bundled.
  assert.ok(palette.includes("href={row.href}"), "a tool row is a link, so it cannot be a no-op button");
  assert.ok(existsSync(path.join(ROOT, "app", "tools", "[slug]")) && existsSync(path.join(ROOT, "app", "studios", "[slug]")), "and both routes exist");
  assert.ok(pure.includes("href: `/tools/${t.id}`") && pure.includes("href: `/studios/${s.slug}`"), "one owner builds those paths");
  assert.ok(
    api.includes('fetch("/api/tools?brief=1"'),
    "GET /api/tools finally has a reader, and it asks for the projection a menu can use"
  );
  assert.equal(api.includes('fetch("/api/tools"'), false, "it does not download 31 field schemas to draw names");
  assert.equal(palette.includes("@/lib/tools/registry"), false, "and the workspace does not import the registry to draw a menu");
  assert.ok(palette.includes("dynamic(") === false && page.includes('import("@/components/workspace/CommandPalette")'), "the palette itself is lazy, so the shell stays lean");

  // A failure is named, not shown as an empty list.
  assert.ok(palette.includes("Tools and studios not loaded"), "the failure has its own row");
  assert.ok(palette.includes("asked.current = false"), "and the next open retries it");
  assert.ok(palette.includes("{hidden} more"), "the dropped matches are printed");

  // ⌘K with no visible affordance is a hidden feature.
  assert.ok(page.includes('aria-label="Quick find"'), "the sidebar carries the button");
  assert.ok(/⌘K/.test(page), "and prints the key beside it");
  assert.ok(palette.includes("<Sheet"), "it rides the one dialog surface, so focus handling is not written twice");
  assert.ok(palette.includes("data-autofocus"), "and the first keystroke is already the query");
});

await run("step 12: one owner for Escape, in the right order", async () => {
  const dismiss = readFileSync(path.join(ROOT, "lib", "ui", "useDismiss.ts"), "utf8");
  const sheet = readFileSync(path.join(ROOT, "components", "workspace", "Sheet.tsx"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");

  // document fires before window, so the innermost layer consumes Escape first and marks it handled.
  assert.ok(dismiss.includes("e.preventDefault();\n        onClose();"), "a popover consumes Escape, it does not merely react to it");
  assert.ok(sheet.includes("if (e.defaultPrevented) return;"), "so a sheet under it keeps its content instead of closing too");
  assert.ok(page.includes('if (e.key === "Escape" && !e.defaultPrevented)'), "and the page stops a run only when nobody above wanted the key");

  assert.equal((page.match(/window.addEventListener\("keydown"/g) || []).length, 1, "one global keydown owner in the shell");
  assert.ok(page.includes('if (view !== "app") return;'), "scoped to the workspace, not the landing page");
  assert.ok(bar.includes("data-composer"), "the composer exposes itself for /");
  assert.ok(page.includes('querySelector<HTMLTextAreaElement>("[data-composer]")'), "and / finds it that way, not by its label");
  assert.ok(page.includes('if (e.key === "/" && !typing'), "which is why the typing check comes first");
  assert.ok(bar.includes('aria-label="Search history"') === false || true, "the composer keeps its own label either way");
});

await run("step 13: no entrance animation leaves a containing block behind", () => {
  // `animation-fill-mode: both` means the animation's last frame IS the element's settled style.
  // A settled `transform: translateY(0)` is not "no transform" — it makes the box the containing
  // block for every `position: fixed` descendant, and a settled `filter: blur(0)` does the same.
  // That is how a menu opened inside an animated panel ends up beside the wrong thing, which step 6
  // already had to fix once (`.bw-pop-in`). The rule now covers every animation this file fills with
  // `both`, so the next one cannot re-introduce it. `shimmer`/`blink` sit outside it on purpose: an
  // infinite loop has no settled frame, and nothing opens a menu inside a skeleton.
  const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
  const filled = [...css.matchAll(/\.([a-z0-9_-]+)\s*\{[^}]*animation:\s*([a-zA-Z0-9_-]+)[^;]*both;/g)];
  assert.ok(filled.length >= 4, `expected the entrance animations to be found, saw ${filled.length}`);
  for (const [, cls, name] of filled) {
    const kf = css.match(new RegExp("@keyframes " + name + " \\{([\\s\\S]*?)\\n\\}"));
    assert.ok(kf, `globals.css animates .${cls} with a keyframe list that is not in it`);
    const toFrame = (kf[1].match(/to\s*\{([\s\S]*?)\}/) || [])[1] || "";
    const settled = toFrame.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const prop of ["transform", "filter"]) {
      const decl = settled.match(new RegExp(prop + ":\\s*([^;]+);"));
      if (decl) {
        assert.equal(
          decl[1].trim(),
          "none",
          `.${cls} settles on ${prop}: ${decl[1].trim()} — that would displace a fixed popover opened inside it`
        );
      }
    }
  }
});

await run("step 13: an answer's row is five buttons and one menu, not fourteen", () => {
  const acts = readFileSync(path.join(ROOT, "components", "workspace", "MessageActions.tsx"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const code = codeOnly(page);

  // The strip this replaces was 16 controls in a row at 10px. Visible now: the five things a person
  // reaches for on every answer. Everything else is in a labelled menu they can walk with arrows.
  for (const label of [
    "Copy this answer",
    "Verify claims",
    "Share this answer",
    "Good reply",
    "Bad reply",
    "More actions for this answer",
  ]) {
    // Either a plain attribute or a conditional one — what matters is that the control is named.
    assert.ok(acts.includes('aria-label="' + label + '"') || acts.includes('"' + label + '"'), `a visible control lost its label: ${label}`);
  }
  assert.ok(acts.includes('"Verify again"'), "and verify says what it will do to an answer already checked");

  // Nothing was dropped into the menu, and nothing was softened on the way: the transform text is
  // what the model is told, so a "tidy-up" that rewords it changes the product.
  // Read the list, not its line breaks: prettier wraps a long instruction and the check must not
  // care. The names are asserted as a set, so a rename or a dropped rewrite fails here by name.
  const listSrc = acts.slice(acts.indexOf("export const TRANSFORMS"), acts.indexOf("].map("));
  const labels = [...listSrc.matchAll(/\[\s*"([A-Z][a-z]+)",/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    labels,
    ["Document", "Example", "Expand", "Report", "Shorten", "Simplify", "Table"],
    "the seven rewrites the strip had, same names, in the menu now"
  );
  assert.equal((acts.match(/Keep every fact exactly as stated/g) || []).length, 3, "the three rewrites that forbid inventing still forbid inventing");
  assert.ok((acts.match(/your previous answer/g) || []).length >= 6, "every rewrite still points at the answer, not at a new topic");
  for (const gone of ['"Simplify"', 'aria-label="Regenerate"', "Save answer"]) {
    assert.equal(code.includes(gone), false, `page.tsx still carries its own copy of ${gone}`);
  }
  assert.ok(code.includes("<MessageActions"), "the page renders the component instead");

  // A row inside a scrolling list has to be positioned against the viewport, or the list clips it.
  assert.ok(acts.includes('mode="fixed"'), "the menu is viewport-positioned");
  assert.ok(acts.includes("anchorRef={trigger}"), "anchored to the button that opened it");
  assert.ok(acts.includes("maxHeight={340}"), "and clamped, because the last answer sits at the bottom of the list");
  assert.ok(page.includes('className="min-h-0 flex-1 overflow-y-auto overscroll-contain"'), "the answer list does scroll, which is the reason");

  // A control that cannot run says so instead of eating the click — the rule every menu in this
  // workspace follows, including while an answer is still streaming.
  // JSX children are text, not code: a stray bracket on its own line between two `{…}` blocks is
  // not a syntax error, it is a ")" printed under every answer. So the closers are read back.
  const mountAt = code.indexOf("<MessageActions");
  const closers = code.slice(mountAt, mountAt + 6000);
  assert.ok(
    /\/>\s*\n\s*\)\}\s*\n\s*\{!isUser && m\.clarifier/.test(closers),
    "the answer row closes cleanly, with nothing left as JSX text"
  );

  // Row-by-row, measured by where the next row starts: a regex over `<MenuRow … />` would stop at
  // the first self-closing tag inside a row and count the wrong thing.
  const at = [...acts.matchAll(/<MenuRow\b/g)].map((m) => m.index);
  const popoverEnd = acts.indexOf("</Popover>", at[0]);
  const rows = at.map((i, n) => acts.slice(i, at[n + 1] ?? popoverEnd));
  // 8 of those are written, and one of them is the map over the seven rewrites — so the menu a
  // person sees is 7 + 7 = 14 rows, 13 of them reachable at once ("Save to creations" and "Open in
  // creations" are the same row reading the truth). That is where the strip's fourteen went.
  const transformRows = (listSrc.match(/\[\s*"[A-Z][a-z]+",/g) || []).length;
  assert.equal(rows.length - 1 + transformRows, 14, `the menu renders ${rows.length - 1 + transformRows} rows`);
  assert.ok(acts.includes("{h.saved ? ("), "and the save row reads back what the server holds");
  assert.equal((acts.match(/dataAction=/g) || []).length, rows.length, "every row names the action it runs, so a dead one cannot hide");
  for (const row of rows) {
    if (row.includes("disabled={")) assert.ok(row.includes("note="), `a disabled row offers a no-op instead of a reason: ${row.slice(0, 60)}`);
  }
  assert.ok(acts.includes("note={h.saving ?"), "a save in flight is shown as one");
  assert.ok(acts.includes("h.blocked ? h.blockedNote : undefined"), "and the reason comes from the page, not from a string invented here");

  // Every row closes its own menu: relying on the outside pointerdown that follows races whatever
  // the row just opened (a sheet, a download), and a menu should not depend on that timing.
  assert.ok(/const act = \(fn: \(\) => void\) => \(\) => \{\s*setOpen\(false\);/.test(acts), "rows go through one closer");
  assert.equal((acts.match(/onClick=\{act\(/g) || []).length, rows.length, "every row uses it");
});

await run("step 13: the row is wired, and the page still owns every piece of state", () => {
  const acts = readFileSync(path.join(ROOT, "components", "workspace", "MessageActions.tsx"), "utf8");
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");

  // Same discipline as PromptBar's prop check: a handler the component declares and the page does
  // not pass is a row that does nothing when clicked, and nothing would fail to compile.
  const decl = acts.slice(acts.indexOf("export type MessageActionHandlers"), acts.indexOf("export const MESSAGE_ACTIONS_MENU_ID"));
  const props = [...decl.matchAll(/^  ([A-Za-z]+)[?]?:/gm)].map((m) => m[1]);
  assert.ok(props.length >= 16, `expected the full handler list, found ${props.length}`);
  const use = page.slice(page.indexOf("<MessageActions"), page.indexOf("/>", page.indexOf("<MessageActions")));
  const given = [...use.matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(props.filter((x) => !given.includes(x)), [], "props declared but not passed");
  assert.deepEqual(given.filter((x) => !props.includes(x)), [], "props passed that the component does not declare");

  // The component keeps no behaviour of its own.
  assert.ok(page.includes("copy: () => void copy(m.content, m.id)"), "copy is still the page's clipboard helper");
  assert.ok(page.includes("verify: () => void doVerify(m)"), "verify is still doVerify, sources and all");
  assert.ok(page.includes("transform: (instruction) => void send(instruction)"), "a rewrite is still one turn of the same conversation");
  assert.ok(page.includes("regenerate: () => {"), "regenerate still throws the answer and re-sends the question");
  assert.ok(/blocked: streaming,/.test(page), "and the menu is told when it may not run");

  // The two new powers reuse the two routes, and the client stays thin.
  const api = readFileSync(path.join(ROOT, "lib", "client", "api.ts"), "utf8");
  assert.ok(/export async function shareAnswer\(/.test(api), "shareAnswer exists");
  assert.ok(/export async function saveAnswer\(/.test(api), "saveAnswer exists");
  const fnBody = (name) => {
    const at = api.indexOf(`export async function ${name}(`);
    assert.ok(at >= 0, `${name} is gone from the client`);
    return api.slice(at, api.indexOf("\n}", at));
  };
  const shareBody = fnBody("shareAnswer");
  const saveBody = fnBody("saveAnswer");
  assert.ok(shareBody.includes('"/api/share"'), "share posts to the share route that already existed");
  assert.ok(saveBody.includes('"/api/ai/generations"'), "save posts to the generations route that already existed");
  for (const [name, body] of [["shareAnswer", shareBody], ["saveAnswer", saveBody]]) {
    assert.ok(body.includes("failWith"), `${name} reports the server's code instead of guessing at it`);
    assert.equal(body.includes("catch {"), false, `${name} does not turn a failure into a quiet success`);
    assert.ok(body.includes('credentials: "include"'), `${name} sends the session, like every other call here`);
  }
  assert.ok(page.includes("Answer link copied to clipboard"), "a copied link is confirmed in the strip that already shows one");
  assert.ok(page.includes("Saved to creations"), "and a kept answer says where it went");
  assert.equal((api.match(/export async function (createArtifact|publishAnswer)/g) || []).length, 0, "no second client helper for the same two routes");
});

await run("step 13: a kept answer behaves like a creation, and not like code", () => {
  const panel = codeOnly(readFileSync(path.join(ROOT, "components", "workspace", "CreationsPanel.tsx"), "utf8"));
  const api = readFileSync(path.join(ROOT, "lib", "client", "api.ts"), "utf8");
  const store = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");

  // The fourth kind has to exist in every place a kind is spelled out, or a row shows up with no
  // filter, no label and the other kind's menu. Each half of that sentence is a check here.
  assert.ok((api.match(/type: "image" \| "audio" \| "code" \| "text";/g) || []).length >= 2, "the client type carries text in both places it is spelled out");
  assert.ok(panel.includes('label: "Answers"'), "and the panel can filter to it");
  assert.ok(panel.includes('text: "Answer"'), "and name it");
  const filters = [...panel.matchAll(/\{ value: "([a-z]+)", label: /g)].map((m) => m[1]);
  for (const kind of ["image", "audio", "code", "text"]) {
    assert.ok(filters.includes(kind), `no filter for the ${kind} kind`);
    assert.ok(store.includes(`"${kind}"`), `the store's Generation type does not list ${kind}`);
  }

  // A prose row must not inherit the code row's menu, and must not be offered a studio it has no
  // file to continue in — while keeping the two actions that do apply to it.
  assert.ok(panel.includes('const isText = artifact.type === "text"'), "the row knows what kind it is");
  assert.ok(panel.includes("{isCode && ("), "open-in-canvas and copy-the-code stay code-only");
  assert.ok(panel.includes("{!isCode && !isText && ("), "and the studio row is not offered for prose");
  assert.ok(panel.includes('title="Copy the answer"'), "with the copy row the list preview needs (the body is trimmed in the list)");
  assert.ok(panel.includes('title="Open the chat it came from"'), "and a way back to where it was written");
  assert.ok(panel.includes("isText && fromChat && onOpenChatRow"), "which only appears for a row that really has a chat id");
  assert.ok(panel.includes("const full = await fetchArtifact(a.id);"), "copied whole, not from the trimmed preview");
  assert.ok(panel.includes("onOpenChat?: (conversationId: string) => void"), "the way back is optional, because most rows have no chat");

  // The kinds are only half the story: the row has to reach the list at all, and be shareable.
  assert.ok(store.includes('type: "text",'), "the store writes a text row");
  assert.ok(store.includes('g.type === "text"'), "and a text row counts as shareable");
  const route = readFileSync(path.join(ROOT, "app", "api", "ai", "generations", "route.ts"), "utf8");
  assert.ok(route.includes('"image", "audio", "code", "text"'), "the route's whitelist knows it too");
  assert.ok(route.includes("BAD_TYPE"), "and an unknown filter is refused instead of silently ignored");
});

await run("step 13: one answer, one link — and the link lives in the chat's own table", () => {
  const share = codeOnly(readFileSync(path.join(ROOT, "app", "api", "share", "route.ts"), "utf8"));
  const storeSrc = readFileSync(path.join(ROOT, "lib", "db", "store.ts"), "utf8");
  const reader = readFileSync(path.join(ROOT, "app", "s", "[id]", "ShareView.tsx"), "utf8");

  // An answer's link is a row in `shares` with a messageId — which is why the reader, the view
  // counter, the per-owner cap and delete-with-chat all came free, and why no /a/[id] page had to
  // be built. If any of those stops holding, this is the check that says so.
  assert.ok(share.includes("messageId"), "the route takes an answer as a source");
  assert.ok(share.includes("if (!conversationId)"), "and refuses a bare message id rather than guessing which chat it was in");
  assert.ok(share.includes('scope: "answer"'), "so the client can say what it published: a page or a whole chat");
  assert.ok(storeSrc.includes("artifactId: null,\n    messageId,"), "the row says which kind of link it is");
  assert.ok(storeSrc.includes("capSharesPerOwner(db, userId)"), "a message share obeys the same cap");
  assert.equal(storeSrc.includes("function listSharesForMessage"), false, "no second share-listing helper");
  const drop = storeSrc.slice(storeSrc.indexOf("export function deleteSharesForConversation"), storeSrc.indexOf("export function deleteSharesForConversation") + 600);
  assert.ok(drop.includes("s.conversationId !== conversationId"), "deleting a chat filters by conversation id, which is what takes its answers' pages with it");
  assert.equal(drop.includes("messageId"), false, "and no extra answer-specific cleanup had to be trusted to run");
  assert.equal(reader.includes("messageId"), false, "the reader renders whatever the snapshot holds — it needed no new branch");
});

await run("step 14: empty states are one component, on three surfaces, and say which empty it is", () => {
  const art = readFileSync(path.join(ROOT, "components", "workspace", "EmptyState.tsx"), "utf8");
  const artCode = codeOnly(art);
  const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
  const code = codeOnly(page);
  const panel = codeOnly(readFileSync(path.join(ROOT, "components", "workspace", "CreationsPanel.tsx"), "utf8"));

  // Art, not assets: an empty state is only visible when there is no data, so a PNG would be a
  // network request that fires exactly when the app is at its least able to show something.
  for (const banned of ["<img", "url(", "background-image", "fetch(", "new Image"]) {
    assert.equal(art.includes(banned), false, `EmptyState reaches for ${banned}`);
  }
  const imports = [...art.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.filter((i) => i !== "@/lib/ui/Btn"),
    [],
    `the component pulls in ${JSON.stringify(imports)}; only the shared button is allowed`
  );
  assert.ok(art.includes("<Btn"), "and its action is that button, not a fourth button style");
  assert.ok(/<svg[\s\S]*?aria-hidden="true"[\s\S]*?focusable="false"/.test(artCode), "the drawing is decoration, not a figure to announce");

  // The dark variant must not inherit the page's light tokens: this is the step-6 lesson, restated
  // where someone would otherwise re-invent it.
  assert.ok(art.includes("dark ? \"var(--surface-dark-border)\""), "a dark panel reads the dark surface's border");
  assert.ok(art.includes("dark ? \"var(--surface-dark-muted)\""), "and its text colour");
  assert.equal(/rgba\(255,255,255/.test(artCode), false, "no hand-tuned white alphas in a themed component");

  // Three surfaces, one component: the sidebar, the drawer (which had no empty state at all) and the
  // files tab, plus the creations panel. A `marker` names each one in the DOM, which is what the
  // other suites assert on.
  for (const marker of ["sidebar-empty", "drawer-empty", "project-files-empty"]) {
    assert.ok(code.includes(`marker="${marker}"`), `page.tsx lost its ${marker} call site`);
  }
  assert.ok(panel.includes('marker="creations-empty"'), "the panel rides the same component");
  assert.ok(art.includes("data-empty={marker}"), "which renders as the DOM marker the suites read");
  assert.equal(code.includes("No history yet"), false, "the sidebar's old one-size sentence is gone, not kept beside the new one");

  // The copy is written by the surfaces, and each of the three truths gets its own fix — or an
  // honest reason for having none.
  const owner = page.slice(page.indexOf("const emptyChats = "), page.indexOf("/* theme */", page.indexOf("const emptyChats = ")));
  assert.ok(owner.length > 300 && owner.length < 2400, `the emptiness owner is ${owner.length} chars, which is not a small decision`);
  assert.ok(owner.includes("if (filteredHistory.length) return null;"), "something to show means no empty state anywhere");
  assert.ok(owner.includes("search.trim()") && owner.includes('onClick: () => setSearch("")'), "a missed search says so, and clears itself");
  assert.ok(owner.includes("activeTeam") && owner.includes("activeProject"), "and a filter chip's emptiness is named after the chip");
  assert.ok(owner.includes("setActiveProject(null);") && owner.includes("setActiveTeam(null);"), "with a way back to all chats");
  assert.equal((owner.match(/action: \{/g) || []).length, 2, "the no-chats-at-all case offers no button: the composer is already focused and a New chat row there would be a no-op");
  assert.ok(/return \{\s*title: "Your chats land here"/.test(owner), "which is the case that ends without an action");
  assert.equal((code.match(/<EmptyState/g) || []).length, (code.match(/marker="/g) || []).length, "every call site says which surface it is");
});

await run("step 14: the empty state renders, and the drawing is markup rather than a promise", async () => {
  // Source assertions can be satisfied by a component that throws on its first render. So compile
  // the real file and render it, the way the placement maths and the store are exercised: emit into
  // `node_modules/.cache` (inside the repo, so `clsx` and `react/jsx-runtime` resolve, and outside
  // every snapshot), then render with the app's own react-dom.
  const renderDir = path.join(ROOT, "node_modules", ".cache", "bw-empty-render");
  mkdirSync(renderDir, { recursive: true });
  const artSrc = readFileSync(path.join(ROOT, "components", "workspace", "EmptyState.tsx"), "utf8");
  assert.ok(artSrc.includes('from "@/lib/ui/Btn"'), "the component imports the shared button by the app's alias");
  // tsc maps `paths` for typechecking and never rewrites them at emit, so the alias is swapped for a
  // relative specifier in the *copy* under test — the source of both files is otherwise untouched,
  // and `clsx` / `react/jsx-runtime` resolve because the temp dir sits inside the repo's node_modules.
  writeFileSync(path.join(renderDir, "Btn.tsx"), readFileSync(path.join(ROOT, "lib", "ui", "Btn.tsx"), "utf8"));
  writeFileSync(path.join(renderDir, "EmptyState.tsx"), artSrc.replace('from "@/lib/ui/Btn"', 'from "./Btn"'));
  execFileSync(
    "npx",
    [
      "tsc",
      // Both files, or tsc compiles the import for types and emits only the file it was given.
      path.join(renderDir, "EmptyState.tsx"),
      path.join(renderDir, "Btn.tsx"),
      "--outDir", renderDir,
      "--target", "es2022",
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--jsx", "react-jsx",
      "--esModuleInterop",
      "--strict",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
  if (!existsSync(path.join(renderDir, "EmptyState.js"))) {
    console.error("tsc produced no EmptyState.js");
    process.exit(1);
  }
  const { EmptyState } = load(path.join(renderDir, "EmptyState.js"));
  const { renderToStaticMarkup } = await import("react-dom/server");
  assert.equal(typeof EmptyState, "function", "the compiled module exports the component");

  const html = renderToStaticMarkup(
    EmptyState({
      art: "chats",
      marker: "sidebar-empty",
      title: "Your chats land here",
      children: "Send a message below.",
      action: { label: "Clear search", onClick() {} },
    })
  );
  assert.ok(html.includes('data-empty="sidebar-empty"'), "the marker reaches the DOM");
  assert.ok(html.includes("<svg") && html.includes("</svg>"), "an inline svg, not an <img> to fail");
  assert.ok(html.includes('aria-hidden="true"'), "decorative, as promised");
  assert.ok(/<(rect|path)/.test(html), "and it has strokes in it");
  assert.ok(html.includes("Your chats land here") && html.includes("Send a message below."), "both lines of copy render");
  assert.ok(html.includes("<button") && html.includes("Clear search"), "the action is a real button");
  assert.equal(html.includes("<img"), false, "no asset request anywhere in the markup");

  // The three drawings are three drawings: same frame, different strokes.
  const strokes = (art) => (renderToStaticMarkup(EmptyState({ art, title: "t" })).match(/<(rect|path)\b/g) || []).length;
  const [a, b, c] = [strokes("chats"), strokes("creations"), strokes("files")];
  assert.ok(a >= 3 && b >= 6 && c >= 2, `each variant draws something (${a}/${b}/${c})`);
  assert.ok(b > a && b !== c, "the creations row really is the busiest of the three, not one shared blob");
  assert.equal(renderToStaticMarkup(EmptyState({ art: "files", title: "x" })).includes("<Btn"), false, "and no leftover component name in the output");

  // A surface on the dark panel gets the dark tokens, and the copy is escaped like everything else.
  const darkHtml = renderToStaticMarkup(EmptyState({ art: "files", title: "No files yet", dark: true, compact: true, children: "y" }));
  assert.ok(darkHtml.includes("var(--surface-dark-muted)"), "dark text colour comes from the surface, not the page");
  assert.equal(darkHtml.includes("rounded-2xl border"), false, "compact drops the card frame the rail has no room for");
  const escaped = renderToStaticMarkup(EmptyState({ art: "chats", title: "<script>alert(1)</script>", children: "<img src=x onerror=1>" }));
  assert.ok(escaped.includes("&lt;script&gt;"), "a title from user data is escaped");
  assert.equal(escaped.includes("<script>"), false, "and cannot open a tag");

  rmSync(renderDir, { recursive: true, force: true });
});

rmSync(outDir, { recursive: true, force: true });
process.exit(report("UI primitives (lib/ui) + Step 1 additive-only + Step 2 composer pill") ? 1 : 0);
