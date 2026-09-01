/**
 * Step 10: the creations list (pin / rename / share / delete) and a share page that
 * renders on the server.
 *
 * WHAT IS NOT MOCKED HERE
 * -----------------------
 * Part A drives `lib/db/store.ts` itself — compiled from the same source the app runs, in
 * its own throwaway data dir — because five of the rules are *ordering and refusal* rules
 * that no HTTP call in this sandbox can reach (an audio row without a stored file needs
 * media storage; the per-owner share cap needs 51 links). Part B runs the real app: the
 * code route, the artifacts API, the share API, `/s/[id]`'s server render, all as written.
 * The single substitution is the vendor — `AI_BASE_URL_GROQ` points the real OpenAI-wire
 * adapter at a localhost endpoint that streams a scripted answer, which is how a `code`
 * generation gets written by the product rather than by the test.
 *
 * Run: npm run test:artifacts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { newJar, report, req, run, startServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3349;
const FIXTURE_PORT = 3350;
const src = (p) => readFileSync(path.join(ROOT, p), "utf8");

/* A suite this size takes a minute and a half mostly waiting for a dev server to compile,
   and a run that prints nothing looks like a run that is stuck. One line per check, so a
   timeout names the check instead of the suite. */
let stepNo = 0;
const step = async (name, fn) => {
  console.log(`  · ${String(++stepNo).padStart(2, "0")} ${name}`);
  await run(name, fn);
};

/* ── Part A: the store, compiled from source ───────────────────────────── */

const outDir = mkdtempSync(path.join(tmpdir(), "bw-artifacts-"));
writeFileSync(
  path.join(outDir, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2022",
        // CommonJS: the emitted relative import is extensionless, which ESM refuses.
        module: "commonjs",
        moduleResolution: "node",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        // A tsconfig outside the repo finds no node_modules of its own, so the type
        // roots are named — otherwise fs/path/crypto are "missing modules" and the
        // compile of the very file under test fails on bookkeeping.
        lib: ["es2022", "dom"],
        types: ["node"],
        typeRoots: [path.join(ROOT, "node_modules", "@types").replace(/\\/g, "/")],
        noEmit: false,
        rootDir: ROOT.replace(/\\/g, "/"),
        outDir: outDir.replace(/\\/g, "/"),
        baseUrl: ROOT.replace(/\\/g, "/"),
        paths: { "@/*": ["./*"] },
      },
      include: [path.join(ROOT, "lib/db/store.ts").replace(/\\/g, "/")],
    },
    null,
    2
  )
);
try {
  execFileSync("npx", ["tsc", "-p", path.join(outDir, "tsconfig.json")], {
    cwd: ROOT,
    stdio: "pipe",
  });
} catch (e) {
  console.error("could not compile the store for the artifact tests\n", e.stdout?.toString(), e.stderr?.toString());
  process.exit(1);
}
// A require("@/lib/config") from the emitted file has no tsconfig to lean on, so the alias
// becomes a real path once: one shim, no build tooling.
const shim = path.join(outDir, "node_modules", "@", "lib");
mkdirSync(shim, { recursive: true });
writeFileSync(
  path.join(shim, "config.js"),
  `module.exports = require(${JSON.stringify(path.join(outDir, "lib", "config.js").replace(/\\/g, "/"))});\n`
);
const storePath = path.join(outDir, "lib", "db", "store.js");
if (!existsSync(storePath)) {
  console.error(`tsc produced no ${storePath}`);
  process.exit(1);
}
const dataDir = mkdtempSync(path.join(tmpdir(), "bw-artifacts-data-"));
process.env.BUILDWE_DATA_DIR = dataDir;
const dbFile = path.join(dataDir, "buildwe.json");
const load = createRequire(path.join(outDir, "probe.cjs"));
const require = createRequire(path.join(ROOT, "noop.cjs"));
const store = load(storePath);

const ALICE = store.createUser({ email: "a@t.test", password: "password-1234", name: "A" }).id;
const BOB = store.createUser({ email: "b@t.test", password: "password-1234", name: "B" }).id;

/* ── Step 13: one answer, shareable and keepable (the store's own rules) ── */

const ANSWER =
  "Photosynthesis is how a leaf turns light into sugar: chlorophyll catches the light, water is " +
  "split, carbon dioxide is reduced to glucose, and oxygen is released as the leftover.";

const chatPair = (answer = ANSWER) => [
  { id: "u-1", role: "user", content: "Explain photosynthesis simply", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "a-1", role: "assistant", content: answer, createdAt: "2026-01-01T00:00:05.000Z" },
];

/* A separate account, on purpose: these checks write generations and shares, and the step-10
   checks that run after them assert exact lists for ALICE. Two blocks of one file must not be
   able to see each other's rows — that is how a green run turns into a flaky one. */
