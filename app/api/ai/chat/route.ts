import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { streamChatOrCode } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import {
  appendMessages,
  createConversation,
  uid,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const ip = clientIp(req);
  const rl = rateLimit(`ai:chat:${session.userId}:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit — slow down" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const limit = checkLimit(session.userId, session.plan, "chat");
  if (!limit.ok) {
    return NextResponse.json({ error: limit.message, code: "LIMIT" }, { status: 402 });
  }

  const userText =
    [...body.messages].reverse().find((m: { role: string }) => m.role === "user")
      ?.content || "";

  let conversationId = body.conversationId as string | undefined;
  if (!conversationId) {
    const c = createConversation({
      userId: session.userId,
      mode: "chat",
      title: String(userText).slice(0, 48) || "Chat",
      messages: [],
    });
    conversationId = c.id;
  }

  // persist user message
  appendMessages(conversationId, session.userId, [
    {
      id: uid("m"),
      role: "user",
      content: String(userText),
      createdAt: new Date().toISOString(),
    },
  ]);

  const { stream, model, live } = await streamChatOrCode({
    mode: "chat",
    messages: body.messages,
    plan: session.plan,
    skills: session.user?.skills,
    promptForRouting: String(userText),
  });

  recordUsage(session.userId, "chat");

  // Tee stream to capture assistant text for history
  const decoder = new TextDecoder();
  let full = "";
  const encoder = new TextEncoder();
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
          // extract tokens for storage
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
          appendMessages(conversationId!, session.userId, [
            {
              id: uid("m"),
              role: "assistant",
              content: full,
              createdAt: new Date().toISOString(),
              meta: { model, live },
            },
          ]);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
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
}
