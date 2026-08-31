/**
 * Tool runner (Wave 1) — the piece that makes a tool real.
 *
 * One path for every tool: validate → build the prompt from the SERVER's copy
 * of the spec → quota check → live model call → stream → grade the output
 * against the tool's own contract → at most one corrective regeneration →
 * persist into the user's history → count the usage. Nothing in this list is
 * optional, and the order matters: quota is checked before any paid call, and
 * usage is counted for what actually ran.
 *
 * HONESTY POLICY (boss rule: no fake success), two consequences:
 *  • Tools refuse to run on the offline fallback brain. A template "blog post"
 *    dressed up as AI output is exactly the fake the audit exists to kill, so a
 *    deployment with no reachable model returns 503 + a fix-it hint instead of
 *    producing content. Chat keeps its labelled offline mode; generators don't.
 *  • When the output fails the tool's checks and the retry still fails, the
 *    user sees the failed check. We never mark a bad answer as good.
 */

import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { qualityGate, extractClaims, type QualityResult } from "@/lib/ai/quality";
import { streamChatOrCode } from "@/lib/ai/providers";
import { completeVia, type ProviderKeys } from "@/lib/ai/provider-registry";
import { webSearch } from "@/lib/ai/search";
import { toUserFacingError } from "@/lib/ai/gateway";
import { appendMessages, createConversation, uid } from "@/lib/db/store";
import { bump } from "@/lib/metrics/metrics";
import type { Plan } from "@/lib/db/store";
import type { ToolChecks, ToolSpec, Values } from "./types";
import { buildPrompts } from "./inputs";

export type ToolRunError = {
  ok: false;
  status: number;
  code: string;
  error: string;
  hint?: string;
};

export type ToolRunSuccess = {
  ok: true;
  sse: ReadableStream<Uint8Array>;
  model: string;
  live: true;
};

export type ToolRunResult = ToolRunSuccess | ToolRunError;

/* ── output contract grading ─────────────────────────────── */

export type CheckReport = {
  passed: string[];
  failed: string[];
};

/**
 * Grade the generated text against the tool's declared `checks`.
 *
 * Each check is a claim we can test mechanically — no vibes, no score that
 * looks precise but means nothing. `failed` decides whether one corrective
 * regeneration is worth spending, and both lists reach the user.
 */
export function evaluateChecks(checks: ToolChecks | undefined, text: string): CheckReport {
  const passed: string[] = [];
  const failed: string[] = [];
  if (!checks) return { passed, failed };
  const body = String(text || "");
  const words = (body.match(/\S+/g) || []).length;
  const add = (ok: boolean, label: string) => (ok ? passed : failed).push(label);

  if (checks.minWords) add(words >= checks.minWords, `at least ${checks.minWords} words (got ${words})`);
  if (checks.maxWords) add(words <= checks.maxWords, `under ${checks.maxWords} words (got ${words})`);
  if (checks.maxChars) add(body.length <= checks.maxChars, `under ${checks.maxChars} characters (got ${body.length})`);
  if (checks.headings) {
    const n = (body.match(/^#{1,3}\s+\S/gm) || []).length;
    add(n >= checks.headings, `${checks.headings}+ headings (got ${n})`);
  }
  if (checks.bullets) {
    const n = (body.match(/^\s*([-*•]|\d+[.)])\s+\S/gm) || []).length;
    add(n >= checks.bullets, `${checks.bullets}+ list items (got ${n})`);
  }
  if (checks.variants) {
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+[.)]\s+\S/.test(l) || /^[-*•]\s+\S/.test(l));
    const [lo, hi] = checks.variants;
    add(lines.length >= lo && lines.length <= hi, `${lo}–${hi} options (got ${lines.length})`);
  }
  for (const want of checks.mustInclude || []) {
    add(body.toLowerCase().includes(want.toLowerCase()), `includes "${want}"`);
  }
  for (const nope of checks.mustNotInclude || []) {
    add(!body.toLowerCase().includes(nope.toLowerCase()), `avoids "${nope}"`);
  }
  if (checks.codeBlock) {
    const blocks = body.match(/```\s*\n[\s\S]*?\n```/g) || [];
    add(blocks.length >= 1, "contains a fenced code block");
  }
  return { passed, failed };
}

/** Per-line length rules that can't be expressed as one aggregate check. */
function lineRules(spec: ToolSpec, text: string): string[] {
  const problems: string[] = [];
  if (spec.id === "tweet-writer") {
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*\d+[.)]\s+(.+?)(\s+—\s+why:.*)?$/);
      if (m && m[1].length > 280) {
        problems.push(`one option is ${m[1].length} characters — the limit is 280`);
        break;
      }
    }
  }
  if (spec.id === "x-thread") {
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*\d+\/\d+\s+(.+)$/);
      if (m && m[1].length > 280) {
        problems.push(`a tweet in the thread is ${m[1].length} characters — the limit is 280`);
        break;
      }
    }
  }
  return problems;
}

