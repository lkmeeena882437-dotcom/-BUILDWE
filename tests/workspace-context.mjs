/**
 * Step 9: chat ↔ workspace context, and the file block a model can hand back.
 *
 * WHAT IS NOT MOCKED HERE
 * -----------------------
 * The app runs for real: the chat route, the system-block assembly, the project-files
 * store, the write validation and the SSE framing all execute as written. The single
 * substitution is the vendor — `AI_BASE_URL_GROQ` points the real OpenAI-wire adapter
 * at a localhost endpoint that records what it was sent and streams a scripted answer.
 * That is deliberate: the only way to prove "the model saw the open file" is to look at
 * the bytes that left the server, and the only way to prove "the reply can be applied"
 * is to write the file and read it back.
 *
 * Run: npm run test:workspace
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { newJar, report, req, run, startServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3347;
const FIXTURE_PORT = 3348;
const src = (p) => readFileSync(path.join(ROOT, p), "utf8");
const codeOnly = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\/\*\*)/.test(l))
    .join("\n");
/** Backticks inside a JS string are a readability trap; one constant instead. */
const FENCE = "\u0060\u0060\u0060";

/* ── the two new modules, compiled from source ─────────────────────────── */

const outDir = mkdtempSync(path.join(tmpdir(), "bw-wsctx-"));
const MODULES = ["lib/ai/file-blocks.ts", "lib/ai/workspace-context.ts"];
try {
  execFileSync(
    "npx",
    [
      "tsc",
      ...MODULES.map((m) => path.join(ROOT, m)),
      "--outDir",
      outDir,
      "--target",
      "es2022",
      // CommonJS: the emitted relative import is extensionless, which ESM refuses.
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
} catch (e) {
  console.error("could not compile lib/ai context modules\n", e.stdout?.toString(), e.stderr?.toString());
  process.exit(1);
}
for (const m of MODULES) {
  const emitted = path.join(outDir, path.basename(m).replace(/\.ts$/, ".js"));
  if (!existsSync(emitted)) {
    console.error(`tsc produced no ${emitted}`);
    process.exit(1);
  }
}
const load = createRequire(path.join(outDir, "probe.cjs"));
const { extractFileBlocks, fileBlockExample, FILE_FENCE_LANG } = load("./file-blocks.js");
const { formatProjectContext, fileEditInstruction, parseContextInput, CONTEXT_BUDGET_CHARS } = load(
  "./workspace-context.js"
);

/* ── provider fixture ──────────────────────────────────────────────────── */

let reply = "Nothing to change — the file already does what you asked.";
const calls = [];

const fixture = http.createServer((rq, res) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* */
    }
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    calls.push({
      system: messages.map((m) => String(m?.content || "")).join("\n\u0000\n"),
      at: Date.now(),
    });
    const text = reply;
    if (parsed?.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const piece of text.match(/[\s\S]{1,160}/g) || [text]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));

const srv = await startServer({
  port: PORT,
  label: "bw-wsctx",
  env: {
    GROQ_API_KEY: "bw-fixture-key",
    AI_BASE_URL_GROQ: `http://127.0.0.1:${FIXTURE_PORT}/v1/chat/completions`,
    CREDITS_WELCOME: "500",
    SIGNUPS_PER_IP_PER_HOUR: "1000",
    SIGNUPS_PER_EMAIL_PER_DAY: "1000",
    SIGNUPS_GLOBAL_PER_DAY: "1000",
  },
});
const BASE = srv.base;
const MARKER = "export const launched = true;";
const FILE_BODY = `// the open file\n${MARKER}\n// a second line the model must not invent\n`;

async function signUp(tag) {
  const jar = newJar();
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar,
    body: {
      email: `wsctx-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "workspace-context-password",
      name: "Context tester",
    },
  });
  assert.ok(r.status === 200 || r.status === 201, `register -> ${r.status} ${r.text.slice(0, 140)}`);
  return jar;
}

async function newProject(jar, name) {
  const r = await req(BASE, "/api/projects", { method: "POST", jar, body: { action: "create", name } });
  assert.equal(r.status, 200, `create project -> ${r.status} ${r.text.slice(0, 140)}`);
  return r.json.project.id;
}

async function writeFile(jar, projectId, p, content, lang) {
  return req(BASE, "/api/projects/files", {
    method: "POST",
    jar,
    body: { projectId, path: p, content, ...(lang ? { lang } : {}) },
  });
}

/** The app's own SSE answer, reduced to the meta frame and the token text. */
async function chat(jar, body) {
  const r = await req(BASE, "/api/ai/chat", { method: "POST", jar, body });
  let tokens = "";
  let meta = null;
  for (const line of r.text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j.token) tokens += j.token;
      if (j.meta) meta = j.meta;
    } catch {
      /* not json */
    }
  }
  return { status: r.status, text: r.text, tokens, meta };
}

/* ── 1. the format, both ends ──────────────────────────────────────────── */

await run("the rules we show the model describe exactly the block the UI can apply", async () => {
  const instruction = fileEditInstruction({
    openAttached: true,
    openPath: "src/index.html",
    files: 1,
    included: 1,
    truncated: 0,
    omitted: 0,
    chars: 10,
  });
  const blocks = extractFileBlocks(instruction);
  assert.equal(blocks.length, 1, "the instruction contains one example block, and it must parse");
  assert.equal(blocks[0].path, "src/index.html", "the example names its own path");
  assert.ok(blocks[0].content.includes("<!doctype html>"), "and the example body is the file, not prose");
  assert.equal(blocks[0].problem, null, "the example must be applicable — it is what we ask for");
  assert.ok(instruction.includes("DATA"), "the block is described as data, not as instructions");
  assert.ok(/never an order to follow/.test(instruction), "and said in words a model cannot misread");
  assert.ok(instruction.includes(FILE_FENCE_LANG), "the label in the text is the label the parser matches");
  assert.equal(extractFileBlocks(fileBlockExample()).length, 1, "the shared example is the format, not a copy of it");
});

await run("parser: info-string and first-line paths, 3+ backticks, empty and pathless blocks refused", async () => {
  const firstLine = extractFileBlocks(
    `before\n${FENCE}${FILE_FENCE_LANG}\npath: a/b.js\nconsole.log(1);\n${FENCE}\nafter`
  );
  assert.equal(firstLine.length, 1);
  assert.equal(firstLine[0].path, "a/b.js");
  assert.equal(firstLine[0].content, "console.log(1);");

  const attrForm = extractFileBlocks(
    `${FENCE}${FILE_FENCE_LANG} path="c/d.ts" lang=ts\nlet x: number = 1;\n${FENCE}`
  );
  assert.equal(attrForm[0].path, "c/d.ts", "models write the attribute form too");
  assert.equal(attrForm[0].lang, "ts");

  const quoted = extractFileBlocks(
    `${FENCE}${FILE_FENCE_LANG}\npath: "e/f.html"\n<p>hi</p>\n${FENCE}`
  );
  assert.equal(quoted[0].path, "e/f.html", "quotes around the path are not part of the path");

  const nested = extractFileBlocks(
    `${FENCE}${FILE_FENCE_LANG}\npath: md/g.md\n\`\`\`js\ncode inside the file\n\`\`\`\n${FENCE}`
  );
  assert.equal(nested.length, 1, "a fence inside the file does not end its own block");
  assert.ok(nested[0].content.includes("code inside the file"));

  const noPath = extractFileBlocks(`${FENCE}${FILE_FENCE_LANG}\njust some code\n${FENCE}`);
  assert.equal(noPath[0].path, "");
  assert.match(noPath[0].problem, /did not name a file/, "no path means no guess, and a stated reason");

  const empty = extractFileBlocks(`${FENCE}${FILE_FENCE_LANG}\npath: h/i.js\n\n${FENCE}`);
  assert.match(empty[0].problem, /empty/, "an empty block would blank the file — refused");

  const two = extractFileBlocks(
    `${FENCE}${FILE_FENCE_LANG}\npath: one.js\n1\n${FENCE}\ntext\n${FENCE}${FILE_FENCE_LANG}\npath: two.js\n2\n${FENCE}`
  );
  assert.deepEqual(two.map((b) => b.path), ["one.js", "two.js"], "one block per file, in order");

  const normal = extractFileBlocks(`${FENCE}js\nconst unrelated = 1;\n${FENCE}`);
  assert.equal(normal.length, 0, "an ordinary code fence is never an apply offer");
});