const KEEP = store.createUser({ email: "k@t.test", password: "password-1234", name: "K" }).id;
const seedChat = (messages) =>
  store.createConversation({ userId: KEEP, mode: "chat", title: "Photosynthesis", messages });

await step("an answer is found by id together with the question it answered", () => {
  const conv = seedChat([
    ...chatPair(),
    { id: "u-2", role: "user", content: "and at night?", createdAt: "2026-01-01T00:02:00.000Z" },
    { id: "a-2", role: "assistant", content: "It rests.", createdAt: "2026-01-01T00:02:04.000Z" },
  ]);

  const pair = store.findAnswerPair(conv.id, "a-1", KEEP);
  assert.ok(pair, "the row is found for its owner");
  assert.equal(pair.message.id, "a-1");
  assert.equal(pair.question.content, "Explain photosynthesis simply", "the nearest earlier user message");
  assert.equal(
    store.findAnswerPair(conv.id, "a-2", KEEP).question.id,
    "u-2",
    "measured per answer, not whatever the chat opened with"
  );

  assert.equal(store.findAnswerPair(conv.id, "u-1", KEEP), null, "a pasted-in question is not an answer to share");

  // A lone answer (a resumed session, a chat that started mid-thread) is still the model's own
  // writing, so it resolves — with the question reported as missing rather than invented, and the
  // share publishing one message.
  const answerOnly = seedChat([{ id: "a-9", role: "assistant", content: ANSWER }]);
  const lone = store.findAnswerPair(answerOnly.id, "a-9", KEEP);
  assert.equal(lone.question, null, "no question is guessed at");
  assert.deepEqual(
    store.createMessageShare(answerOnly.id, "a-9", KEEP).share.messages.map((m) => m.id),
    ["a-9"],
    "one message published, not a fake pair"
  );

  // The refusals that matter: a stranger holding the conversation id, and an id that is not a row.
  assert.equal(store.findAnswerPair(conv.id, "a-1", BOB), null, "scoped to its owner, not to whoever asks");
  assert.equal(store.findAnswerPair("conv-nope", "a-1", KEEP), null, "and a wrong id is no row at all");
});

await step("saving an answer makes one creation, and saving it again refreshes that row", () => {
  const conv = seedChat(chatPair());

  const first = store.saveAnswerAsArtifact(conv.id, "a-1", KEEP);
  assert.ok(first.ok, `first save: ${first.code}`);
  assert.ok(first.created, "the first save creates");
  assert.equal(first.artifact.type, "text", "a kept answer is its own kind, not a pretend code file");
  const row = store.getArtifact(first.artifact.id, KEEP);
  assert.equal(row.meta.from.messageId, "a-1", "and the row says which answer it is");
  assert.equal(row.prompt, "Explain photosynthesis simply", "the question travels with it, which is what the list shows");
  assert.ok(!row.outputUrl, "a prose row has no file to open, so the panel must not offer one");

  const again = store.saveAnswerAsArtifact(conv.id, "a-1", KEEP);
  assert.equal(again.ok && again.created, false, "the second save is a refresh");
  assert.equal(again.artifact.id, first.artifact.id, "the same row, not a copy of it");
  assert.equal(
    store.listArtifacts(KEEP, "text").filter((g) => g.meta.from?.messageId === "a-1").length,
    1,
    "and the list holds one"
  );

  // Guards the product needs, because both paths hang off a button a person can double-click, and
  // both are reachable for any id a stranger could guess.
  assert.equal(
    store.saveAnswerAsArtifact(seedChat(chatPair("ok")).id, "a-1", KEEP).code,
    "ANSWER_TOO_SHORT",
    "a one-word answer is not worth a creation, and the reason is said out loud"
  );
  assert.equal(
    store.saveAnswerAsArtifact(conv.id, "a-1", BOB).code,
    "ANSWER_NOT_FOUND",
    "a stranger gets the same message as a wrong id, so nothing is confirmed either way"
  );
});

