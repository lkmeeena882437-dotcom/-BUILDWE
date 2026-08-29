export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import {
  appendMessages,
  createConversation,
  deleteConversation,
  listConversations,
  listGenerations,
  uid,
} from "@/lib/db/store";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const conversations = listConversations(session.userId).map((c) => ({
      id: c.id,
      title: c.title,
      mode: c.mode,
      updatedAt: c.updatedAt,
      preview: c.messages[c.messages.length - 1]?.content?.slice(0, 100) || "",
      messageCount: c.messages.length,
      projectId: c.projectId ?? null,
    }));
    const generations = listGenerations(session.userId);
    const res = NextResponse.json({ conversations, generations });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] history GET", e);
    return NextResponse.json({ conversations: [], generations: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const body = await req.json().catch(() => ({}));

    if (body.action === "create") {
      const c = createConversation({
        userId: session.userId,
        mode: body.mode || "chat",
        title: body.title || "New chat",
        messages: body.messages || [],
      });
      const res = NextResponse.json({ conversation: c });
      attachGuestCookie(res, session.userId);
      return res;
    }

    if (body.action === "append" && body.conversationId) {
      const msgs = (body.messages || []).map(
        (m: { role: string; content: string; id?: string }) => ({
          id: m.id || uid("m"),
          role: m.role,
          content: m.content,
          createdAt: new Date().toISOString(),
        })
      );
      const c = appendMessages(
        body.conversationId,
        session.userId,
        msgs,
        body.title
      );
      if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ conversation: c });
    }

    if (body.action === "get" && body.conversationId) {
      const all = listConversations(session.userId);
      const c = all.find((x) => x.id === body.conversationId);
      if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ conversation: c });
    }

    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    console.error("[bw] history POST", e);
    return NextResponse.json(
      { error: "Couldn’t update history right now." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    deleteConversation(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[bw] history DELETE", e);
    return NextResponse.json({ ok: true });
  }
}
