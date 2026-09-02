import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { runChat as streamChatOrCode } from "@/lib/ai/adapter";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { understandPrompt } from "@/lib/ai/understanding";
import {
  addGeneration,
  appendMessages,
  createConversation,
  ensureConversationAccess,
  getProject,
  listProjectFiles,
  uid,
} from "@/lib/db/store";
import { formatProjectContext, parseContextInput } from "@/lib/ai/workspace-context";
import { userProviderKeys } from "@/lib/ai/byok";
import { INPUT_LIMITS, toUserFacingError } from "@/lib/ai/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("code", session.userId, 30, 60_000);
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

    // Cost guard (audit V2) — same ceiling as chat.
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
          hint: "Bada code file me attach karo — BUILDWE usko padh ke kaam karega.",
        },
        { status: 413 }
      );
    }

    const limit = checkLimit(session.userId, session.plan, "code");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Limit reached.", code: "LIMIT" },
        { status: 402 }
      );
    }

    const userText =
      [...body.messages].reverse().find((m: { role: string }) => m.role === "user")
        ?.content || "";

    let conversationId = (body.conversationId as string | undefined) || uid("conv");
    if (body.conversationId) {
      const access = await ensureConversationAccess(String(body.conversationId), session.userId);
      if (access === "forbidden") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    try {
      if (!body.conversationId) {
        const c = createConversation({
          userId: session.userId,
          mode: "code",
          title: String(userText).slice(0, 48) || "Code",
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
      console.error("[bw] code persist user", e);
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

    // Same resolver chat and the agent use — a code run that decrypted only two
    // vendors would ignore a key the user just saved for another one.
    const userKeys = userProviderKeys(session.userId);

    // Prompt Understanding Layer (Update #1) — same benefits for Code
    const understood = understandPrompt(String(userText));

    // Coding-agent project context (Update #1 §3.1): when the request belongs
    // to a project, the model sees that project's real files instead of guessing at
    // structure from the chat alone. The formatter lives in
    // lib/ai/workspace-context.ts — one owner for the shape of the block, the byte
    // budget and the statistics, shared with the chat route. Code mode keeps its own
    // apply path (the canvas + Save canvas), so it is NOT given the buildwe-file
    // instruction: telling it to answer in a fence the canvas does not read would
    // quietly break the flow it already has.
    const ctxIn = parseContextInput(body.context);
    if (!ctxIn.ok) {
      return NextResponse.json({ error: ctxIn.error, code: ctxIn.code }, { status: 400 });
    }
    let projectContext = "";
    let contextStats: ReturnType<typeof formatProjectContext>["stats"] | null = null;
    /** Set when a project was asked for but contributed nothing, so the UI can say why. */
    let contextRef: { requested: true; attached: false; reason: "not_found" | "empty_project" } | null =
      null;
    const projectId = body.projectId ? String(body.projectId) : "";
    if (projectId) {
      // Ownership is enforced by the store query itself: `listProjectFiles`
      // filters on userId, so another account's project simply has no files
      // here. Guessing an id therefore leaks nothing — but it also used to be
      // indistinguishable from "your project is empty", and the answer came
      // back written as if the model had seen the code. Saying which of the two
      // happened is the difference between a wrong answer and a fixable one.
      if (!getProject(projectId, session.userId)) {
        contextRef = { requested: true, attached: false, reason: "not_found" };
      } else {
        try {
          const rows = listProjectFiles(projectId, session.userId);
          const out = formatProjectContext(rows, {
            purpose: "code",
            ...(ctxIn.value ? { openPath: ctxIn.value.path } : {}),
          });
          if (rows.length) {
            projectContext = out.text;
            contextStats = out.stats;
          } else {
            contextRef = { requested: true, attached: false, reason: "empty_project" };
          }
        } catch (e) {
          console.error("[bw] project context", e);
        }
      }
    }
    // Never fail the request over context — a lost answer is worse than a lost
    // file list — but do tell the model it is working blind, so it asks for the
    // code instead of inventing a file structure.
    const contextMeta = contextStats
      ? { attached: true as const, ...contextStats }
      : contextRef;

    const blindNote = contextRef
      ? contextRef.reason === "not_found"
        ? "PROJECT CONTEXT: the referenced project could not be read, so you have NOT been shown its files. Do not invent its structure — work from the conversation, and ask for the relevant file if you need it."
        : "PROJECT CONTEXT: this project has no files yet, so there is no existing code to build on. Say so briefly if the request assumes otherwise."
      : "";
    const codeSystemParts = [understood.systemHint, projectContext, blindNote].filter(Boolean);
    const codeMessages = codeSystemParts.length
      ? [
          { role: "system", content: codeSystemParts.join("\n\n---\n\n") },
          ...body.messages,
        ]
      : body.messages;

    const { stream, model, live, fallbackNote } = await streamChatOrCode({
      mode: "code",
      messages: codeMessages,
      plan: session.plan,
      skills,
      prefer,
      avoid,
      promptForRouting: String(userText),
      userKeys,
    });

    try {
      recordUsage(session.userId, "code");
    } catch {
      /* */
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let full = "";

    const teed = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                meta: {
                  conversationId,
                  model,
                  live,
                  ...(fallbackNote ? { fallbackNote } : {}),
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
          if (full.trim()) {
            try {
              appendMessages(conversationId!, session.userId, [
                {
                  id: uid("m"),
                  role: "assistant",
                  content: full,
                  createdAt: new Date().toISOString(),
                  meta: {
                    model,
                    live,
                    ...(contextMeta ? { context: contextMeta } : {}),
                  },
                },
              ]);
              addGeneration({
                userId: session.userId,
                type: "code",
                prompt: String(userText),
                outputText: full,
                meta: { model, live },
              });
            } catch (e) {
              console.error("[bw] code persist assistant", e);
            }
          }
          controller.close();
        } catch (e) {
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
    console.error("[bw] code route", e);
    // Sanitised, typed error (Update #1 §9.4).
    const safe = toUserFacingError(e);
    return NextResponse.json(
      { error: safe.message, code: safe.code, ...(safe.hint ? { hint: safe.hint } : {}) },
      { status: safe.code === "RATE_LIMIT" ? 429 : safe.code === "TIMEOUT" ? 504 : 500 }
    );
  }
}
