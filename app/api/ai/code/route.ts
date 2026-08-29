import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { streamChatOrCode } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { understandPrompt } from "@/lib/ai/understanding";
import { qualityGate } from "@/lib/ai/quality";
import {
  addGeneration,
  appendMessages,
  createConversation,
  findUserById,
  uid,
} from "@/lib/db/store";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:code:${session.userId}:${ip}`, 30, 60_000);
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

    // BYOK — the user's own keys take precedence
    const owner = findUserById(session.userId);
    const byok = owner?.byok || {};
    const userKeys = {
      groq: byok.groq ? decryptSecret(byok.groq) : undefined,
      openrouter: byok.openrouter ? decryptSecret(byok.openrouter) : undefined,
    };

    // Prompt Understanding Layer (Update #1) — same benefits for Code
    const understood = understandPrompt(String(userText));
    const codeMessages = understood.systemHint
      ? [{ role: "system", content: understood.systemHint }, ...body.messages]
      : body.messages;

    const { stream, model, live } = await streamChatOrCode({
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
              `data: ${JSON.stringify({ meta: { conversationId, model, live } })}\n\n`
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
                  meta: { model, live },
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
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
