import { NextRequest, NextResponse } from "next/server";
import { routeIntent } from "@/lib/ai/router";
import { INPUT_LIMITS } from "@/lib/ai/gateway";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";

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
  // Cheap endpoint, but still abusable as a free CPU loop — bound it.
  const rl = rateLimit(`ai:auto:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests — wait a moment.", code: "RATE_LIMIT" },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").slice(0, INPUT_LIMITS.promptChars);
  const decision = routeIntent(prompt);

  return NextResponse.json({
    mode: decision.mode,
    prompt: prompt.slice(0, 200),
    confidence: decision.confidence,
    reasons: decision.reasons,
  });
}
