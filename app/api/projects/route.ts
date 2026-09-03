import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import {
  createProject,
  deleteProject,
  listProjects,
  PROJECT_NAME_MAX,
  renameProject,
  setConversationProject,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const projects = listProjects(session.userId);
    // nameMax travels with the list so the field that creates a project enforces the
    // store's own number instead of repeating a literal that can drift from it.
    const res = NextResponse.json({ projects, nameMax: PROJECT_NAME_MAX });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] projects GET", e);
    // An empty list here is not a graceful degradation, it is a false statement: the
    // client would clear chips for projects that are still on the server.
    return NextResponse.json(
      { error: "Could not load your projects.", code: "PROJECTS_UNAVAILABLE" },
      { status: 503 }
    );
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
    const removed = deleteProject(id, session.userId);
    if (!removed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[bw] projects DELETE", e);
    return NextResponse.json({ error: "Could not delete that right now." }, { status: 500 });
  }
}
