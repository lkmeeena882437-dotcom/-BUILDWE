import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { bumpShareViews, createShare, getShare } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — create (or refresh) a public share link for a conversation */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const conversationId = String(body.conversationId || "");
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }
    const share = createShare(conversationId, session.userId);
    if (!share) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const res = NextResponse.json({
      ok: true,
      id: share.id,
      url: `/s/${share.id}`,
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] share POST", e);
    return NextResponse.json({ error: "Couldn't create share link." }, { status: 500 });
  }
}

/** GET /api/share?id=… — public read-only snapshot */
export async function GET(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const share = getShare(id);
    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    bumpShareViews(id);
    return NextResponse.json({
      ok: true,
      title: share.title,
      mode: share.mode,
      createdAt: share.createdAt,
      views: share.views,
      messages: share.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          sources: (m.meta as { sources?: unknown } | undefined)?.sources,
        })),
    });
  } catch (e) {
    console.error("[bw] share GET", e);
    return NextResponse.json({ error: "Share unavailable" }, { status: 500 });
  }
}
