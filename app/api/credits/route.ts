import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { creditSummary } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/credits — the wallet, the price list and the ledger in one read.
 *
 * Guests get it too: their wallet is cookie-scoped, which is why the daily
 * quota (not the wallet) is the real free-tier boundary. `no-store` because a
 * cached balance is a lie the moment any generation runs (and this app has
 * already been bitten once by a cached identity read).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const summary = creditSummary(session.userId, session.plan);
    const res = NextResponse.json({ ok: true, signedIn: session.kind === "user", ...summary });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] credits route", e);
    return NextResponse.json(
      { ok: false, error: "Could not read the wallet right now." },
      { status: 500 }
    );
  }
}
