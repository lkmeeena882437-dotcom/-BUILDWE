import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { runChat as streamChatOrCode } from "@/lib/ai/adapter";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import {
  composeSearchAnswer,
  searchContextBlock,
  webSearchDetailed,
  type SearchResult,
} from "@/lib/ai/search";
import { understandPrompt } from "@/lib/ai/understanding";
import { qualityGate } from "@/lib/ai/quality";
import { estimateComplexity } from "@/lib/ai/models-catalog";
import { INPUT_LIMITS, toUserFacingError } from "@/lib/ai/gateway";
import { userProviderKeys } from "@/lib/ai/byok";
import { bump } from "@/lib/metrics/metrics";
import {
  appendMessages,
  createConversation,
  ensureConversationAccess,
  getProject,
  isTeamMember,
  listProjectFiles,
  uid,
} from "@/lib/db/store";
import {
  fileEditInstruction,
  formatProjectContext,
  parseContextInput,
} from "@/lib/ai/workspace-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("chat", session.userId, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment.", code: "RATE_LIMIT", hint: "Thoda ruk ke Try again dabao — 1 minute me limit reset ho jaati hai." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Message required." }, { status: 400 });
    }

    // Cost guard (audit V2): reject an absurd single message at the edge with a
    // clear reason. Milder oversize is clamped further down in the gateway.
    const longest = body.messages.reduce(
      (n: number, m: { content?: unknown }) =>
        Math.max(n, String(m?.content ?? "").length),
      0
    );
    if (longest > INPUT_LIMITS.messageChars) {
      return NextResponse.json(
        {
          error: "That message is too long. Shorten it or attach it as a file.",
          code: "MESSAGE_TOO_LONG",
          hint: "Bade text ko file me attach karo — BUILDWE usko summarise karke use karega.",
        },
        { status: 413 }
      );
    }

    // Workspace context (UI step 9): a chat can be pointed at the file the user has
    // open. Shape is validated here, ownership by the store query, and "that file is
    // gone" is answered with *no context and a plain reason* rather than a failed chat —
    // losing an answer to a stale chip would be a worse bug than losing the context.
    const ctxIn = parseContextInput(body.context);
    if (!ctxIn.ok) {
      return NextResponse.json({ error: ctxIn.error, code: ctxIn.code }, { status: 400 });
    }

    const limit = checkLimit(session.userId, session.plan, "chat");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Limit reached.", code: "LIMIT" },
        { status: 402 }
      );
    }

    const userText =
      [...body.messages].reverse().find((m: { role: string }) => m.role === "user")
        ?.content || "";

    const wantSearch = Boolean(body.webSearch);

    // ── Web search grounding (free, no key needed) ──────────
    let searchResults: SearchResult[] = [];
    let searchReason: string | undefined;
    if (wantSearch && userText) {
      const outcome = await webSearchDetailed(userText, { max: 5 });
      searchResults = outcome.results;
      // Keep the reason so an offline reply can explain the empty result set
      // instead of silently pretending the search never happened.
      if (!outcome.results.length) searchReason = outcome.reason;
    }

    let conversationId = (body.conversationId as string | undefined) || uid("conv");
    if (body.conversationId) {
      const access = await ensureConversationAccess(String(body.conversationId), session.userId);
      if (access === "forbidden") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    // Persist best-effort — never block the AI reply if storage fails
    try {
      if (!body.conversationId) {
        const teamId = body.teamId && isTeamMember(String(body.teamId), session.userId)
          ? String(body.teamId)
          : null;
        const projectId =
          body.projectId && getProject(String(body.projectId), session.userId)
            ? String(body.projectId)
            : null;
        const c = createConversation({
          userId: session.userId,
          mode: "chat",
          title: String(userText).slice(0, 48) || "Chat",
          messages: [],
          projectId,
          teamId,
        });
        conversationId = c.id;
      }
      appendMessages(conversationId, session.userId, [
        {
          id: uid("m"),
          role: "user",
          content: String(userText),
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      console.error("[bw] chat persist user", e);
    }

    const rawSkills = session.user?.skills || [];
    const skills = rawSkills.filter(
      (s: string) => !s.startsWith("prefer:") && !s.startsWith("avoid:")
    );
    const prefer = rawSkills
      .filter((s: string) => s.startsWith("prefer:"))
      .map((s: string) => s.slice(7));
    const avoid = rawSkills
      .filter((s: string) => s.startsWith("avoid:"))
      .map((s: string) => s.slice(6));

    // Inject search context + response-style controls as system messages
    const contextBlock = searchContextBlock(searchResults);
    const depth = String(body.depth || "balanced");
    const tone = String(body.tone || "standard");
    const systemHintExtras: string[] = [];

    // Prompt Understanding Layer (Update #1) — key-free intent/entities/gaps
    const understood = understandPrompt(String(userText));
    // Auto length: when the user hasn't chosen a depth, adapt to complexity
    const complexity = estimateComplexity(String(userText));
    let autoDepthHint = "";
    if (depth === "balanced") {
      if (complexity === "simple") autoDepthHint = "LENGTH (auto): this looks like a quick ask — answer in 1–4 sentences first; offer to go deeper only at the end.";
      else if (complexity === "complex") autoDepthHint = "LENGTH (auto): this is a complex task — structure the answer with clear sections and a short summary at the end.";
    }

    // Duplicate-work prevention (Update #2 P1): if the user re-asks essentially
    // the same thing already answered in this conversation, DON'T redo the work.
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\u0900-\u097F ]/g, " ").replace(/\s+/g, " ").trim();
    const nowNorm = norm(String(userText));
    const earlierUserAsks = body.messages
      .filter((m: { role?: string }) => m?.role === "user")
      .map((m: { content?: string }) => norm(String(m?.content || "")))
      .filter(Boolean);
    const isRepeat =
      nowNorm.length > 8 &&
      earlierUserAsks.slice(0, -1).some((p: string) => {
        if (p === nowNorm) return true;
        const a = new Set(p.split(" "));
        const b = nowNorm.split(" ");
        const overlap = b.filter((w: string) => a.has(w)).length / Math.max(b.length, 1);
        return overlap >= 0.85 && Math.abs(p.length - nowNorm.length) < 60;
      });
    if (isRepeat) {
      systemHintExtras.push(
        "DUPLICATE ASK: the user has already asked essentially this in this conversation. Do NOT redo the work or repeat the full answer. In one line, point to your earlier answer, give only what's new or different, and ask if they want it regenerated differently."
      );
    }

    // Smart execution (Update #2): complex tasks plan first, then execute
    if (complexity === "complex") {
      systemHintExtras.push(
        "PLAN FIRST: start with a 2–3 line plan of what you'll deliver, then execute it step by step. Keep each step tight — no filler."
      );
    }

    let workspace: { text: string; stats: ReturnType<typeof formatProjectContext>["stats"] } | null = null;
    let workspaceRef: { requested: string; attached: false; reason: "not_found" | "empty_project" } | null = null;
    if (ctxIn.value) {
      try {
        const rows = listProjectFiles(ctxIn.value.projectId, session.userId);
        const out = formatProjectContext(rows, {
          purpose: "chat",
          openPath: ctxIn.value.path,
        });
        if (out.stats.openAttached) workspace = out;
        else workspaceRef = {
          requested: ctxIn.value.path,
          attached: false,
          reason: rows.length ? "not_found" : "empty_project",
        };
      } catch (e) {
        console.error("[bw] chat workspace context", e);
      }
    }
    const contextMeta = workspace
      ? { attached: true as const, ...workspace.stats }
      : workspaceRef;

    const styleLines: string[] = [];
    if (depth === "short") {
      styleLines.push("LENGTH: Answer in 1–3 sentences. No lists, no preamble.");
    } else if (depth === "detailed") {
      styleLines.push("LENGTH: Thorough answer with clear sections and key details.");
    } else if (depth === "deep") {
      styleLines.push("LENGTH: Comprehensive deep-dive — structured sections, examples, edge cases, and a short summary at the end.");
    } else if (autoDepthHint) {
      styleLines.push(autoDepthHint);
    }
    if (tone === "simple") {
      styleLines.push("LANGUAGE: Plain, simple words a beginner understands. No jargon; explain any necessary term in one line.");
    } else if (tone === "expert") {
      styleLines.push("LANGUAGE: Expert-level precision. Technical terminology is welcome.");
    }
    const systemParts = [
      styleLines.length ? styleLines.join("\n") : "",
      understood.systemHint,
      // The file the reader is looking at, then how to hand an edit back. Instruction
      // second so it is the last thing before the conversation.
      workspace ? `${workspace.text}\n\n${fileEditInstruction(workspace.stats)}` : "",
      ...systemHintExtras,
      contextBlock
        ? `${contextBlock}\n\nAnswer using these results where relevant. Cite sources inline as [1], [2]. If the results don't cover it, say so and answer from your own knowledge.`
        : "",
    ].filter(Boolean);
    const apiMessages = systemParts.length
      ? [{ role: "system", content: systemParts.join("\n\n") }, ...body.messages]
      : body.messages;

    // BYOK — the user's own keys take precedence. Decrypted by `lib/ai/byok.ts`, the one place
    // that knows which providers a user may store a key for, so this cannot drift from what
    // /api/user/keys accepts or from what /api/ai/models reports as reachable.
    const userKeys = userProviderKeys(session.userId);

    const altModel = Number(body.altModel) > 0 && Number(body.altModel) < 4 ? Number(body.altModel) : 0;

    const { stream, model, live, fallbackNote } = await streamChatOrCode({
      mode: "chat",
      messages: apiMessages,
      plan: session.plan,
      skills,
      prefer,
      avoid,
      promptForRouting: String(userText),
      userKeys,
      ...(altModel ? { preferOffset: altModel } : {}),
      // when offline + search on, stream the composed sourced answer instead
      ...(wantSearch
        ? {
            offlineOverrideText: composeSearchAnswer(
              userText,
              searchResults,
              searchReason
            ),
          }
        : {}),
    });

    // internal metrics (Update #2) — no PII
    bump("chat_send");
    if (fallbackNote) bump("fallback");
    if (understood.correction) bump("correction");
    if (understood.surgical) bump("surgical_edit");

    try {
      recordUsage(session.userId, "chat");
    } catch {
      /* ignore */
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let full = "";

    let assistantSaved = false;
    const persistAssistant = (text: string, quality?: { label: string }) => {
      if (assistantSaved || !text.trim()) return;
      assistantSaved = true;
      try {
        appendMessages(conversationId!, session.userId, [
          {
            id: uid("m"),
            role: "assistant",
            content: text,
            createdAt: new Date().toISOString(),
            meta: {
              model,
              live,
              ...(understood.summary ? { understood: understood.summary } : {}),
              ...(quality ? { qualityLabel: quality.label } : {}),
              ...(searchResults.length
                ? {
                    sources: searchResults.map((r) => ({
                      title: r.title,
                      url: r.url,
                      host: r.host,
                    })),
                  }
                : {}),
              ...(contextMeta ? { context: contextMeta } : {}),
            },
          },
        ]);
      } catch (e) {
        console.error("[bw] chat persist assistant", e);
      }
    };

    const teed = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                meta: {
                  conversationId,
                  model: wantSearch && searchResults.length && !live ? "buildwe-search" : model,
                  live,
                  ...(fallbackNote ? { fallbackNote } : {}),
                  understood: understood.summary,
                  ...(understood.clarifier ? { clarifier: understood.clarifier } : {}),
                  ...(searchResults.length
                    ? {
                        sources: searchResults.map((r) => ({
                          title: r.title,
                          url: r.url,
                          host: r.host,
                        })),
                      }
                    : {}),
                  // What the model was actually shown. The chip and the line under the
                  // answer both read this, so the UI can never claim context it did not
                  // send (or hide that it dropped one).
                  ...(contextMeta ? { context: contextMeta } : {}),
                },
              })}\n\n`
            )
          );
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data:")) continue;
              try {
                const j = JSON.parse(line.slice(5).trim());
                if (j.token) full += j.token;
              } catch {
                /* */
              }
            }
            controller.enqueue(value);
          }
          // Quality gate — honest post-checks surfaced to the user (Update #1)
          let quality: ReturnType<typeof qualityGate> | undefined;
          try {
            quality = qualityGate({
              prompt: String(userText),
              answer: full,
              mode: "chat",
            });
          } catch {
            /* never block the answer */
          }
          persistAssistant(full, quality);
          bump("chat_done");
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, ...(quality ? { quality } : {}) })}\n\n`)
          );
          controller.close();
        } catch (e) {
          // Client aborted mid-stream → save the partial answer (stop & keep)
          bump("chat_error");
          persistAssistant(full);
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "Response interrupted. Try again." })}\n\n`
              )
            );
            controller.close();
          } catch {
            controller.error(e);
          }
        }
      },
    });

    const res = new NextResponse(teed, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] chat route", e);
    bump("chat_error");
    // Sanitised, typed error (Update #1 §9.4) — the user gets a useful reason
    // and a hint; raw provider text, URLs and stack traces stay in the log.
    const safe = toUserFacingError(e);
    return NextResponse.json(
      { error: safe.message, code: safe.code, ...(safe.hint ? { hint: safe.hint } : {}) },
      { status: safe.code === "RATE_LIMIT" ? 429 : safe.code === "TIMEOUT" ? 504 : 500 }
    );
  }
}
