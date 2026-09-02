/**
 * BUILDWE Coding Agent — A-to-Z autonomous work, not a chatbot that types code.
 *
 * WHAT CHANGED
 * ------------
 * Code mode used to be one prompt in, one code block out. If the result was
 * broken you noticed, you complained, and it tried again from scratch. There
 * was no plan, no memory of the project, no verification, no iteration.
 *
 * The agent runs a real loop instead:
 *
 *   PLAN  → read the request + existing project files, decide the steps
 *   ACT   → call tools (read_file, write_file/create_file, list_files, run_check, finish)
 *   CHECK → validate what it wrote (syntax, structure, obvious runtime traps)
 *   FIX   → feed failures back in and iterate, up to a hard step budget
 *   DONE  → report what it built, which files changed, what it verified
 *
 * SAFETY MODEL
 * ------------
 * The agent never executes user code on the server. `run_check` is static
 * analysis only — balanced delimiters, script/tag structure, obvious footguns.
 * Actual execution stays where it already was: the client's sandboxed iframe
 * for HTML, and a Web Worker for JS. That boundary is deliberate and is not
 * relaxed here.
 *
 * Every tool call is scoped to the session owner through the store layer, so
 * an agent working for user A can never read or write user B's files.
 *
 * BUDGETS
 * -------
 * An agent loop is the easiest way to burn money by accident, so it is capped
 * on every axis: steps, tool calls, file size, total output, and wall clock.
 */

import {
  listProjectFiles,
  getProjectFile,
  saveProjectFile,
  deleteProjectFile,
  normalizeFilePath,
  type ProjectFile,
} from "@/lib/db/store";
import { completeVia, type ProviderKeys } from "@/lib/ai/provider-registry";
import { chainFor } from "@/lib/ai/adapter";
import {
  isCoolingDown,
  noteModelFailure,
  noteModelSuccess,
} from "@/lib/ai/model-chain";
import {
  parseToolCall,
  type AgentToolCall,
  type AgentToolName,
} from "@/lib/ai/agent-parse";

export { parseToolCall, type AgentToolCall, type AgentToolName } from "@/lib/ai/agent-parse";

/* ── Budgets ──────────────────────────────────────────────── */

export const AGENT_LIMITS = {
  /** hard ceiling on plan→act→check cycles */
  maxSteps: 8,
  /** tool invocations across the whole run */
  maxToolCalls: 24,
  /** per file written by the agent */
  maxFileChars: 60_000,
  /** total characters the agent may write in one run */
  maxTotalWriteChars: 200_000,
  /** wall clock for the entire run */
  maxWallMs: 120_000,
  /** files included in the context snapshot */
  maxContextFiles: 20,
  /** characters of file content given to the model per step */
  contextCharBudget: 14_000,
} as const;

/* ── Tool surface ─────────────────────────────────────────── */

export type AgentEvent =
  | { type: "plan"; text: string }
  | { type: "step"; n: number; total: number; label: string }
  | { type: "tool"; tool: AgentToolName; path?: string; ok: boolean; detail: string }
  | { type: "check"; ok: boolean; issues: string[]; path?: string }
  | { type: "message"; text: string }
  | { type: "done"; summary: string; filesChanged: string[]; verified: boolean }
  | { type: "error"; text: string };

export type AgentRunInput = {
  userId: string;
  projectId: string;
  goal: string;
  plan: "free" | "pro";
  userKeys?: ProviderKeys;
  /** code currently open in the canvas, if any */
  canvasCode?: string;
  canvasLang?: string;
  onEvent: (e: AgentEvent) => void;
};

export type AgentRunResult = {
  ok: boolean;
  summary: string;
  filesChanged: string[];
  steps: number;
  verified: boolean;
  /** final primary artifact, so the canvas can show something immediately */
  primaryFile?: { path: string; content: string; lang: string };
};

/* ── Static verification (never executes anything) ────────── */

/**
 * Cheap structural checks that catch the failures LLMs actually make:
 * unbalanced braces, unterminated strings, missing closing tags, references
 * to functions that were never defined. This is not a compiler — it is a
 * smoke test that turns "looks plausible" into "probably runs".
 */