await run("formatter: the open file is first, and nothing is cut silently", async () => {
  const files = [
    { path: "src/app.js", lang: "js", content: FILE_BODY },
    { path: "src/big.js", lang: "js", content: "x".repeat(30_000) },
    { path: "README.md", lang: "md", content: "# readme" },
  ];
  const cut = formatProjectContext(files, { purpose: "chat", openPath: "src/app.js", budgetChars: 4000 });
  assert.equal(cut.stats.openAttached, true);
  assert.ok(cut.text.includes("THE OPEN FILE"), "the block says which file the reader is in");
  assert.ok(cut.text.indexOf("src/app.js") < cut.text.indexOf("README.md"), "open file before the others");
  assert.ok(cut.text.includes(MARKER), "its contents are there in full");
  assert.ok(/truncated: \d+ chars not sent/.test(cut.text), "a cut file says so, in the block itself");
  assert.equal(cut.stats.included + cut.stats.omitted, 3, "every file is accounted for: included or omitted");
  assert.ok(cut.stats.truncated >= 1, "and the count of cut files comes back for the UI to show");
  assert.ok(cut.stats.chars <= 4600, `budget respected (got ${cut.stats.chars})`);

  // A budget below the 1200-char floor is raised to it, so the test asks for the floor.
  const many = [
    { path: "src/app.js", lang: "js", content: FILE_BODY },
    { path: "a.js", lang: "js", content: "a".repeat(9000) },
    { path: "b.js", lang: "js", content: "b".repeat(9000) },
    { path: "c.js", lang: "js", content: "c".repeat(9000) },
    { path: "tiny.md", lang: "md", content: "# tiny" },
  ];
  const tight = formatProjectContext(many, { purpose: "chat", openPath: "src/app.js", budgetChars: 1200 });
  assert.ok(tight.stats.omitted >= 1, "a budget that runs out drops files rather than lying about them");
  assert.ok(/omitted \(context budget of 1200 chars reached\)/.test(tight.text), "and names the number in the block");
  assert.equal(tight.stats.included + tight.stats.omitted, 5, "nothing vanishes silently");
  assert.ok(tight.text.includes("# tiny") || tight.stats.omitted >= 2, "a small file is kept while big ones are cut, not dropped by an even split");

  const gone = formatProjectContext(files, { purpose: "chat", openPath: "src/deleted.js" });
  assert.equal(gone.stats.openAttached, false, "a stale path is reported, not silently re-pointed at another file");

  const empty = formatProjectContext([], { purpose: "chat" });
  assert.equal(empty.text, "", "no files means no block — no tokens spent on nothing");
  assert.ok(
    formatProjectContext(files, { purpose: "code" }).text.startsWith("PROJECT FILES (3)"),
    "code mode keeps its own wording"
  );
});