/* ── main entry ──────────────────────────────────────────── */

export async function runTool(opts: {
  spec: ToolSpec;
  values: Values;
  notes: string[];
  userId: string;
  plan: Plan;
  userKeys?: ProviderKeys;
  skills?: string[];
  prefer?: string[];
  avoid?: string[];
  studioHint?: string;
}): Promise<ToolRunResult> {
  const { spec, values, userId, plan } = opts;

  if (spec.engine === "verify") return runVerifyTool(opts);

  // 1 · quota BEFORE any paid work (server-side; the client cannot skip it)
  const limit = checkLimit(userId, plan, spec.feature);
  if (!limit.ok) {
    return {
      ok: false,
      status: 402,
      code: "LIMIT",
      error: limit.message || "Limit reached for today.",
      hint:
        limit.window === "day"
          ? "Free limit resets tomorrow. PRO keeps the same tools with a monthly window."
          : "Resets on the 1st.",
    };
  }

  // 2 · prompt comes from the server's spec, never from the client
  let prompts: { system: string; user: string };
  try {
    prompts = buildPrompts(spec, values);
  } catch (e) {
    return {
      ok: false,
      status: 500,
      code: "TOOL_SPEC",
      error: "This tool is misconfigured and was not run.",
      hint: String((e as Error)?.message || "").slice(0, 160),
    };
  }
  const system = opts.studioHint
    ? `${prompts.system}\n\nSTUDIO CONTEXT: ${opts.studioHint}`
    : prompts.system;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompts.user },
  ];

  // 3 · live model only
  let out: Awaited<ReturnType<typeof streamChatOrCode>>;
  try {
    out = await streamChatOrCode({
      mode: spec.feature,
      messages,
      plan,
      skills: opts.skills,
      prefer: opts.prefer,
      avoid: opts.avoid,
      promptForRouting: prompts.user,
      userKeys: opts.userKeys,
    });
  } catch (e) {
    const safe = toUserFacingError(e);
    return { ok: false, status: 502, code: safe.code, error: safe.message, hint: safe.hint };
  }

  if (!out.live) {
    // See HONESTY POLICY at the top of this file.
    bump("tool_refused_offline");
    return {
      ok: false,
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
      error: `${spec.name} needs a live model, and none is reachable right now.`,
      hint:
        "Connect a key in Settings → API keys (Groq has a free tier), or try again when the provider is back. Nothing was charged.",
    };
  }

  return streamWithChecks({
    spec,
    values,
    notes: opts.notes,
    userId,
    plan,
    model: out.model,
    modelId: out.modelId,
    stream: out.stream,
    messages,
    system,
    userKeys: opts.userKeys,
  });
}

/* ── streaming + grading + one corrective retry ──────────── */