export function runCheck(path: string, content: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const ext = (path.split(".").pop() || "").toLowerCase();

  if (!content.trim()) {
    return { ok: false, issues: ["File is empty."] };
  }

  const balanced = (open: string, close: string, label: string) => {
    // crude but effective: ignore delimiters inside quotes and comments
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    let depth = 0;
    for (const ch of stripped) {
      if (ch === open) depth++;
      else if (ch === close) depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      issues.push(
        `Unbalanced ${label}: ${depth > 0 ? `${depth} unclosed` : `${-depth} extra closing`}.`
      );
    }
  };

  if (["js", "jsx", "ts", "tsx", "json", "css", "html"].includes(ext)) {
    balanced("{", "}", "braces");
    balanced("(", ")", "parentheses");
    balanced("[", "]", "brackets");
  }

  if (ext === "json") {
    try {
      JSON.parse(content);
    } catch (e) {
      issues.push(`Invalid JSON: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  if (ext === "html" || /<html/i.test(content)) {
    for (const tag of ["html", "head", "body"]) {
      const open = (content.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
      const close = (content.match(new RegExp(`</${tag}>`, "gi")) || []).length;
      if (open !== close) issues.push(`<${tag}> tags are not balanced.`);
    }
    const scriptOpen = (content.match(/<script[\s>]/gi) || []).length;
    const scriptClose = (content.match(/<\/script>/gi) || []).length;
    if (scriptOpen !== scriptClose) issues.push("<script> tags are not balanced.");

    // onclick="foo()" referring to a function that was never defined
    const handlers = Array.from(content.matchAll(/on\w+\s*=\s*["']([a-zA-Z_$][\w$]*)\s*\(/g)).map(
      (m) => m[1]
    );
    for (const fn of Array.from(new Set(handlers))) {
      const defined =
        new RegExp(`function\\s+${fn}\\b`).test(content) ||
        new RegExp(`(const|let|var)\\s+${fn}\\s*=`).test(content) ||
        new RegExp(`${fn}\\s*=\\s*(function|\\()`).test(content);
      if (!defined) issues.push(`Handler "${fn}()" is referenced but never defined.`);
    }
  }

  if (["js", "jsx", "ts", "tsx"].includes(ext)) {
    if (/\bawait\b/.test(content)) {
      const hasAsync = /\basync\b/.test(content);
      const topLevelModule = ext === "ts" || ext === "tsx" || /\bexport\b|\bimport\b/.test(content);
      if (!hasAsync && !topLevelModule) {
        issues.push("`await` used without an enclosing async function.");
      }
    }
    if (/\bconsole\.log\(/.test(content) && content.split("\n").length > 40) {
      // informational, not a failure
    }
  }

  // Common LLM artifact: leaving the fence markers in the file
  if (/^```/m.test(content)) {
    issues.push("File contains markdown code fences — they must be stripped.");
  }
  // Placeholder detection must not fire on legitimate content: a todo app
  // contains the word "Todo" everywhere. Only match the ALL-CAPS comment
  // conventions and explicit filler phrases.
  const placeholder =
    /(^|[\s/*#])(TODO|FIXME|XXX)\b/.test(content) ||
    /\.\.\.\s*(rest|remaining|other)\b/i.test(content) ||
    /\b(your code here|implement this|add your logic|rest of the code|code goes here)\b/i.test(
      content
    );
  if (placeholder) {
    issues.push("File contains placeholder text instead of finished code.");
  }

  return { ok: issues.length === 0, issues };
}

/* ── Tool execution ───────────────────────────────────────── */

type ToolContext = {
  userId: string;
  projectId: string;
  writtenChars: number;
  filesChanged: Set<string>;
};

function stripFences(content: string): string {
  // Models wrap output in ```lang … ``` even when told not to.
  const fenced = content.match(/^\s*```[a-zA-Z0-9]*\n([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1] : content;
}

/** normalizeFilePath returns null for unsafe paths — surface that as a refusal. */
function safePath(raw: string): string | null {
  return normalizeFilePath(raw);
}

function langFromPath(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    html: "html", htm: "html", css: "css", js: "javascript", mjs: "javascript",
    jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json",
    md: "markdown", py: "python", sh: "bash", yml: "yaml", yaml: "yaml",
  };
  return map[ext] || "text";
}

async function execTool(
  call: AgentToolCall,
  ctx: ToolContext
): Promise<{ ok: boolean; detail: string; result?: string }> {
  switch (call.tool) {
    case "list_files": {
      const files = listProjectFiles(ctx.projectId, ctx.userId);
      if (!files.length) return { ok: true, detail: "no files yet", result: "(empty project)" };
      const listing = files
        .slice(0, AGENT_LIMITS.maxContextFiles)
        .map((f) => `${f.path} (${f.content.length} chars, ${f.lang})`)
        .join("\n");
      return { ok: true, detail: `${files.length} file(s)`, result: listing };
    }

    case "read_file": {
      if (!call.path) return { ok: false, detail: "no path given" };
      const files = listProjectFiles(ctx.projectId, ctx.userId);
      const want = safePath(call.path);
      if (!want) return { ok: false, detail: `refused unsafe path "${call.path}"` };
      const hit = files.find((f) => f.path === want);
      if (!hit) return { ok: false, detail: `${call.path} not found` };
      const full = getProjectFile(hit.id, ctx.userId);
      if (!full) return { ok: false, detail: `${call.path} not readable` };
      return {
        ok: true,
        detail: `${full.content.length} chars`,
        result: full.content.slice(0, AGENT_LIMITS.contextCharBudget),
      };
    }

    case "write_file": {
      if (!call.path) return { ok: false, detail: "no path given" };
      let content = stripFences(String(call.content ?? ""));
      if (!content.trim()) return { ok: false, detail: "refused to write an empty file" };

      if (content.length > AGENT_LIMITS.maxFileChars) {
        content = content.slice(0, AGENT_LIMITS.maxFileChars);
      }
      if (ctx.writtenChars + content.length > AGENT_LIMITS.maxTotalWriteChars) {
        return { ok: false, detail: "write budget exhausted for this run" };
      }

      const path = safePath(call.path);
      if (!path) {
        return { ok: false, detail: `refused unsafe path "${call.path}"` };
      }

      const saved = saveProjectFile({
        userId: ctx.userId,
        projectId: ctx.projectId,
        path,
        content,
        lang: call.lang || langFromPath(path),
      });
      if ("error" in saved) {
        return { ok: false, detail: saved.error };
      }
      ctx.writtenChars += content.length;
      ctx.filesChanged.add(path);
      return { ok: true, detail: `wrote ${content.length} chars to ${path}` };
    }

    case "delete_file": {
      if (!call.path) return { ok: false, detail: "no path given" };
      const files = listProjectFiles(ctx.projectId, ctx.userId);
      const want = safePath(call.path);
      if (!want) return { ok: false, detail: `refused unsafe path "${call.path}"` };
      const hit = files.find((f) => f.path === want);
      if (!hit) return { ok: false, detail: `${call.path} not found` };
      deleteProjectFile(hit.id, ctx.userId);
      ctx.filesChanged.add(hit.path);
      return { ok: true, detail: `deleted ${hit.path}` };
    }

    case "run_check": {
      const files = listProjectFiles(ctx.projectId, ctx.userId);
      const want = call.path ? safePath(call.path) : null;
      const targets = want
        ? files.filter((f) => f.path === want)
        : files.filter((f) => ctx.filesChanged.has(f.path));
      if (!targets.length) return { ok: true, detail: "nothing to check" };

      const report: string[] = [];
      let allOk = true;
      for (const f of targets) {
        const full = getProjectFile(f.id, ctx.userId);
        if (!full) continue;
        const res = runCheck(full.path, full.content);
        if (!res.ok) {
          allOk = false;
          report.push(`${full.path}: ${res.issues.join(" | ")}`);
        } else {
          report.push(`${full.path}: OK`);
        }
      }
      return { ok: allOk, detail: allOk ? "all checks passed" : "issues found", result: report.join("\n") };
    }

    case "finish":
      return { ok: true, detail: call.summary || "finished" };

    default:
      return { ok: false, detail: `unknown tool` };
  }
}

/* ── Prompting ────────────────────────────────────────────── */

const AGENT_SYSTEM = `You are the BUILDWE Coding Agent. You do complete engineering work end to end, not conversation.

You work by emitting ONE tool call per turn as a single JSON object and nothing else. No prose outside JSON. No markdown fences around the JSON.

Available tools:
{"tool":"list_files"}
  See what already exists in the project. Do this first when the project may be non-empty.
{"tool":"read_file","path":"index.html"}
  Read a file before you modify it. Never rewrite a file you have not read.
{"tool":"write_file","path":"index.html","content":"<full file content>","lang":"html"}
  Create or replace a file. Write the COMPLETE file, never a diff, never a fragment, never "…rest unchanged".
  create_file is the same tool — use either name. Prefer write_file.
{"tool":"delete_file","path":"old.js"}
  Remove a file that is no longer needed.
{"tool":"run_check","path":"index.html"}
  Statically verify what you wrote. Run this after writing. Omit path to check everything you changed.
{"tool":"finish","summary":"what you built and verified"}
  Only when the work is complete and checks pass.

Rules:
- Write real, working, complete code. No placeholders, no TODO, no "implement this".
- Never include markdown code fences inside file content.
- Prefer few well-structured files over many tiny ones. A single-file HTML app is usually right for small tools.
- After write_file, always run_check. If it reports issues, fix them with another write_file and check again.
- Self-contained code only: no build step, no npm install, no external services unless the user asked.
- If the goal is already satisfied by existing files, say so with finish rather than rewriting them.
- Keep going until it actually works. Do not stop at "here is a start".`;

function buildContextBlock(files: ProjectFile[], canvasCode?: string, canvasLang?: string): string {
  const parts: string[] = [];
  if (files.length) {
    let budget = AGENT_LIMITS.contextCharBudget;
    const shown: string[] = [];
    for (const f of files.slice(0, AGENT_LIMITS.maxContextFiles)) {
      const head = f.content.slice(0, Math.max(0, Math.min(3000, budget)));
      if (!head) break;
      budget -= head.length;
      shown.push(`--- ${f.path} (${f.lang}) ---\n${head}${f.content.length > head.length ? "\n…(truncated)" : ""}`);
      if (budget <= 0) break;
    }
    parts.push(`EXISTING PROJECT FILES:\n${shown.join("\n\n")}`);
  } else {
    parts.push("EXISTING PROJECT FILES: (none — this is a fresh project)");
  }
  if (canvasCode && canvasCode.trim()) {
    parts.push(
      `CURRENTLY OPEN IN THE CANVAS (${canvasLang || "text"}):\n${canvasCode.slice(0, 6000)}`
    );
  }
  return parts.join("\n\n");
}

/* ── The loop ─────────────────────────────────────────────── */

/**
 * Move models that are currently benched to the back of the chain.
 *
 * Same policy the chat path uses: a benched model is never removed (an all-cold
 * chain must still be attempted rather than reporting "no model available"),
 * it just stops being tried first.
 */
function orderByHealth(chain: string[]): string[] {
  const hot = chain.filter((id) => !isCoolingDown(id));
  const cold = chain.filter((id) => isCoolingDown(id));
  return [...hot, ...cold];
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const { userId, projectId, goal, plan, userKeys, onEvent } = input;
  const startedAt = Date.now();

  const ctx: ToolContext = {
    userId,
    projectId,
    writtenChars: 0,
    filesChanged: new Set<string>(),
  };

  const chain = chainFor({
    capability: "code",
    plan,
    prompt: goal,
    userKeys,
    max: 4,
  }).map((m) => m.id);

  if (!chain.length) {
    onEvent({ type: "error", text: "No coding model is reachable right now." });
    return { ok: false, summary: "No model available.", filesChanged: [], steps: 0, verified: false };
  }

  const files = listProjectFiles(projectId, userId);
  const context = buildContextBlock(files, input.canvasCode, input.canvasLang);

  const transcript: { role: string; content: string }[] = [
    { role: "system", content: AGENT_SYSTEM },
    {
      role: "user",
      content: `GOAL:\n${goal}\n\n${context}\n\nBegin. Emit your first tool call as JSON only.`,
    },
  ];

  let steps = 0;
  let toolCalls = 0;
  let verified = false;
  let summary = "";
  let lastCheckIssues: string[] = [];
  /** true only after a run_check that reported no issues */
  let checksPassed = false;

  while (steps < AGENT_LIMITS.maxSteps) {
    if (Date.now() - startedAt > AGENT_LIMITS.maxWallMs) {
      onEvent({ type: "message", text: "Time budget reached — wrapping up." });
      break;
    }
    if (toolCalls >= AGENT_LIMITS.maxToolCalls) {
      onEvent({ type: "message", text: "Tool budget reached — wrapping up." });
      break;
    }

    steps++;
    onEvent({ type: "step", n: steps, total: AGENT_LIMITS.maxSteps, label: "Thinking" });

    // Ask the model for the next action, walking the provider chain on failure.
    //
    // Two budget rules that were missing here (chat got them in update 12):
    //
    //  1. A model that just failed is recorded, so the NEXT step does not lead
    //     with it again. Without this a dead primary cost a 45s timeout on
    //     every one of the 8 steps — six minutes of waiting for a run whose
    //     wall budget is two.
    //  2. The wall clock is checked between attempts, not only at the top of
    //     the loop. Four dead models at 45s each is 180s, so a single step
    //     could overrun the 120s budget before anything re-checked it.
    let reply: string | null = null;
    const stepChain = orderByHealth(chain);
    for (const model of stepChain) {
      if (Date.now() - startedAt > AGENT_LIMITS.maxWallMs) break;
      reply = await completeVia(
        model,
        transcript,
        { maxTokens: 4096, temperature: 0.3 },
        userKeys
      );
      if (reply) {
        noteModelSuccess(model);
        break;
      }
      noteModelFailure(model);
    }

    if (!reply) {
      onEvent({ type: "error", text: "The coding model stopped responding." });
      break;
    }

    const call = parseToolCall(reply);
    if (!call) {
      // Model drifted into prose — nudge it back rather than failing the run.
      transcript.push({ role: "assistant", content: reply.slice(0, 2000) });
      transcript.push({
        role: "user",
        content:
          "That was not a tool call. Reply with exactly one JSON object and nothing else.",
      });
      continue;
    }

    if (call.tool === "finish") {
      summary = call.summary || "Work complete.";
      // Never accept "done" while known issues are outstanding.
      if (lastCheckIssues.length) {
        transcript.push({ role: "assistant", content: JSON.stringify(call) });
        transcript.push({
          role: "user",
          content: `You cannot finish yet — these checks are still failing:\n${lastCheckIssues.join("\n")}\nFix them with write_file, then run_check again.`,
        });
        lastCheckIssues = [];
        continue;
      }
      // "verified" must mean checks passed, not merely that files were written.
      verified = ctx.filesChanged.size > 0 && checksPassed;
      break;
    }

    toolCalls++;
    onEvent({
      type: "step",
      n: steps,
      total: AGENT_LIMITS.maxSteps,
      label:
        call.tool === "write_file"
          ? `Writing ${call.path || "file"}`
          : call.tool === "read_file"
            ? `Reading ${call.path || "file"}`
            : call.tool === "run_check"
              ? "Verifying"
              : "Inspecting project",
    });

    const res = await execTool(call, ctx);
    onEvent({ type: "tool", tool: call.tool, path: call.path, ok: res.ok, detail: res.detail });

    if (call.tool === "run_check") {
      const issues = res.ok ? [] : (res.result || res.detail).split("\n").filter(Boolean);
      lastCheckIssues = issues;
      onEvent({ type: "check", ok: res.ok, issues, path: call.path });
      checksPassed = res.ok;
    }

    transcript.push({ role: "assistant", content: JSON.stringify(call) });
    transcript.push({
      role: "user",
      content: `TOOL RESULT (${call.tool}${call.path ? ` ${call.path}` : ""}): ${res.ok ? "OK" : "FAILED"} — ${res.detail}${res.result ? `\n${res.result.slice(0, 6000)}` : ""}`,
    });

    // Keep the transcript bounded: the system prompt, the goal, and a window
    // of recent turns. Otherwise cost grows quadratically with steps.
    if (transcript.length > 16) {
      transcript.splice(2, transcript.length - 14);
    }
  }

  const changed = Array.from(ctx.filesChanged);

  // Hand back the most relevant artifact so the canvas can display it.
  let primaryFile: AgentRunResult["primaryFile"];
  if (changed.length) {
    const all = listProjectFiles(projectId, userId);
    const preferred =
      all.find((f) => /index\.html?$/i.test(f.path)) ||
      all.find((f) => changed.includes(f.path) && /\.html?$/i.test(f.path)) ||
      all.find((f) => changed.includes(f.path));
    if (preferred) {
      const full = getProjectFile(preferred.id, userId);
      if (full) {
        primaryFile = { path: full.path, content: full.content, lang: full.lang };
      }
    }
  }

  if (!summary) {
    summary = changed.length
      ? `Updated ${changed.length} file(s): ${changed.join(", ")}.`
      : "No changes were made.";
  }

  onEvent({ type: "done", summary, filesChanged: changed, verified });

  return {
    ok: changed.length > 0 || verified,
    summary,
    filesChanged: changed,
    steps,
    verified,
    ...(primaryFile ? { primaryFile } : {}),
  };
}
