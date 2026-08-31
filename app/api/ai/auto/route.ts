import { NextRequest, NextResponse } from "next/server";
import { routeIntent } from "@/lib/ai/router";
import { INPUT_LIMITS } from "@/lib/ai/gateway";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/auto { prompt } → { mode, confidence, reasons }
 *
 * Auto Router (Update #1 section 2). The response keeps `mode` and `prompt`
 * exactly as before so existing clients are unaffected; `confidence` and
 * `reasons` are additive extras the UI can use to explain its choice.
 */
export async function POST(req: NextRequest) {
  // Cheap endpoint, but still abusable as a free CPU loop — bound it by the
  // signed session/guest identity, which an IP header cannot rotate.
  const session = await getSessionFromRequest(req);
  const rl = await limitAi("auto", session.userId, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error, code: "RATE_LIMIT", hint: rl.hint },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").slice(0, INPUT_LIMITS.promptChars);
  const decision = routeIntent(prompt);

  const res = NextResponse.json({
    mode: decision.mode,
    prompt: prompt.slice(0, 200),
    confidence: decision.confidence,
    reasons: decision.reasons,
  });
  attachGuestCookie(res, session.userId);
  return res;
}
