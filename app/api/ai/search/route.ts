import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";
import { webSearchDetailed } from "@/lib/ai/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("search", session.userId, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: rl.error, hint: rl.hint }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    if (!query) {
      return NextResponse.json({ error: "Query required." }, { status: 400 });
    }

    const outcome = await webSearchDetailed(query, { max: 5 });
    // Report the real outcome: an empty list with no explanation used to look
    // identical to a broken backend from the client's point of view.
    const res = NextResponse.json({
      ok: outcome.status === "ok",
      query,
      results: outcome.results,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] search route", e);
    return NextResponse.json(
      { error: "Search failed. Try again." },
      { status: 500 }
    );
  }
}
