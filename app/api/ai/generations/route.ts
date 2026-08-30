import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { listGenerations } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/generations?type=image|audio|code&limit=n
 *
 * Generation history (Update #1 §4.5). Image and audio outputs were already
 * being persisted via addGeneration(), but nothing ever read them back — the
 * user's past creations existed in the database and were unreachable from the
 * product. This exposes them, owner-scoped.
 *
 * The `prompt` is returned so a result can be re-run (§4.3 retry).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const url = new URL(req.url);

    const typeParam = url.searchParams.get("type");
    const type =
      typeParam === "image" || typeParam === "audio" || typeParam === "code"
        ? typeParam
        : undefined;

    // NOTE: a missing param yields null, and Number(null) === 0 (finite), so
    // read the raw string first — otherwise the default silently becomes 1.
    const limitParam = url.searchParams.get("limit");
    const limitRaw = limitParam === null ? NaN : Number(limitParam);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100)
      : 50;

    const items = listGenerations(session.userId, type)
      .slice(0, limit)
      .map((g) => ({
        id: g.id,
        type: g.type,
        prompt: g.prompt,
        outputUrl: g.outputUrl,
        // Text outputs can be long (vision descriptions) — trim for the list.
        outputText: g.outputText ? g.outputText.slice(0, 2000) : undefined,
        meta: g.meta,
        createdAt: g.createdAt,
      }));

    const res = NextResponse.json({ generations: items, count: items.length });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] generations GET", e);
    return NextResponse.json({ generations: [], count: 0 });
  }
}
