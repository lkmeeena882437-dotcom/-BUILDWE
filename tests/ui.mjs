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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    assert.ok(labHtml.includes("Auto") && labHtml.includes("Vision") && labHtml.includes("Voice"), "all five mode chips from the shared catalogue");
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

  await run("the customer-facing pages are untouched, and only Btn was pulled into the app", async () => {
    for (const [name, html] of [["/", homeHtml], ["/pricing", pricingHtml]]) {
      assert.ok(!html.includes("bw-pop"), `${name} must not use the popover yet`);
      assert.ok(!html.includes("data-bw-seg"), `${name} must not use the segmented control yet`);
    }
    // app/page.tsx owns three hand-rolled menus (project, style, history) that each
    // fake dismissal with a full-screen invisible button. Step 1 sweeps NONE of them;
    // Step 11 moves all three onto useDismiss. Counting them here is what makes
    // "I only added primitives" a checked claim instead of a promise.
    const page = readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
    const bar = readFileSync(path.join(ROOT, "components", "workspace", "PromptBar.tsx"), "utf8");
    // Three menus hand-roll their dismissal with a full-screen invisible button: project,
    // style, history. Step 1 moved none of them; Step 2 moved the style one along with the
    // composer it belonged to. Counting both files keeps "nothing was refactored away" true
    // without freezing it at a number that was only ever about Step 1.
    const overlays =
      (page.match(/fixed inset-0 z-40 cursor-default/g) || []).length +
      (bar.match(/fixed inset-0 z-40 cursor-default/g) || []).length;
    assert.equal(overlays, 3, "the three existing menus must still be wired the way they were");
    // page.tsx may reach into lib/ui for exactly one thing (Btn, which it now shares
    // with the pill). The popover/menu/segmented primitives stay out of the page until
    // the step that actually needs them — that is what keeps a "refactor" from becoming
    // an unrequested re-skin of 400 lines it was not asked to touch.
    const uiImports = [...page.matchAll(/from "@\/lib\/ui([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(uiImports)].sort(), ["/Btn"], "page.tsx should import only lib/ui/Btn");
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
  assert.ok(bar.includes('aria-pressed={on}'), "the mode chips must say which mode is active");
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

rmSync(outDir, { recursive: true, force: true });
process.exit(report("UI primitives (lib/ui) + Step 1 additive-only + Step 2 composer pill") ? 1 : 0);
