import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { rateLimitDurable } from "@/lib/rate-limit/durable";
import { streamChatOrCode } from "@/lib/ai/providers";
import { findApiKeyByHash, findUserById, touchApiKey } from "@/lib/db/store";
import { sha256Hex, decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC developer API — POST /api/v1/chat
 *
 * Headers: Authorization: Bearer bw_sk_…
 * Body:    { "prompt": "..." }  or  { "messages": [{role, content}, …], "mode": "chat"|"code" }
 * Returns: { ok, model, live, reply }
 */

async function resolveKey(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("bw_sk_")) return null;
  return findApiKeyByHash(sha256Hex(token));
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = await resolveKey(req);
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Invalid or missing API key. Pass Authorization: Bearer bw_sk_…" },
        { status: 401 }
      );
    }

    const rl = await rateLimitDurable(`devapi:${apiKey.id}:${clientIp(req)}`, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "Rate limit — 30 requests/min per key." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const mode = body?.mode === "code" ? "code" : "chat";

    let messages: { role: string; content: string }[];
    if (Array.isArray(body?.messages) && body.messages.length) {
      messages = body.messages
        .filter((m: { role?: string }) => m?.role === "user" || m?.role === "assistant" || m?.role === "system")
        .slice(-20)
        .map((m: { role: string; content: string }) => ({
          role: String(m.role),
          content: String(m.content || "").slice(0, 8000),
        }));
    } else if (body?.prompt) {
      messages = [{ role: "user", content: String(body.prompt).slice(0, 8000) }];
    } else {
      return NextResponse.json(
        { ok: false, error: "Provide `prompt` or `messages`." },
        { status: 400 }
      );
    }

    const user = findUserById(apiKey.userId);
    const byok = user?.byok || {};
    const userKeys = {
      groq: byok.groq ? decryptSecret(byok.groq) : undefined,
      openrouter: byok.openrouter ? decryptSecret(byok.openrouter) : undefined,
    };

    const { stream, model, live } = await streamChatOrCode({
      mode,
      messages,
      plan: user?.plan || "free",
      promptForRouting: messages[messages.length - 1]?.content || "",
      userKeys,
    });

    // collect the SSE stream into one reply
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let reply = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const line of buf.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5).trim());
          if (j.token) reply += j.token;
        } catch {
          /* partial */
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    }

    touchApiKey(apiKey.id);

    return NextResponse.json({
      ok: true,
      model,
      live,
      reply,
      usage: { characters: reply.length },
    });
  } catch (e) {
    console.error("[bw] v1 chat", e);
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Try again." },
      { status: 500 }
    );
  }
}