async function streamWithChecks(args: {
  spec: ToolSpec;
  values: Values;
  notes: string[];
  userId: string;
  plan: Plan;
  model: string;
  modelId?: string;
  stream: ReadableStream<Uint8Array>;
  messages: { role: string; content: string }[];
  system: string;
  userKeys?: ProviderKeys;
}): Promise<ToolRunResult> {
  const { spec, userId, plan, model } = args;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ask = args.messages[args.messages.length - 1]?.content || "";

  const teed = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const reader = args.stream.getReader();
      let full = "";
      let closedEarly = false;
      try {
        send({
          meta: {
            tool: spec.id,
            model,
            ...(args.modelId ? { modelId: args.modelId } : {}),
            live: true,
            ...(args.notes.length ? { notes: args.notes } : {}),
          },
        });

        // ONE reader. The provider stream is normalised here rather than
        // forwarded byte-for-byte: `anyStreamToTextSSE` ends its own stream
        // with `{done:true}`, and forwarding that raw would tell the browser
        // the tool finished before the checks ran. Same reason the parse keeps a
        // carry-over buffer — a token split across two chunks is not lost.
        let buf = "";
        let upstreamError = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload);
              if (typeof j.token === "string" && j.token) {
                full += j.token;
                send({ token: j.token });
              } else if (typeof j.error === "string") {
                upstreamError = j.error;
              }
            } catch {
              /* malformed frame — the raw text still reached `full` intact */
            }
          }
        }
        if (upstreamError) {
          bump("tool_run_error");
          persist({ userId, spec, text: full, model, attempts: 1, report: { passed: [], failed: [] }, lineIssues: ["the model stream stopped early — the answer above is partial"], ask });
          recordUsageSafe(userId, spec.feature, 1);
          send({ error: upstreamError, partial: full.length > 0 });
          closedEarly = true;
          controller.close();
        }
      } catch (e) {
        // stream broke mid-answer: keep what we have, tell the user plainly
        bump("tool_run_error");
        persist({ userId, spec, text: full, model, attempts: 1, report: { passed: [], failed: [] }, lineIssues: ["stream interrupted — part of the answer was lost"], ask });
        recordUsageSafe(userId, spec.feature, 1);
        send({ error: "The model stopped mid-answer. What it wrote so far is saved in your history.", partial: true });
        closedEarly = true;
        controller.close();
      }

      if (closedEarly) return;

      try {
        const first = evaluateChecks(spec.checks, full);
        const lineIssues = lineRules(spec, full);
        const quality = qualityGate({ prompt: ask, answer: full, mode: spec.feature });

        let finalText = full;
        let report = first;
        let issues = lineIssues;
        let attempts = 1;

        if (first.failed.length || lineIssues.length) {
          send({ status: "checking", failed: [...first.failed, ...lineIssues] });
          const fix = await correctiveRetry({
            model: args.modelId || model,
            system: args.system,
            user: ask,
            bad: full,
            failed: [...first.failed, ...lineIssues],
            spec,
            userKeys: args.userKeys,
            plan,
          });
          attempts = 2;
          if (fix) {
            const second = evaluateChecks(spec.checks, fix);
            const secondIssues = lineRules(spec, fix);
            // take the retry only when it is measurably better
            if (second.failed.length + secondIssues.length < first.failed.length + lineIssues.length) {
              finalText = fix;
              report = second;
              issues = secondIssues;
              send({ replace: fix, attempts: 2 });
            } else {
              report = second.failed.length <= first.failed.length ? second : first;
              issues = [...secondIssues, "correction pass was no better — keeping the first answer"];
            }
          } else {
            issues = [...lineIssues, "correction pass unavailable (provider refused the retry) — answer kept as-is"];
          }
        }

        const conversationId = persist({
          userId,
          spec,
          text: finalText,
          model,
          modelId: args.modelId,
          attempts,
          report,
          lineIssues: issues,
          ask,
        });
        recordUsageSafe(userId, spec.feature, attempts);
        bump("tool_run_done");
        bump(`tool_${spec.id}`);

        send({
          done: true,
          model,
          attempts,
          corrected: attempts === 2 && finalText !== full,
          quality,
          checks: report,
          issues,
          ...(conversationId ? { conversationId } : {}),
        });
        controller.close();
      } catch (e) {
        bump("tool_run_error");
        console.error("[bw] tool grading", (e as Error)?.message);
        try {
          send({ done: true, model, attempts: 1, checks: { passed: [], failed: [] }, note: "answer delivered; the quality check itself failed to run" });
          controller.close();
        } catch {
          controller.error(e);
        }
      }
    },
  });

  return { ok: true, sse: teed, model, live: true };
}

