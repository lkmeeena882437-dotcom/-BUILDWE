import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";
import { findStudio, findTool } from "@/lib/tools/registry";
import { resolveInputs } from "@/lib/tools/inputs";
import { runTool } from "@/lib/tools/run";
import { publicTool } from "@/lib/tools/types";
import { decryptSecret } from "@/lib/crypto";
import { findUserById } from "@/lib/db/store";
import { bump } from "@/lib/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tools/[id] — the tool's own spec (fields + contract), no prompts. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const spec = findTool(params.id);
  if (!spec) return NextResponse.json({ error: "Unknown tool." }, { status: 404 });
  return NextResponse.json({ ok: true, tool: publicTool(spec) });
}

/**
 * POST /api/tools/[id] { inputs, studio? }
 * Runs the tool and streams it as SSE. Errors before streaming are ordinary
 * JSON with a machine code (RATE_LIMIT / LIMIT / PROVIDER_UNAVAILABLE / TOOL_SPEC);
 * once streaming starts, errors arrive as a `data: {"error":…}` frame.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const spec = findTool(params.id);
  if (!spec) return NextResponse.json({ error: "Unknown tool." }, { status: 404 });

  try {
    const session = await getSessionFromRequest(req);

    // Per-tool scope, keyed on session identity (never on a header the client
    // can forge). Long-form tools get a tighter window than a one-line reply.
    const perMin = spec.engine === "verify" ? 10 : spec.maxTokens > 2000 ? 8 : 20;
    const rl = await limitAi(`tool:${spec.id}`, session.userId, perMin, 60_000);
    if (!rl.ok) {
      bump("tool_rate_limited");
      return NextResponse.json(
        {
          error: "Too many runs of this tool at once — wait a minute.",
          code: "RATE_LIMIT",
          hint: "Thoda ruk ke dobara try karo — 1 minute me window reset ho jaati hai.",
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be JSON: { inputs }." }, { status: 400 });
    }
    const resolved = resolveInputs(spec, (body as { inputs?: unknown }).inputs);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error, code: "BAD_INPUT", fields: resolved.fields },
        { status: 400 }
      );
    }

    const studio = body.studio ? findStudio(String(body.studio)) : undefined;
    const owner = findUserById(session.userId);
    const byok = owner?.byok || {};
    const userKeys = {
      groq: byok.groq ? decryptSecret(byok.groq) : undefined,
      openrouter: byok.openrouter ? decryptSecret(byok.openrouter) : undefined,
    };

    const rawSkills = owner?.skills || [];
    const skills = rawSkills.filter(
      (s: string) => !s.startsWith("prefer:") && !s.startsWith("avoid:")
    );
    const prefer = rawSkills.filter((s: string) => s.startsWith("prefer:")).map((s: string) => s.slice(7));
    const avoid = rawSkills.filter((s: string) => s.startsWith("avoid:")).map((s: string) => s.slice(6));

    bump("tool_run");
    const run = await runTool({
      spec,
      values: resolved.values,
      notes: resolved.notes,
      userId: session.userId,
      plan: session.plan,
      userKeys,
      skills,
      prefer,
      avoid,
      ...(studio ? { studioHint: `${studio.name} — ${studio.line}` } : {}),
    });

    if (!run.ok) {
      return NextResponse.json(
        { error: run.error, code: run.code, ...(run.hint ? { hint: run.hint } : {}) },
        { status: run.status }
      );
    }

    const res = new NextResponse(run.sse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Tool": spec.id,
        "X-Tool-Model": run.model,
      },
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] tool run route", e);
    bump("tool_run_error");
    return NextResponse.json(
      { error: "The tool could not run. Try again in a moment.", code: "INTERNAL" },
      { status: 500 }
    );
  }
}