await run("context input: shape only, and it refuses before any work happens", async () => {
  assert.deepEqual(parseContextInput(undefined), { ok: true, value: null });
  assert.deepEqual(parseContextInput(null), { ok: true, value: null });
  assert.deepEqual(parseContextInput({ projectId: "p1", path: " a/b.js " }), {
    ok: true,
    value: { projectId: "p1", path: "a/b.js" },
  });
  for (const bad of ["p1", 42, [], {}, { projectId: "p1" }, { path: "a" }, { projectId: "", path: "a" }]) {
    const r = parseContextInput(bad);
    assert.equal(r.ok, false, `refused: ${JSON.stringify(bad)}`);
    assert.equal(r.code, "BAD_CONTEXT");
  }
  assert.equal(parseContextInput({ projectId: "p".repeat(200), path: "a" }).ok, false, "absurd ids are not shape");
});

/* ── 2. the routes ─────────────────────────────────────────────────────── */

try {
  const jar = await signUp("owner");
  const projectId = await newProject(jar, "Launch page");
  const wrote = await writeFile(jar, projectId, "src/app.js", FILE_BODY, "js");
  assert.equal(wrote.status, 200, `seed file written: ${wrote.text.slice(0, 120)}`);

  await run("with a context chip, the provider is sent the open file and the edit contract", async () => {
    calls.length = 0;
    const r = await chat(jar, {
      messages: [{ role: "user", content: "make the launch flag a const" }],
      projectId,
      context: { projectId, path: "src/app.js" },
    });
    assert.equal(r.status, 200, r.text.slice(0, 160));
    assert.equal(calls.length, 1, "one provider call");
    const sys = calls[0].system;
    assert.ok(sys.includes(MARKER), "the file body is in the system message");
    assert.ok(sys.includes("THE OPEN FILE"), "and it is marked as the open one");
    assert.ok(sys.includes("WORKSPACE EDITS"), "plus how to hand an edit back");
    assert.ok(sys.includes(FILE_FENCE_LANG), "plus the fence the UI understands");
    assert.ok(r.meta?.context?.attached === true, `meta reports what was attached: ${JSON.stringify(r.meta)}`);
    assert.equal(r.meta.context.openPath, "src/app.js");
    assert.ok(r.meta.context.chars > MARKER.length, "and how many bytes it cost");
  });

  await run("no chip, no context: the provider sees no file body at all", async () => {
    calls.length = 0;
    const r = await chat(jar, { messages: [{ role: "user", content: "what is a const?" }], projectId });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].system.includes(MARKER), "not one byte of the project file");
    assert.ok(!calls[0].system.includes("WORKSPACE EDITS"), "and no edit contract to confuse the answer with");
    assert.ok(!r.meta?.context, "no context meta when nothing was attached");
  });

  await run("a stale chip costs the answer nothing, and says why", async () => {
    calls.length = 0;
    const r = await chat(jar, {
      messages: [{ role: "user", content: "edit it" }],
      projectId,
      context: { projectId, path: "src/deleted-just-now.js" },
    });
    assert.equal(r.status, 200, "the chat proceeds — a renamed file is not a broken prompt");
    assert.ok(r.tokens.length > 0, "and an answer arrives");
    assert.equal(r.meta?.context?.attached, false);
    assert.equal(r.meta?.context?.reason, "not_found", "the UI can say exactly what happened");
    assert.ok(!calls[0].system.includes("WORKSPACE EDITS"), "nothing was attached, so nothing was promised to the model");
  });

  await run("a malformed context is a 400 before the model is called", async () => {
    calls.length = 0;
    const r = await req(BASE, "/api/ai/chat", {
      method: "POST",
      jar,
      body: { messages: [{ role: "user", content: "hi" }], context: "src/app.js" },
    });
    assert.equal(r.status, 400, r.text.slice(0, 160));
    assert.equal(r.json.code, "BAD_CONTEXT");
    assert.equal(calls.length, 0, "and no provider call, so no cost and no credit spent");
  });

  await run("another user's project id resolves to nothing, never to their files", async () => {
    const other = await signUp("other");
    const otherProject = await newProject(other, "Private thing");
    const secret = "const notYours = true;";
    assert.equal((await writeFile(other, otherProject, "secret.js", secret, "js")).status, 200);
    calls.length = 0;
    const r = await chat(jar, {
      messages: [{ role: "user", content: "read my neighbour" }],
      projectId: otherProject,
      context: { projectId: otherProject, path: "secret.js" },
    });
    assert.equal(r.status, 200, "answered, with no context");
    assert.ok(!calls[0].system.includes(secret), "the file body never left the other account's store");
    assert.equal(r.meta?.context?.attached, false);
    assert.equal(r.meta?.context?.reason, "empty_project", "reported as 'nothing to attach', which is what isolation looks like");
  });

  await run("an answer's file block becomes a real file, byte for byte", async () => {
    reply = [
      "Done — here is the file.",
      "",
      `${FENCE}${FILE_FENCE_LANG}`,
      "path: src/app.js",
      "export const launched = true;",
      "export const ready = true;",
      FENCE,
      "",
      "and a second one:",
      "",
      `${FENCE}${FILE_FENCE_LANG}`,
      "path: src/ready.js",
      "lang: js",
      "export const ready = true;",
      FENCE,
    ].join("\n");
    const r = await chat(jar, {
      messages: [{ role: "user", content: "set both flags" }],
      projectId,
      context: { projectId, path: "src/app.js" },
    });
    const blocks = extractFileBlocks(r.tokens);
    assert.equal(blocks.length, 2, "both blocks are offered, one row each");
    assert.deepEqual(blocks.map((b) => b.path), ["src/app.js", "src/ready.js"]);
    assert.equal(blocks[1].lang, "js");

    // Exactly what the row's button does, through the existing files API.
    for (const b of blocks) {
      const w = await writeFile(jar, projectId, b.path, b.content, b.lang);
      assert.equal(w.status, 200, `apply ${b.path}: ${w.text.slice(0, 140)}`);
    }
    const listed = await req(BASE, `/api/projects/files?projectId=${encodeURIComponent(projectId)}`, { jar });
    assert.equal(listed.status, 200);
    const found = listed.json.files.find((f) => f.path === "src/app.js");
    assert.ok(found, "the file is listed");
    const one = await req(
      BASE,
      `/api/projects/files?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(found.id)}`,
      { jar }
    );
    assert.equal(
      one.json.file.content,
      "export const launched = true;\nexport const ready = true;",
      "and it holds exactly the block's content — the tail newline is gone, the code is not"
    );
    assert.ok(
      !one.json.file.content.includes("a second line the model must not invent"),
      "the previous file was replaced, not appended to — an apply is a write, not a merge"
    );
    reply = "Nothing to change.";
  });

  await run("an Apply that the server refuses carries the server's reason, not a fake tick", async () => {
    const escape = await writeFile(jar, projectId, "../../etc/passwd", "x", "js");
    assert.equal(escape.status, 400, "a traversal path is refused");
    assert.equal(escape.json.code, "INVALID_PATH", "with a code the row can branch on");
    assert.ok(escape.json.error, "and a sentence it can show");

    const big = await writeFile(jar, projectId, "huge.js", "y".repeat(120_001), "js");
    assert.equal(big.status, 400, "the size cap is enforced, not clamped");
    assert.equal(big.json.code, "FILE_TOO_LARGE");
    assert.match(big.json.error, /120,000/, "and the limit is named in the message");

    const ghost = await writeFile(jar, "proj_does_not_exist", "a.js", "x", "js");
    assert.equal(ghost.status, 400);
    assert.equal(ghost.json.code, "PROJECT_NOT_FOUND");
    for (const bad of [escape, big, ghost]) {
      assert.ok(bad.json.code && bad.json.error, "every refusal has a code and a sentence, never a bare 500");
      assert.ok(!bad.json.ok, "and no success field to misread");
    }
  });

  await run("wiring: opt-in per file, server-reported, and never offered mid-stream", async () => {
    const page = src("app/page.tsx");
    const code = codeOnly(page);
    assert.ok(
      code.includes("? { context: { projectId: currentProjectId, path: chatCtxPath } }"),
      "the chip is the only thing that attaches context"
    );
    assert.ok(page.includes("m.context ? <ContextNote context={m.context} />"), "the note reads the server's meta");
    assert.ok(page.includes("<FileApplyBlocks"), "and the apply rows are rendered from the answer");
    for (const f of ["app/s/[id]/page.tsx", "app/s/[id]/ShareView.tsx"]) {
      assert.equal(
        src(f).includes("FileApplyBlocks"),
        false,
        `a shared page shows the answer but never a button that writes into someone's project (${f})`
      );
    }
    assert.ok(page.includes('beat("project_file_apply")'), "an apply is counted as an apply, not as a canvas save");
    assert.equal((code.match(/!isUser && !m\.streaming && m\.context/g) || []).length, 1);
    assert.ok(code.includes("setChatCtxPath(null);"), "a new chat starts with nothing attached");
    // Raw source here, not codeOnly: what identifies the effect is its *comment*, and
    // codeOnly strips comments (that is what it is for).
    assert.ok(
      /useEffect\(\(\) => \{\n\s+\/\/ A path belonging to another project[\s\S]{0,160}setChatCtxPath\(null\);\n\s+\}, \[currentProjectId\]\);/.test(
        page
      ),
      "and switching project drops the stale path instead of resolving it against the wrong one"
    );
    const at = page.indexOf('aria-pressed={chatCtxPath === f.path}');
    const toggle = page.slice(at - 420, at + 320); // the indentation makes these lines long
    assert.ok(toggle.includes('type="button"'), "the toggle is a real button, tabbable by hand");
    assert.ok(toggle.includes("aria-pressed"), "and says whether it is on");
    assert.ok(toggle.includes("Stop using"), "and the label changes when it is on");
    assert.ok(!/hover\\:opacity|group-hover/.test(page.slice(page.indexOf("{/* Opt-in chat context"), page.indexOf("{/* Opt-in chat context") + 900)), "never hover-only: a keyboard and a tablet must reach it");
  });

  await run("code mode keeps its own apply path — no fence contract handed to it", async () => {
    const route = src("app/api/ai/code/route.ts");
    assert.equal(route.includes("fileEditInstruction"), false, "telling Code mode to answer in a fence would break the canvas flow it already has");
    assert.ok(route.includes('purpose: "code"'), "it keeps the project block, with the open file emphasised");
    assert.ok(route.includes("parseContextInput(body.context)"), "and the same shape validation");
    // Update 15 moved this behind `contextMeta`, which reports the attached
    // stats AND the "asked for a project, got nothing" case. The rule is
    // unchanged: whatever it sends, it tells the UI.
    assert.ok(route.includes("attached: true as const, ...contextStats"), "it still reports what it attached");
    assert.ok(route.includes("context: contextMeta"), "and the meta frame carries it");
    assert.equal(
      codeOnly(src("lib/db/store.ts")).includes("buildProjectContext"),
      false,
      "the store's old formatter is gone, not shadowed (comments may still explain where it went)"
    );
    assert.equal(CONTEXT_BUDGET_CHARS, 12_000, "the budget Code mode already had — Chat must not cost more");
  });

  await run("bundle hygiene: the client gets the parser, not the prompt", async () => {
    const card = src("components/chat/FileApplyBlocks.tsx");
    assert.ok(card.includes('from "@/lib/ai/file-blocks"'), "Apply uses the parser module");
    assert.equal(/from "@\/lib\/ai\/workspace-context"/.test(card), false, "and does not download the system-prompt text");
    assert.ok(card.includes("data-file-blocks="), "rows are countable in markup, for the lab and for this suite");
    assert.ok(card.includes("role=\"alert\"") || card.includes("role={'alert'}"), "a refusal is announced to a screen reader");
    assert.equal(src("lib/ai/file-blocks.ts").includes("node:"), false, "the parser stays free of server imports");
    assert.ok(
      card.includes("useMemo(() => extractFileBlocks(text), [text])"),
      "and it runs once per finished answer, not once per keystroke in the composer"
    );
  });
} finally {
  fixture.close();
  fixture.closeAllConnections?.();
  srv.stop();
}

process.exit(report("chat-to-workspace context (step 9)"));
