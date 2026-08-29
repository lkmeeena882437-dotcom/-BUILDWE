import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { streamChatOrCode } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { composeSearchAnswer, searchContextBlock, webSearch } from "@/lib/ai/search";
import {
  appendMessages,
  createConversation,
  findUserById,
  isTeamMember,
  uid,
} from "@/lib/db/store";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:chat:${session.userId}:${ip}`, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Message required." }, { status: 400 });
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
    let searchResults: Awaited<ReturnType<typeof webSearch>> = [];
    if (wantSearch && userText) {
      searchResults = await webSearch(userText, { max: 5 });
    }

    let conversationId = (body.conversationId as string | undefined) || uid("conv");

    // Persist best-effort — never block the AI reply if storage fails
    try {
      if (!body.conversationId) {
        const teamId = body.teamId && isTeamMember(String(body.teamId), session.userId)
          ? String(body.teamId)
          : null;
        const c = createConversation({
          userId: session.userId,
          mode: "chat",
          title: String(userText).slice(0, 48) || "Chat",
          messages: [],
          projectId: body.projectId || null,
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
    const styleLines: string[] = [];
    if (depth === "short") {
      styleLines.push("LENGTH: Answer in 1–3 sentences. No lists, no preamble.");
    } else if (depth === "detailed") {
      styleLines.push("LENGTH: Thorough answer with clear sections and key details.");
    } else if (depth === "deep") {
      styleLines.push("LENGTH: Comprehensive deep-dive — structured sections, examples, edge cases, and a short summary at the end.");
    }
    if (tone === "simple") {
      styleLines.push("LANGUAGE: Plain, simple words a beginner understands. No jargon; explain any necessary term in one line.");
    } else if (tone === "expert") {
      styleLines.push("LANGUAGE: Expert-level precision. Technical terminology is welcome.");
    }
    const systemParts = [
      styleLines.length ? styleLines.join("\n") : "",
      contextBlock
        ? `${contextBlock}\n\nAnswer using these results where relevant. Cite sources inline as [1], [2]. If the results don't cover it, say so and answer from your own knowledge.`
        : "",
    ].filter(Boolean);
    const apiMessages = systemParts.length
      ? [{ role: "system", content: systemParts.join("\n\n") }, ...body.messages]
      : body.messages;

    // BYOK — the user's own keys take precedence
    const owner = findUserById(session.userId);
    const byok = owner?.byok || {};
    const userKeys = {
      groq: byok.groq ? decryptSecret(byok.groq) : undefined,
      openrouter: byok.openrouter ? decryptSecret(byok.openrouter) : undefined,
    };

    const { stream, model, live } = await streamChatOrCode({
      mode: "chat",
      messages: apiMessages,
      plan: session.plan,
      skills,
      prefer,
      avoid,
      promptForRouting: String(userText),
      userKeys,
      // when offline + search on, stream the composed sourced answer instead
      ...(wantSearch && searchResults.length
        ? { offlineOverrideText: composeSearchAnswer(userText, searchResults) }
        : {}),
    });

    try {
      recordUsage(session.userId, "chat");
    } catch {
      /* ignore */
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let full = "";

    const persistAssistant = (text: string) => {
      if (!text.trim()) return;
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
              ...(searchResults.length
                ? {
                    sources: searchResults.map((r) => ({
                      title: r.title,
                      url: r.url,
                      host: r.host,
                    })),
                  }
                : {}),
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
                  ...(searchResults.length
                    ? {
                        sources: searchResults.map((r) => ({
                          title: r.title,
                          url: r.url,
                          host: r.host,
                        })),
                      }
                    : {}),
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
          persistAssistant(full);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (e) {
          // Client aborted mid-stream → save the partial answer (stop & keep)
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
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
