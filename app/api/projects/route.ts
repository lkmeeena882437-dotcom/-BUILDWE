import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  setConversationProject,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const projects = listProjects(session.userId);
    const res = NextResponse.json({ projects });
    attachGuestCookie(res, session.userId);
    return res;
  } catch {
    return NextResponse.json({ projects: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const body = await req.json().catch(() => ({}));

    if (body.action === "create" && body.name) {
      const p = createProject(session.userId, String(body.name));
      const res = NextResponse.json({ project: p });
      attachGuestCookie(res, session.userId);
      return res;
    }

    if (body.action === "rename" && body.projectId && body.name) {
      const p = renameProject(
        String(body.projectId),
        session.userId,
        String(body.name)
      );
      if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ project: p });
    }

    if (body.action === "assign" && body.conversationId) {
      const c = setConversationProject(
        String(body.conversationId),
        session.userId,
        body.projectId ? String(body.projectId) : null
      );
      if (!c)
        return NextResponse.json(
          { error: "Conversation or project not found" },
          { status: 404 }
        );
      return NextResponse.json({ conversation: c });
    }

    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    console.error("[bw] projects POST", e);
    return NextResponse.json({ error: "Project action failed." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    deleteProject(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