await step("an answer's share snapshots the pair, refreshes in place and dies with the chat", () => {
  const conv = seedChat([
    ...chatPair(),
    { id: "u-2", role: "user", content: "and what does a leaf need at night", createdAt: "2026-01-01T00:05:00.000Z" },
    { id: "a-2", role: "assistant", content: ANSWER + " At night a leaf stops making sugar and breathes.", createdAt: "2026-01-01T00:05:09.000Z" },
  ]);

  const share = store.createMessageShare(conv.id, "a-1", KEEP);
  assert.ok(share.ok, `share: ${share.code}`);
  assert.equal(share.share.messageId, "a-1", "the link points at one answer, so the chat id alone never renders it");
  assert.deepEqual(
    share.share.messages.map((m) => m.id),
    ["u-1", "a-1"],
    "a snapshot of the pair — the later turn is NOT in it"
  );
  assert.equal(share.share.title, "Explain photosynthesis simply", "the page is titled by the question it answers");

  const again = store.createMessageShare(conv.id, "a-1", KEEP);
  assert.equal(again.share.id, share.share.id, "copying the link twice refreshes one page, not two");
  assert.equal(store.findShareByMessage(conv.id, "a-1").id, share.share.id, "and the table agrees");

  const other = store.createMessageShare(conv.id, "a-2", KEEP);
  assert.equal(other.share.messageId, "a-2", "a different answer of the same chat is its own page");
  assert.deepEqual(other.share.messages.map((m) => m.id), ["u-2", "a-2"]);
  assert.equal(store.createMessageShare(conv.id, "a-1", BOB).code, "ANSWER_NOT_FOUND", "and nobody else can publish it");

  // Deletion is the promise a public link makes: the chat goes, so does the answer's page. Message
  // shares ride `deleteSharesForConversation` (they carry the conversation id), which is why no
  // second deletion path had to be written for them.
  store.deleteConversation(conv.id, KEEP);
  assert.equal(store.getShare(share.share.id), null, "gone with the chat, both pages of it");
  assert.equal(store.findShareByMessage(conv.id, "a-2"), null);
});

await step("a kept answer shares as prose, not as code", () => {
  const conv = seedChat(chatPair("Carbon cycle\nPlants take CO2 and light, and give back oxygen.\n\n```js\nfix()```"));
  const saved = store.saveAnswerAsArtifact(conv.id, "a-1", KEEP);
  assert.ok(saved.ok, `save: ${saved.code}`);
  const body = store.artifactShareBody(saved.artifact);
  assert.ok(body.startsWith("**"), "it reads as an answer with a title line, like every other kind");
  assert.ok(body.includes("Plants take CO2 and light"), "the prose is itself");
  assert.ok(!body.includes("**\n```\nCarbon"), "and wrapping the whole answer in one fence is how a page turns into a grey block");
  assert.ok(body.includes("```js"), "the code the answer quoted stays quoted inside it");

  const shared = store.createArtifactShare(saved.artifact.id, KEEP);
  assert.equal(shared.share.mode, "chat", "text shares render through the chat reader, because that is the one that prints prose");
});

const gen = (userId, type, patch = {}) =>
  store.addGeneration({
    userId,
    type,
    prompt: patch.prompt ?? `prompt for ${type}`,
    ...(patch.outputUrl ? { outputUrl: patch.outputUrl } : {}),
    ...(patch.outputText ? { outputText: patch.outputText } : {}),
    ...(patch.meta ? { meta: patch.meta } : {}),
  });

await step("an artifact list is curated, and a vision answer is not somebody's creation", () => {
  const older = gen(ALICE, "code", { outputText: "console.log(1)" });
  const newer = gen(ALICE, "image", { outputUrl: "https://cdn.test/x.jpg", meta: { model: "flux", aspect: "1:1" } });
  const analysed = gen(ALICE, "image", { outputText: "a photo of a mug", meta: { kind: "vision" } });

  const list = store.listArtifacts(ALICE);
  assert.deepEqual(
    list.map((g) => g.id),
    [newer.id, older.id],
    "newest first, and the analysis row is not in it"
  );
  assert.ok(
    store.listGenerations(ALICE).some((g) => g.id === analysed.id),
    "the studios still see the vision row — the two views differ on purpose, not by accident"
  );

  const pinned = store.updateArtifact(older.id, ALICE, { pinned: true });
  assert.ok(pinned.ok);
  assert.deepEqual(
    store.listArtifacts(ALICE).map((g) => g.id),
    [older.id, newer.id],
    "and a pin beats recency, which is the whole point of pinning"
  );
  assert.equal(store.listArtifacts(ALICE, "code").length, 1, "the type filter still filters");
  assert.equal(store.listArtifacts(BOB).length, 0, "another account sees nothing of this");
});

await step("a title is refused when it is too long, never cut down to fit", () => {
  const a = gen(ALICE, "code", { outputText: "x" });
  const tooLong = "t".repeat(store.ARTIFACT_TITLE_MAX + 1);
  const bad = store.updateArtifact(a.id, ALICE, { title: tooLong });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "TITLE_TOO_LONG");
  assert.equal(store.getArtifact(a.id, ALICE).title, undefined, "and the row is untouched");

  const fit = store.updateArtifact(a.id, ALICE, { title: "  my   page  " });
  assert.ok(fit.ok);
  assert.equal(fit.artifact.title, "my   page", "trimmed at the edges, kept in the middle");

  const newline = store.updateArtifact(a.id, ALICE, { title: "one\ntwo" });
  assert.equal(newline.artifact.title, "one two", "a title is one line, because it sits in a row");

  const cleared = store.updateArtifact(a.id, ALICE, { title: "" });
  assert.ok(cleared.ok);
  assert.equal(cleared.artifact.title, undefined, "empty means back to the prompt, not an empty name");
});

