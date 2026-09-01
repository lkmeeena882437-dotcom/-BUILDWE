import { NextRequest, NextResponse } from "next/server";
import { limitAi } from "@/lib/rate-limit/guard";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { bumpShareViews, createArtifactShare, createShare, getShare } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — create (or refresh) a public share link for a conversation, or for one artifact */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // A visit, recorded. The share page renders its content on the server now, so this is
    // the only thing the client still has to ask for — and it is keyed per link rather than
    // per user because a reader of a share is often signed out.
    if (body.action === "view") {
      const id = String(body.id || "");
      if (!id || !/^[A-Za-z0-9_-]{6,40}$/.test(id)) {
        return NextResponse.json({ error: "Bad share id", code: "BAD_SHARE_ID" }, { status: 400 });
      }
      const rl = await limitAi("share-view", id, 30, 60_000);
      if (!rl.ok) return NextResponse.json({ error: rl.error, hint: rl.hint }, { status: 429 });
      const out = bumpShareViews(id);
      if (!out.ok) {
        return NextResponse.json(
          { error: "Share not found", code: "SHARE_NOT_FOUND" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, views: out.views });
    }

    const session = await getSessionFromRequest(req);
    const conversationId = String(body.conversationId || "");
    const artifactId = String(body.artifactId || "");
    // Exactly one source. A request with both would make the outcome depend on the order
    // of two ifs, and a refresh would fight with itself over which one owns the link.
    if (conversationId && artifactId) {
      return NextResponse.json(
        { error: "A share link is either a chat or one creation, not both.", code: "BAD_SHARE_SOURCE" },
        { status: 400 }
      );
    }
    if (artifactId) {
      const out = createArtifactShare(artifactId, session.userId);
      if (!out.ok) {
        return NextResponse.json(
          {
            error:
              out.code === "NOTHING_TO_SHARE"
                ? "That creation has no file to link yet — media storage is not configured on this deployment."
                : "That creation is not yours or no longer exists.",
            code: out.code,
          },
          { status: out.code === "ARTIFACT_NOT_FOUND" ? 404 : 409 }
        );
      }
      const res = NextResponse.json({ ok: true, id: out.share.id, url: `/s/${out.share.id}` });
      attachGuestCookie(res, session.userId);
      return res;
    }
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId required", code: "BAD_SHARE_SOURCE" },
        { status: 400 }
      );
    }
    const share = createShare(conversationId, session.userId);
    if (!share) {
      return NextResponse.json(
        { error: "Conversation not found", code: "CONVERSATION_NOT_FOUND" },
        { status: 404 }
      );
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
      return NextResponse.json(
        { error: "Share not found", code: "SHARE_NOT_FOUND" },
        { status: 404 }
      );
    }
    // No view is counted here. A GET is a read, and this is also the endpoint a crawler, a
    // link checker or a curious developer hits — the count belongs to the page being opened
    // (action:"view" above), which is rate-bucketed per link.
    return NextResponse.json({
      ok: true,
      title: share.title,
      mode: share.mode,
      artifactId: share.artifactId ?? null,
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
