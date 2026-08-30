import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { rateLimitDurable } from "@/lib/rate-limit/durable";
import { streamChatOrCode } from "@/lib/ai/providers";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { findUserById } from "@/lib/db/store";
import { decryptSecret } from "@/lib/crypto";
import { bump } from "@/lib/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/code-action { code, lang, action }
 * Code Canvas actions (Update #1 P1 #8, shipped v1.7.0):
 *   fix      → bug-focused repair
 *   optimize → performance + simplicity
 *   refactor → readability + structure
 *   test     → runnable checks / test script
 * "run" is CLIENT-side only (HTML preview / JS sandboxed worker) — never here,
 * because we never execute user code on the server.
 *
 * Honest offline: without a live model the action says so instead of
 * fabricating a fake "fixed" version.
 */

const ACTIONS: Record<string, { title: string; instruction: string }> = {
  fix: {
    title: "Fix",
    instruction:
      "Find and fix real bugs (logic errors, broken references, crashes, security holes like innerHTML with user input). Keep everything else EXACTLY the same. Do not add features.",
  },
  optimize: {
    title: "Optimize",
    instruction:
      "Make it faster and lighter (fewer DOM queries, less rework, smaller payloads, cheaper loops). Keep behaviour identical. Only optimize what actually matters — no micro-noise.",
  },
  refactor: {
    title: "Refactor",
    instruction:
      "Restructure for readability: clear names, small functions, consistent style, comments only where needed. Keep behaviour and output IDENTICAL.",
  },
  test: {
    title: "Test",
    instruction:
      "Write a short runnable test script for this code. For JavaScript: plain console.assert(...) checks covering the main paths and one edge case each — no frameworks, no imports. For HTML/CSS: a manual checklist of 5 concrete things to check in the browser. Keep it under 40 lines.",
  },
};

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.token) out += j.token;
      } catch {
        /* partial */
      }
    }
    buf = buf.slice(buf.lastIndexOf("\n") + 1);
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await rateLimitDurable(
      `ai:code-action:${session.userId}:${clientIp(req)}`,
      20,
      60_000
    );
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: "Too many actions — wait a moment.",
          code: "RATE_LIMIT",
          hint: "Thoda ruk ke try karo — 1 minute me limit reset ho jaati hai.",
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").slice(0, 24_000);
    const lang = String(body?.lang || "javascript");
    const action = ACTIONS[String(body?.action || "")]
      ? String(body?.action)
      : null;

    if (!code.trim()) {
      return NextResponse.json(
        { error: "Koi code canvas me nahi hai — pehle code banao ya paste karo." },
        { status: 400 }
      );
    }
    if (!action) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const limit = checkLimit(session.userId, session.plan, "code");
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: limit.message || "Limit reached.",
          code: "LIMIT",
          hint: "Plan limit reached — thodi der baad try karo.",
        },
        { status: 402 }
      );
    }

    // BYOK keys take precedence (same as chat/code routes)
    const owner = session.kind === "user" ? findUserById(session.userId) : null;
    const byok = owner?.byok || {};
    const userKeys = {
      groq: byok.groq ? decryptSecret(byok.groq) : undefined,
      openrouter: byok.openrouter ? decryptSecret(byok.openrouter) : undefined,
    };

    const spec = ACTIONS[action];
    const { stream, live } = await streamChatOrCode({
      mode: "code",
      messages: [
        {
          role: "user",
          content: `Language: ${lang}\n\nAction: ${spec.instruction}\n\nCODE:\n\`\`\`${lang}\n${code}\n\`\`\`\n\nReturn the FULL ${action === "test" ? "test script" : "updated code"} in ONE fenced code block first, then (outside the block) max 3 short bullet lines: what changed and why. Hindi-English (Hinglish) me bullets likho.`,
        },
      ],
      plan: session.plan,
      promptForRouting: `${action} this ${lang} code`,
      userKeys,
    });

    if (!live) {
      return NextResponse.json({
        ok: false,
        available: false,
        message:
          "Code actions need a live model, which isn't reachable right now. You can connect your own key in Settings → API keys, or try again in a moment.",
      });
    }

    try {
      recordUsage(session.userId, "code");
    } catch {
      /* ignore */
    }
    bump(`code_action_${action}`);

    const reply = await collect(stream);

    // extract the first fenced code block
    const block =
      /```[a-zA-Z0-9+-]*\r?\n([\s\S]*?)```/.exec(reply)?.[1]?.trim() || "";

    const notes = block
      ? reply
          .replace(/```[\s\S]*?```/g, "")
          .trim()
          .slice(0, 600)
      : reply.slice(0, 600);

    const res = NextResponse.json({
      ok: true,
      action,
      title: spec.title,
      code: block,
      notes,
      raw: block ? undefined : reply.slice(0, 1500),
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] code-action route", e);
    return NextResponse.json(
      {
        error: "Action failed — try again.",
        code: "ACTION_FAILED",
        hint: "Dobara try karo; agar phir fail ho to code chhota karke attempt karo.",
      },
      { status: 500 }
    );
  }
}