await step("an empty patch does not rewrite the whole document", () => {
  const a = gen(ALICE, "code", { outputText: "y" });
  // Counting bytes in the file would be wrong here: the store can repair the shape it
  // reads, so a read may itself persist. What has to be true is that a real change costs
  // exactly one whole-document write and an empty patch costs one fewer than that.
  const fsMod = require("fs");
  const real = fsMod.writeFileSync;
  let writes = 0;
  fsMod.writeFileSync = function patched(...args) {
    if (String(args[0]).includes("buildwe")) writes++;
    return real.apply(this, args);
  };
  try {
    const empty = store.updateArtifact(a.id, ALICE, {});
    assert.deepEqual(empty, { ok: false, code: "NOTHING_TO_CHANGE" });
    const afterEmpty = writes;
    assert.equal(afterEmpty, 0, "the refused patch persisted nothing");
    const kept = store.updateArtifact(a.id, ALICE, { pinned: true });
    assert.ok(kept.ok);
    assert.equal(writes, afterEmpty + 1, "and the accepted one wrote the store once");
  } finally {
    fsMod.writeFileSync = real;
  }
});

await step("a share exists only when a reader could open something", () => {
  const voice = gen(ALICE, "audio", { outputText: "the script, but no file was hosted" });
  const refused = store.createArtifactShare(voice.id, ALICE);
  assert.deepEqual(refused, { ok: false, code: "NOTHING_TO_SHARE" }, "the media-less row says so");

  const code = gen(ALICE, "code", { outputText: "const a = 1;\n```js\nnot a real fence closer\n```" });
  const made = store.createArtifactShare(code.id, ALICE);
  assert.ok(made.ok, `a code row is shareable: ${JSON.stringify(made)}`);
  const body = made.share.messages[1].content;
  const fenceLen = (body.match(/^`{3,}/m) || ["```"])[0].length;
  assert.ok(fenceLen >= 4, "the fence is longer than the run inside the code, so the file cannot close itself");
  assert.ok(body.includes("not a real fence closer"), "and the whole answer is in there");
  assert.equal(made.share.conversationId, null, "an artifact share owns no conversation");

  // Re-sharing updates the same link, so the link a person already sent shows the truth.
  store.updateArtifact(code.id, ALICE, { title: "renamed after sharing" });
  const again = store.createArtifactShare(code.id, ALICE);
  assert.equal(again.share.id, made.share.id, "same link");
  assert.equal(again.share.title, "renamed after sharing", "refreshed content");
  assert.ok(again.share.messages[1].content.includes("```"), "still fenced");
});

await step("deleting an artifact takes its public link with it", () => {
  const a = gen(ALICE, "image", { outputUrl: "https://cdn.test/pic.jpg" });
  const share = store.createArtifactShare(a.id, ALICE);
  assert.ok(share.ok);
  assert.equal(store.findShareByArtifact(a.id).id, share.share.id);

  assert.deepEqual(store.deleteArtifact(a.id, BOB), { ok: false }, "not yours, not deletable");
  assert.ok(store.deleteArtifact(a.id, ALICE).ok);
  assert.equal(store.getArtifact(a.id, ALICE), null, "the row is gone");
  assert.equal(store.getShare(share.share.id), null, "and so is the page that used to show it");
});

await step("every share creator honours one per-owner cap", () => {
  const srcStore = src("lib/db/store.ts");
  const uses = (srcStore.match(/capSharesPerOwner\(db, userId\)/g) || []).length;
  assert.equal(uses, 3, "conversation, artifact and answer shares all call the same helper — a cap honoured by two of three entry points is not a cap");
  assert.equal((srcStore.match(/function capSharesPerOwner/g) || []).length, 1, "one definition to keep honest");
});

/* ── Part B: the real app, with a fixture provider ─────────────────────── */

const LONG = `// a long answer, to prove the list trims and the reader does not\n${"// pad\n".repeat(400)}export const ok = true;\n`;
let codeReply = LONG;
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
    calls.push({ body: raw, at: Date.now() });
    const text = codeReply;
    if (parsed?.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const piece of text.match(/[\s\S]{1,400}/g) || [text]) {
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

let srv = null;
srv = await startServer({
  port: PORT,
  label: "bw-artifacts",
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

async function signUp(tag) {
  const jar = newJar();
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar,
    body: {
      email: `art-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "artifacts-password",
      name: "Artifact tester",
    },
  });
  assert.ok(r.status === 200 || r.status === 201, `register -> ${r.status} ${r.text.slice(0, 140)}`);
  return jar;
}

/** Runs the app's code mode and returns the answer text, so the row is written by the product. */
async function makeCodeArtifact(jar, prompt) {
  const r = await req(BASE, "/api/ai/code", { method: "POST", jar, body: { messages: [{ role: "user", content: prompt }] } });
  assert.equal(r.status, 200, `code -> ${r.status} ${r.text.slice(0, 160)}`);
  return r.text;
}

async function artifacts(jar, qs = "") {
  const r = await req(BASE, `/api/ai/generations?view=artifacts&limit=40${qs}`, { jar });
  assert.equal(r.status, 200, `list -> ${r.status} ${r.text.slice(0, 140)}`);
  return r.json.artifacts;
}

const alice = await signUp("alice");
const bob = await signUp("bob");

let artifactId = "";
let shareId = "";
let shareUrl = "";

await step("a code answer becomes an artifact the list can show, and only a preview", async () => {
  await makeCodeArtifact(alice, "write me a module that exports ok");
  const list = await artifacts(alice);
  const row = list.find((a) => a.type === "code");
  assert.ok(row, `the code row is listed: ${JSON.stringify(list).slice(0, 200)}`);
  artifactId = row.id;
  assert.equal(row.pinned, false, "an old row has no pin flag to show");
  assert.equal(row.title, null, "and no title yet, so the prompt is what the row reads");
  assert.equal(row.shareId, null, "not public until somebody asks for a link");
  assert.equal(row.shareable, true, "it has a body, so the menu offers a link");
  assert.equal(
    row.outputText.length,
    2000,
    "a list of forty rows must not carry forty whole files"
  );
  assert.ok(LONG.length > 2600, "the fixture answer really is longer than the trim");

  const full = await req(BASE, `/api/ai/generations?id=${encodeURIComponent(artifactId)}`, { jar: alice });
  assert.equal(full.status, 200);
  assert.equal(full.json.artifact.outputText, LONG, "and the single read hands over the whole file");
});

await step("rename and pin over HTTP change what the list shows", async () => {
  const bad = await req(BASE, "/api/ai/generations", {
    method: "PATCH",
    jar: alice,
    body: { id: artifactId, title: "x".repeat(200) },
  });
  assert.equal(bad.status, 400, "too long is a refusal, not a truncation");
  assert.equal(bad.json.code, "TITLE_TOO_LONG");

  const pin = await req(BASE, "/api/ai/generations", {
    method: "PATCH",
    jar: alice,
    body: { id: artifactId, pinned: true },
  });
  assert.equal(pin.status, 200, pin.text.slice(0, 160));
  assert.equal(pin.json.artifact.pinned, true);

  const named = await req(BASE, "/api/ai/generations", {
    method: "PATCH",
    jar: alice,
    body: { id: artifactId, title: "the ok module" },
  });
  assert.equal(named.json.artifact.title, "the ok module");

  const list = await artifacts(alice);
  assert.equal(list[0].id, artifactId, "pinned, so first");
  assert.equal(list[0].title, "the ok module", "and the list reads the server, not its own memory");

  const nope = await req(BASE, "/api/ai/generations", { method: "PATCH", jar: bob, body: { id: artifactId, pinned: false } });
  assert.equal(nope.status, 404, "another account cannot rename it");
  assert.equal(nope.json.code, "ARTIFACT_NOT_FOUND");
  const still = await artifacts(alice);
  assert.equal(still[0].pinned, true, "and nothing changed");

  const junk = await req(BASE, "/api/ai/generations", { method: "PATCH", jar: alice, body: { id: artifactId, pinned: "yes" } });
  assert.equal(junk.status, 400, "a pin that is not a boolean is a bad request");
});

await step("sharing makes one page, rendered on the server, that no crawler is asked to index", async () => {
  const conflict = await req(BASE, "/api/share", {
    method: "POST",
    jar: alice,
    body: { artifactId, conversationId: "conv_whatever" },
  });
  assert.equal(conflict.status, 400, "one link, one source");
  assert.equal(conflict.json.code, "BAD_SHARE_SOURCE");

  const made = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { artifactId } });
  assert.equal(made.status, 200, made.text.slice(0, 200));
  shareId = made.json.id;
  shareUrl = made.json.url;
  assert.ok(shareUrl === `/s/${shareId}`, "the URL the API gives is the page that serves it");

  const page = await req(BASE, shareUrl);
  assert.equal(page.status, 200);
  // The point of the rewrite: the bytes in the response, not a spinner that later fetches.
  assert.ok(page.text.includes("export const ok = true;"), "the code is in the HTML, not behind a fetch");
  assert.ok(page.text.includes("the ok module"), "the row's title is the page title text");
  assert.ok(/name="robots"[^>]*noindex/.test(page.text), "and it says, in the head, not to index it");

  const again = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { artifactId } });
  assert.equal(again.json.id, shareId, "sharing twice is the same link, refreshed");

  const listed = await artifacts(alice);
  assert.equal(listed[0].shareId, shareId, "and the row knows it is public, so the menu says Copy");

  const bobbed = await req(BASE, "/api/share", { method: "POST", jar: bob, body: { artifactId } });
  assert.equal(bobbed.status, 404, "nobody else can publish your row");
});

await step("a missing share is a 404, which is what it has always meant", async () => {
  const gone = await req(BASE, "/s/noneatall1234");
  assert.equal(gone.status, 404, "a stale link used to answer 200 with a client-side error box");
  const api = await req(BASE, "/api/share?id=noneatall1234");
  assert.equal(api.status, 404);
});

await step("a visit is counted once, by the client, and never by a stranger's id", async () => {
  const first = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { action: "view", id: shareId } });
  assert.equal(first.status, 200, first.text.slice(0, 120));
  const second = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { action: "view", id: shareId } });
  assert.equal(second.json.views, first.json.views + 1, "two visits, two counts");

  const bad = await req(BASE, "/api/share", { method: "POST", body: { action: "view", id: "../etc/passwd" } });
  assert.equal(bad.status, 400, "an id has to look like one before the store is touched");
  assert.equal(bad.json.code, "BAD_SHARE_ID");

  const ghost = await req(BASE, "/api/share", { method: "POST", body: { action: "view", id: "zzzzzzzzzzzz" } });
  assert.equal(ghost.status, 404);
  assert.equal(ghost.json.code, "SHARE_NOT_FOUND");

  let limited = 0;
  for (let i = 0; i < 40; i++) {
    const r = await req(BASE, "/api/share", { method: "POST", body: { action: "view", id: shareId } });
    if (r.status === 429) limited++;
  }
  assert.ok(limited > 0, "a public link is a write per view, so the bucket has to be real");
});

await step("delete takes the row and the link in one step", async () => {
  const before = await req(BASE, shareUrl);
  assert.equal(before.status, 200, "the page exists before");
  const out = await req(BASE, `/api/ai/generations?id=${encodeURIComponent(artifactId)}`, {
    method: "DELETE",
    jar: bob,
  });
  assert.equal(out.status, 404, "another account may not delete it");
  assert.equal((await req(BASE, shareUrl)).status, 200, "and nothing happened");

  const mine = await req(BASE, `/api/ai/generations?id=${encodeURIComponent(artifactId)}`, {
    method: "DELETE",
    jar: alice,
  });
  assert.equal(mine.status, 200, mine.text.slice(0, 160));
  assert.equal((await req(BASE, shareUrl)).status, 404, "a page nobody can un-publish is not a feature");
  const list = await artifacts(alice);
  assert.equal(list.find((a) => a.id === artifactId), undefined, "and the row is gone from the list");
  const again = await req(BASE, `/api/ai/generations?id=${encodeURIComponent(artifactId)}`, { method: "DELETE", jar: alice });
  assert.equal(again.status, 404, "deleting twice reports the second one honestly");
});

await step("the failure paths answer with a code, not an empty list", async () => {
  const raw = await req(BASE, "/api/ai/generations?limit=5", { jar: alice });
  assert.equal(raw.status, 200);
  assert.ok(Array.isArray(raw.json.generations), "the studios' view still answers the same shape");
  assert.ok(!("artifacts" in raw.json), "and only the artifacts view renames the key");

  const noBody = await req(BASE, "/api/ai/generations", { method: "PATCH", jar: alice, body: {} });
  assert.equal(noBody.status, 400);
  assert.equal(noBody.json.code, "BAD_REQUEST");

  const badLimit = await req(BASE, "/api/ai/generations?view=artifacts&limit=99999", { jar: alice });
  assert.equal(badLimit.status, 200);
  assert.ok(badLimit.json.count <= 100, "a huge limit is clamped, not honoured");
});

await step("an answer of a chat is keepable and publishable over HTTP, and a reader sees the pair", async () => {
  const ANSWER_TEXT =
    "Chlorophyll catches the light; the leaf splits water, reduces CO2 to sugar, and releases the oxygen we breathe.";
  const made = await req(BASE, "/api/history", {
    method: "POST",
    jar: alice,
    body: {
      action: "create",
      mode: "chat",
      title: "Leaves",
      messages: [
        { id: "qa1", role: "user", content: "Explain photosynthesis in one line" },
        { id: "aa1", role: "assistant", content: ANSWER_TEXT },
        // A later turn, which must stay private to the chat: an answer's link is that answer.
        { id: "qa2", role: "user", content: "SECOND-QUESTION-nobody-should-see" },
        { id: "aa2", role: "assistant", content: "SECOND-ANSWER-nobody-should-see" },
      ],
    },
  });
  assert.equal(made.status, 200, made.text.slice(0, 200));
  const conversationId = made.json.conversation.id;
  const saveBody = { action: "save-answer", conversationId, messageId: "aa1" };

  const saved = await req(BASE, "/api/ai/generations", { method: "POST", jar: alice, body: saveBody });
  assert.equal(saved.status, 200, saved.text.slice(0, 220));
  assert.equal(saved.json.created, true, "the first save creates a row");
  assert.equal(saved.json.artifact.type, "text", "as its own kind of creation");
  assert.ok(saved.json.artifact.shareable, "and shareable, which is why the share route grew a text branch");
  assert.equal(saved.json.artifact.title, null, "unnamed until the panel names it");

  const list = await req(BASE, "/api/ai/generations?view=artifacts&limit=40&type=text", { jar: alice });
  assert.equal(list.status, 200);
  assert.ok(list.json.artifacts.some((a) => a.id === saved.json.artifact.id), "the filter a person clicks is the filter the route serves");
  const bad = await req(BASE, "/api/ai/generations?view=artifacts&type=not-a-type", { jar: alice });
  assert.equal(bad.status, 400, "an unknown type is refused, not quietly ignored — asking for images and getting every row is a wrong answer that looks right");
  assert.equal(bad.json.code, "BAD_TYPE");
  const allAsFilter = await req(BASE, "/api/ai/generations?view=artifacts&type=all", { jar: alice });
  assert.equal(allAsFilter.status, 200, "`all` on a hand-written link means no filter");

  // The button a person double-clicks, so the server owns idempotency, not the client.
  const twice = await req(BASE, "/api/ai/generations", { method: "POST", jar: alice, body: saveBody });
  assert.equal(twice.json.created, false, "the second save refreshes");
  assert.equal(twice.json.artifact.id, saved.json.artifact.id, "on the same row");
  const rows = (await artifacts(alice, "&type=text")).filter((a) => a.meta?.from?.messageId === "aa1");
  assert.equal(rows.length, 1, "and one row in the list, not two");
  assert.equal(rows[0].prompt, "Explain photosynthesis in one line", "the question is the prompt the row shows");

  const short = await req(BASE, "/api/history", {
    method: "POST",
    jar: alice,
    body: { action: "create", mode: "chat", title: "Tiny", messages: [{ id: "qs", role: "user", content: "hi" }, { id: "as", role: "assistant", content: "yes" }] },
  });
  const refused = await req(BASE, "/api/ai/generations", {
    method: "POST",
    jar: alice,
    body: { action: "save-answer", conversationId: short.json.conversation.id, messageId: "as" },
  });
  assert.equal(refused.status, 409, "an answer of one word is refused, with a code the client can name");
  assert.equal(refused.json.code, "ANSWER_TOO_SHORT");

  const share = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { conversationId, messageId: "aa1" } });
  assert.equal(share.status, 200, share.text.slice(0, 220));
  assert.equal(share.json.scope, "answer", "so the client knows whether it published a page or a chat");
  assert.match(share.json.url, /^\/s\/[A-Za-z0-9_-]+$/, "the same URL shape every share has always had");

  const view = await req(BASE, share.json.url);
  assert.equal(view.status, 200);
  assert.ok(view.text.includes("Chlorophyll catches the light"), "the answer is in the bytes a reader gets");
  assert.ok(view.text.includes("Explain photosynthesis in one line"), "with the question it answered");
  assert.ok(!view.text.includes("SECOND-QUESTION"), "and nothing else from that chat — not one later message");
  assert.ok(!view.text.includes("SECOND-ANSWER"), "not one later answer either");

  const reshare = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { conversationId, messageId: "aa1" } });
  assert.equal(reshare.json.id, share.json.id, "copying the link twice refreshes one page");

  const mixed = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { artifactId: saved.json.artifact.id, messageId: "aa1" } });
  assert.equal(mixed.status, 400, "one link, one source — a creation and an answer is two pages");
  assert.equal(mixed.json.code, "BAD_SHARE_SOURCE");
  const homeless = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { messageId: "aa1" } });
  assert.equal(homeless.status, 400, "an answer id without its chat is not a lookup anybody should guess at");

  const stranger = await req(BASE, "/api/share", { method: "POST", jar: bob, body: { conversationId, messageId: "aa1" } });
  assert.equal(stranger.status, 404, "a stranger with the ids gets the same answer as a wrong id");
  const strangerSave = await req(BASE, "/api/ai/generations", { method: "POST", jar: bob, body: saveBody });
  assert.equal(strangerSave.status, 404, "and cannot keep it either");
  const anonSave = await req(BASE, "/api/ai/generations", { method: "POST", body: saveBody });
  assert.equal(anonSave.status, 404, "no cookie, no reach");

  await req(BASE, "/api/ai/generations", { method: "POST", jar: alice, body: { action: "save-answer", conversationId, messageId: "aa2" } });
  const otherAnswer = await req(BASE, "/api/share", { method: "POST", jar: alice, body: { conversationId, messageId: "aa2" } });
  assert.notEqual(otherAnswer.json.id, share.json.id, "a different answer of the same chat is a different page");

  await req(BASE, `/api/history?id=${conversationId}`, { method: "DELETE", jar: alice });
  assert.equal((await req(BASE, share.json.url)).status, 404, "deleting the chat takes the answer's page with it");
  assert.equal((await req(BASE, otherAnswer.json.url)).status, 404, "both of them — no second cleanup path was needed");
  const kept = await artifacts(alice, "&type=text");
  assert.ok(
    kept.some((a) => a.id === saved.json.artifact.id),
    "a kept answer survives its chat going away — that is what keeping it meant"
  );
});

await step("the panel is the real client surface, and it cannot reach the store", () => {
  const card = src("components/workspace/CreationsPanel.tsx");
  assert.ok(card.includes('"use client"'), "a client component, so its audio element is legal");
  assert.ok(!card.includes("@/lib/db"), "it talks to the API and never imports the store");
  assert.ok(card.includes("data-creations-error"), "a failed read says it failed, with a retry");
  assert.ok(card.includes("data-creations-empty"), "and an empty list is its own honest state");
  assert.ok(
    card.includes("disabled={!artifact.shareable && !artifact.shareId}"),
    "a row with nothing to open offers no share button"
  );
  assert.ok(card.includes("maxLength={titleMax}"), "the length limit is the server's, read from its answer");
  assert.ok(!card.includes("onBusyChange"), "no prop the page does not use");

  const page = src("app/page.tsx");
  assert.ok(page.includes('{modal === "creations" && ('), "opened from the shell, in the shared Sheet");
  // The props it is mounted with, not the line breaks between them: this check exists to catch a
  // panel that is rendered but not wired, and pinning formatting would only catch re-indentation.
  const mount = (page.match(/<CreationsPanel[\s\S]{0,600}?\/>/) || [""])[0];
  for (const prop of ["onOpenCode={openArtifactCode}", "onShowStudio={openArtifactStudio}", "onOpenChat={"]) {
    assert.ok(mount.includes(prop), `the panel is mounted with ${prop}`);
  }
  assert.ok(
    page.includes("if (codePanel.trim()) pushCanvasVersion(codePanel, codeLang);"),
    "opening a code artifact over the canvas keeps a version first"
  );
  // Three, counted exactly rather than "at least", so a fourth way in has to be named here too:
  // the sidebar row, the drawer row, and the answer row's "Open in creations".
  assert.ok((page.match(/setModal\("creations"\)/g) || []).length === 3, "sidebar row, drawer row, and a saved answer's menu row");

  const api = src("lib/client/api.ts");
  for (const fn of ["fetchArtifacts", "fetchArtifact", "updateArtifact", "deleteArtifact", "shareArtifact"]) {
    assert.ok(api.includes(`export async function ${fn}(`), `the client gets ${fn}`);
  }
  assert.ok(!src("app/page.tsx").includes("audioHistory.filter"), "the studios keep their own restore");
});

await step("a shared creation page carries no workspace machinery", async () => {
  const view = src("app/s/[id]/ShareView.tsx");
  assert.ok(view.includes("<LinkPreviews"), "a shared page still explains the links in the answer");
  assert.equal(view.includes("FileApplyBlocks"), false, "a reader has no button that writes into a project");
  const page = src("app/s/[id]/page.tsx");
  assert.ok(page.includes("export const dynamic = \"force-dynamic\""), "a deleted link stays deleted, not cached");
  assert.ok(page.includes("notFound()"), "and a wrong id is a 404 from the server");
  assert.equal(page.includes('"use client"'), false, "the page renders on the server now");
});

/* Teardown, out loud. A dev server this suite started keeps its stdio pipes open, and an
   open handle is a process that never exits — a suite whose last check is green but which
   hangs is worse than one that fails, because `npm test` stops in the middle and says
   nothing about the suites after it. That is exactly how this file first presented: 15/15
   printed, and the chain never moved on. */
process.on("uncaughtException", (e) => {
  console.error(e);
  teardown();
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error(e);
  teardown();
  process.exit(1);
});
function teardown() {
  try {
    fixture.closeAllConnections?.();
    fixture.close();
  } catch {
    /* */
  }
  try {
    srv?.stop();
  } catch {
    /* */
  }
}

const failed = report("Step 10 — artifacts");
teardown();
process.exit(failed ? 1 : 0);
