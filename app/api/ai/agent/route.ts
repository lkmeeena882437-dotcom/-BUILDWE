import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { findUserById, listProjects, createProject } from "@/lib/db/store";
import { decryptSecret } from "@/lib/crypto";
import { bump } from "@/lib/metrics/metrics";
import { INPUT_LIMITS } from "@/lib/ai/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/agent  { goal, projectId?, canvasCode?, canvasLang? }
 *
 * Runs the coding agent end to end and streams progress as SSE. Unlike
 * /api/ai/chat this is not a text completion — it is a plan → act → verify
 * loop that reads and writes real project files.
 *
 * Cost control: an agent run is many model calls, so it is metered as a code
 * generation against the caller's plan BEFORE the loop starts, rate limited
 * more tightly than chat, and hard-capped inside lib/ai/agent.ts.
 */

function sse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);

    // Tighter than chat: each run is a multi-step loop, not one completion.
    const rl = rateLimit(`ai:agent:${session.userId}:${ip}`, 6, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: "Too many agent runs — give it a minute.",
          code: "RATE_LIMIT",
          hint: "Agent runs do a lot of work per request, so they're limited more tightly than chat.",
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const goal = String(body.goal || "").trim();
    if (!goal) {
      return NextResponse.json({ error: "Tell the agent what to build.", code: "BAD_INPUT" }, { status: 400 });
    }
    if (goal.length > INPUT_LIMITS.promptChars) {
      return NextResponse.json(
        { error: "That instruction is too long. Trim it and try again.", code: "TOO_LARGE" },
        { status: 413 }
      );
    }

    const canvasCode = String(body.canvasCode || "").slice(0, INPUT_LIMITS.messageChars);
    const canvasLang = String(body.canvasLang || "").slice(0, 32);

    const user = session.kind === "user" ? findUserById(session.userId) : null;
    const plan: "free" | "pro" = user?.plan === "pro" ? "pro" : "free";

    // Server-side quota check — an agent run counts as a code generation.
    const limit = checkLimit(session.userId, plan, "code");
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: limit.message || "You've reached today's coding limit.",
          code: "LIMIT_REACHED",
          hint: "Upgrade to PRO for a much larger monthly allowance.",
        },
        { status: 429 }
      );
    }

    // Resolve the project: agents need somewhere to put files, so create one
    // on first use rather than failing.
    let projectId = String(body.projectId || "").trim();
    if (!projectId) {
      const existing = listProjects(session.userId);
      projectId =
        existing[0]?.id ||
        createProject(session.userId, "Agent workspace").id;
    }

    const userKeys = user?.byok
      ? {
          groq: user.byok.groq ? decryptSecret(user.byok.groq) || undefined : undefined,
          openrouter: user.byok.openrouter
            ? decryptSecret(user.byok.openrouter) || undefined
            : undefined,
        }
      : undefined;

    bump("agent_run");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (e: AgentEvent) => {
          try {
            controller.enqueue(encoder.encode(sse(e)));
          } catch {
            /* client disconnected */
          }
        };

        // Tell the client which project it landed in before any work starts.
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "meta", projectId })}\n\n`)
        );

        try {
          const result = await runAgent({
            userId: session.userId,
            projectId,
            goal,
            plan,
            userKeys,
            canvasCode,
            canvasLang,
            onEvent: send,
          });

          recordUsage(session.userId, "code");
          if (result.verified) bump("agent_verified");
          if (!result.ok) bump("agent_failed");

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "result",
                ok: result.ok,
                summary: result.summary,
                filesChanged: result.filesChanged,
                steps: result.steps,
                verified: result.verified,
                ...(result.primaryFile ? { primaryFile: result.primaryFile } : {}),
              })}\n\n`
            )
          );
        } catch (e) {
          console.error("[bw] agent run", e);
          send({
            type: "error",
            text: "The agent hit an unexpected problem and stopped. Nothing was left half-written.",
          });
        } finally {
          controller.close();
        }
      },
    });

    const res = new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] agent route", e);
    return NextResponse.json(
      { error: "Couldn't start the agent. Try again.", code: "SERVER" },
      { status: 500 }
    );
  }
}
