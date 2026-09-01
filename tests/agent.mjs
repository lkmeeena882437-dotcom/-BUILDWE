#!/usr/bin/env node
/**
 * Coding-agent tool calls: create_file has to actually create a file.
 *
 * Models trained on Cursor / Claude Code emit `create_file` (and `contents` /
 * `file_path`). The loop used to parse that JSON, then hit `unknown tool`, so
 * a whole run could spend credits and write nothing.
 *
 * Run: npm run test:agent
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { report, run } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

await run("write_file actually checks whether the store accepted the file", () => {
  const src = readFileSync(path.join(ROOT, "lib", "ai", "agent.ts"), "utf8");
  assert.ok(src.includes('if ("error" in saved)'), "a refused write must not be reported as wrote N chars");
  assert.ok(src.includes("create_file is the same tool"), "the prompt names the alias the parser accepts");
});

const outDir = mkdtempSync(path.join(tmpdir(), "bw-agent-"));
try {
  try {
    execFileSync(
      "npx",
      [
        "tsc",
        path.join(ROOT, "lib", "ai", "agent-parse.ts"),
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
      { cwd: ROOT, stdio: "pipe" }
    );
  } catch (e) {
    throw new Error(`could not compile lib/ai/agent-parse.ts\n${e.stdout || ""}${e.stderr || ""}`);
  }
  const emitted = path.join(outDir, "agent-parse.js");
  assert.ok(existsSync(emitted), "tsc produced agent-parse.js");
  const M = await import(pathToFileURL(emitted).href);

  await run("create_file is write_file, with the file's path and body intact", () => {
    const call = M.parseToolCall(
      JSON.stringify({
        tool: "create_file",
        path: "index.html",
        content: "<!doctype html><h1>Hi</h1>",
        lang: "html",
      })
    );
    assert.equal(call.tool, "write_file");
    assert.equal(call.path, "index.html");
    assert.equal(call.content, "<!doctype html><h1>Hi</h1>");
    assert.equal(call.lang, "html");
  });

  await run("the names models actually emit still land", () => {
    const contents = M.parseToolCall(
      `Here you go\n\`\`\`json\n{"tool":"create_file","file_path":"app.js","contents":"console.log(1)"}\n\`\`\``
    );
    assert.equal(contents.tool, "write_file");
    assert.equal(contents.path, "app.js");
    assert.equal(contents.content, "console.log(1)");

    const openai = M.parseToolCall(
      JSON.stringify({
        name: "create_file",
        arguments: { path: "src/main.ts", content: "export const ok = true;" },
      })
    );
    assert.equal(openai.tool, "write_file");
    assert.equal(openai.path, "src/main.ts");
    assert.equal(openai.content, "export const ok = true;");

    const encoded = M.parseToolCall(
      JSON.stringify({
        name: "create_file",
        arguments: JSON.stringify({ filename: "readme.md", body: "# Hello" }),
      })
    );
    assert.equal(encoded.path, "readme.md");
    assert.equal(encoded.content, "# Hello");
  });

  await run("write_file still parses, and junk is not a tool call", () => {
    const write = M.parseToolCall('{"tool":"write_file","path":"a.js","content":"x"}');
    assert.equal(write.tool, "write_file");
    assert.equal(M.parseToolCall("sure, I can help with that"), null);
    assert.equal(M.parseToolCall('{"tool":"shell","command":"rm -rf /"}'), null);
    assert.equal(M.canonicalToolName("create-file"), "write_file");
    assert.equal(M.canonicalToolName("CREATE_FILE"), "write_file");
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

process.exit(report("coding agent create_file") ? 1 : 0);