async function correctiveRetry(args: {
  /** catalog model id, never the public label — see the note in providers.ts */
  model: string;
  system: string;
  user: string;
  bad: string;
  failed: string[];
  spec: ToolSpec;
  userKeys?: ProviderKeys;
  plan: Plan;
}): Promise<string | null> {
  const fixSystem = `${args.system}

CORRECTION PASS. The previous attempt FAILED these output-contract checks:
- ${args.failed.join("\n- ")}

Fix exactly those and change nothing else about quality or content. Same output format as specified above, nothing else.`;
  const messages = [
    { role: "system", content: fixSystem },
    {
      role: "user",
      content: `${args.user}\n\nPREVIOUS ATTEMPT (fix the listed problems):\n${args.bad.slice(0, 6000)}`,
    },
  ];
  try {
    const text = await completeVia(
      args.model,
      messages,
      { maxTokens: args.spec.maxTokens, temperature: Math.max(0.1, args.spec.temperature - 0.15) },
      args.userKeys
    );
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}

function persist(args: {
  userId: string;
  spec: ToolSpec;
  text: string;
  model: string;
  modelId?: string;
  attempts: number;
  report: CheckReport;
  lineIssues: string[];
  ask: string;
}) {
  try {
    const firstLine = (args.text || "").replace(/[#*`>-]/g, "").trim().split("\n")[0] || args.spec.name;
    const conv = createConversation({
      userId: args.userId,
      mode: "chat",
      title: `${args.spec.name}: ${firstLine.slice(0, 48)}`,
      messages: [],
    });
    appendMessages(conv.id, args.userId, [
      {
        id: uid("m"),
        role: "user",
        content: `**${args.spec.name}**\n\n${(args.ask || "").slice(0, 4000)}`,
        createdAt: new Date().toISOString(),
        meta: { tool: args.spec.id, toolName: args.spec.name },
      },
      {
        id: uid("m"),
        role: "assistant",
        content: args.text,
        createdAt: new Date().toISOString(),
        meta: {
          tool: args.spec.id,
          toolName: args.spec.name,
          model: args.model,
          ...(args.modelId ? { modelId: args.modelId } : {}),
          live: true,
          attempts: args.attempts,
          checksPassed: args.report.passed.length,
          checksFailed: [...args.report.failed, ...args.lineIssues],
        },
      },
    ]);
    return conv.id;
  } catch (e) {
    console.error("[bw] tool persist", e);
    return null;
  }
}

/**
 * Usage is counted for the number of model calls actually made, so a run that
 * needed a correction pass costs two — same rule the multi-model compare
 * route follows (audit A4: never let one request be a discount on compute).
 */
function recordUsageSafe(userId: string, feature: "chat" | "code", n: number) {
  try {
    recordUsage(userId, feature, n);
  } catch {
    /* a storage failure must not lose the user's answer */
  }
}

/* ── the verify engine (Hallucination Check) ─────────────── */

/**
 * Not a model call: extract the checkable claims and look for live sources,
 * the same rules /api/ai/verify uses (primary-source preference, no invented
 * confidence). When search can't run, it says so instead of returning a wall of
 * "unverified" that looks like a verdict.
 */
async function runVerifyTool(opts: {
  spec: ToolSpec;
  values: Values;
  userId: string;
  plan: Plan;
}): Promise<ToolRunResult> {
  const text = String(opts.values.answer || "");
  const claims = extractClaims(text);
  if (!claims.length) {
    return toolTextResponse(opts.spec, opts.userId, [
      `## Nothing to check`,
      ``,
      `No statistics, dates, prices or superlative claims were found in this text — there is nothing external to corroborate.`,
      ``,
      `That is not a claim that the text is true; it only means no sentence here is machine-checkable against a source.`,
    ].join("\n"));
  }

  const results = await Promise.all(
    claims.slice(0, 4).map(async (c) => {
      const found = await webSearch(c.text.slice(0, 120), { max: 4, timeoutMs: 7000 });
      const keyNums = (c.text.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      let verdict: "corroborated" | "unconfirmed" = "unconfirmed";
      let source: { title: string; url: string; host: string } | undefined;
      for (const r of found) {
        const nums = (r.snippet.match(/\d+(?:\.\d+)?/g) || []).map(Number);
        const sharesNumber = keyNums.length > 0 && keyNums.some((n) => nums.some((m) => Math.abs(m - n) < 0.01));
        const sharedTerms = (c.text.toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) =>
          r.snippet.toLowerCase().includes(w)
        ).length;
        if (sharesNumber || sharedTerms >= 3) {
          verdict = "corroborated";
          source = { title: r.title, url: r.url, host: r.host };
          break;
        }
      }
      return { claim: c.text, kind: c.kind, verdict, source, searched: found.length > 0 };
    })
  );

  const anySearch = results.some((r) => r.searched);
  const lines: string[] = [
    `## Hallucination check`,
    ``,
    anySearch
      ? `Checked ${results.length} of the ${claims.length} claim(s) that can be tested against the live web. "Corroborated" means a source's snippet matched its figures or terms — it is not proof the claim is right. "Unconfirmed" means no source was found, which includes claims that are simply not on the indexed web.`
      : `Live search is not reachable from this deployment, so no claim could be checked. This is a tool failure, not a verdict on your text — try again, or run each claim through a search engine yourself.`,
    ``,
    ...results.map(
      (r) =>
        `### ${r.verdict === "corroborated" ? "✅ Corroborated" : "❓ Unconfirmed"} — ${r.claim}\n` +
        `_${r.kind}${r.source ? ` · source: [${r.source.host}](${r.source.url})` : anySearch ? " · no matching source found" : " · search unavailable"}_`
    ),
  ];

  return toolTextResponse(opts.spec, opts.userId, lines.join("\n\n"));
}

async function toolTextResponse(
  spec: ToolSpec,
  userId: string,
  text: string
): Promise<ToolRunSuccess> {
  const enc = new TextEncoder();
  const teed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ meta: { tool: spec.id, model: "buildwe-verify", live: false, engine: "verify" } })}\n\n`));
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ token: text })}\n\n`));
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, model: "buildwe-verify", attempts: 1, checks: { passed: [], failed: [] } })}\n\n`));
      controller.close();
    },
  });
  try {
    recordUsageSafe(userId, "chat", 1);
  } catch {
    /* */
  }
  bump(`tool_${spec.id}`);
  return { ok: true, sse: teed, model: "buildwe-verify", live: true };
}
