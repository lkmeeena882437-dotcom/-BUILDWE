#!/usr/bin/env node
/**
 * Markdown renderer safety tests (audit C2) — run against the real module.
 *
 * The share page renders message bodies with `dangerouslySetInnerHTML`, so the
 * renderer IS the security boundary. Its old version escaped `& < >` but not
 * quotes, which is enough for text and useless inside an attribute:
 *
 *   [x](https://e" onmouseover="alert(1))     →  executed for every reader
 *   ```js" onload="alert(1)"                  →  executed for every reader
 *
 * The share page renders client-side, so the served HTML cannot prove this in
 * an HTTP test — hence compiling lib/safe-md.ts and asserting on its output
 * directly. No fixtures, no snapshot files: the payloads are the report's.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Repo root relative to this file, so the test works from any cwd.
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "lib", "safe-md.ts");
const outDir = mkdtempSync(path.join(tmpdir(), "bw-md-"));

try {
  execFileSync(
    "npx",
    [
      "tsc",
      SRC,
      "--outDir",
      outDir,
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--strict",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
} catch (e) {
  console.error("could not compile lib/safe-md.ts\n", e.stdout?.toString(), e.stderr?.toString());
  process.exit(1);
}

const emitted = path.join(outDir, "safe-md.js");
if (!existsSync(emitted)) {
  console.error(`tsc produced no ${emitted}`);
  process.exit(1);
}

const { renderSafeMarkdown, escapeHtml, safeHref, safeLang } = await import(pathToFileURL(emitted).href);

const out = [];
const check = (name, fn) => {
  try {
    fn();
    out.push(`  PASS  ${name}`);
  } catch (e) {
    out.push(`  FAIL  ${name}\n          ${e.message.split("\n")[0]}`);
  }
};

check("quotes cannot break out of an attribute", () => {
  const html = renderSafeMarkdown('[x](https://e" onmouseover="alert(1))');
  // The dangerous outcome is an ATTRIBUTE in a live tag. Inert escaped text
  // that merely mentions onmouseover is what we want instead.
  assert.ok(
    !/<[a-zA-Z][^>]*\bonmouseover\s*=/i.test(html),
    `handler reached a tag: ${html}`
  );
  assert.ok(!/<a\s/i.test(html), `a link tag was built from a broken URL: ${html}`);
});

check("javascript:/data:/vbscript: URLs are dropped, not sanitised-into-existence", () => {
  for (const evil of [
    "[a](javascript:alert(1))",
    "[a](JaVaScRiPt:alert(1))",
    "[a](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[a](vbscript:msgbox(1))",
    "[a]( javascript:alert(1))",
  ]) {
    const html = renderSafeMarkdown(evil);
    assert.ok(!/href=/.test(html), `an href was produced for ${evil} → ${html}`);
    assert.ok(!/alert\(1\)</.test(html.replace(/&lt;/g, "<")), `script text escaped into life: ${html}`);
  }
});

check("raw HTML in a message is inert text", () => {
  const html = renderSafeMarkdown('<img src=x onerror=alert(1)> <script>alert(2)</script>');
  assert.ok(!/<img/i.test(html), `img tag survived: ${html}`);
  assert.ok(!/<script/i.test(html), `script tag survived: ${html}`);
  assert.ok(/&lt;script&gt;/.test(html), "script should be visible as text, not executed");
});

check("code-fence language is an allow-list, not free text", () => {
  const html = renderSafeMarkdown('```js" onload="alert(1)\ncode\n```');
  assert.ok(
    !/<[a-zA-Z][^>]*\bonload\s*=/i.test(html),
    `fence label reached a tag attribute: ${html}`
  );
  assert.ok(/data-lang|bw-pre-lang/.test(html), "fence should still render as a code block");
  assert.equal(safeLang('js" onload="x'), "text");
  assert.equal(safeLang("tsx"), "tsx");
  assert.equal(safeLang("a".repeat(99)), "text");
});

check("legit formatting still works (a security layer nobody uses is reverted)", () => {
  const html = renderSafeMarkdown(
    "# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n[docs](https://example.com/a?b=1&c=2)\n\n```py\nprint('hi')\n```"
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>one<\/li>/);
  assert.match(html, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.match(html, /<pre class="bw-pre"><div class="bw-pre-lang">py<\/div><code>print\(&#39;hi&#39;\)/);
  assert.ok(!/<p><pre/.test(html), "a code block must not be wrapped in a paragraph");
});

check("escapeHtml covers every character that can close an attribute", () => {
  const s = escapeHtml(`&<>"'`);
  assert.equal(s, "&amp;&lt;&gt;&quot;&#39;");
});

check("safeHref keeps http/https/mailto and rejects the rest", () => {
  assert.ok(safeHref("https://ok.example/x"));
  assert.ok(safeHref("http://ok.example/x"));
  assert.ok(safeHref("mailto:hi@example.test"));
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,x"), null);
  assert.equal(safeHref("/relative/only"), null);
  assert.equal(safeHref("https://x\" onmouseover=\"y"), null);
});

rmSync(outDir, { recursive: true, force: true });

console.log("\nMarkdown renderer safety (lib/safe-md.ts)\n");
console.log(out.join("\n"));
const failed = out.filter((l) => l.includes("FAIL")).length;
console.log(
  `\n${out.length - failed}/${out.length} checks passed` + (failed ? ` — ${failed} FAILED\n` : "\n")
);
process.exit(failed ? 1 : 0);
