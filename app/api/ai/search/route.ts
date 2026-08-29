import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { webSearch } from "@/lib/ai/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:search:${session.userId}:${ip}`, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many searches — wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    if (!query) {
      return NextResponse.json({ error: "Query required." }, { status: 400 });
    }

    const results = await webSearch(query, { max: 5 });
    const res = NextResponse.json({ ok: true, query, results });
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
