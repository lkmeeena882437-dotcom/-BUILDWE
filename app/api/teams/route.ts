import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import {
  createTeam,
  findUserById,
  joinTeamByCode,
  leaveTeam,
  listTeams,
  newTeamInvite,
  setConversationTeam,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teamView(t: Awaited<ReturnType<typeof listTeams>>[number], userId: string) {
  return {
    id: t.id,
    name: t.name,
    ownerId: t.ownerId,
    memberCount: t.members.length,
    myRole: t.members.find((m) => m.userId === userId)?.role || "member",
    createdAt: t.createdAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const teams = listTeams(session.userId).map((t) => teamView(t, session.userId));
    const res = NextResponse.json({ teams });
    attachGuestCookie(res, session.userId);
    return res;
  } catch {
    return NextResponse.json({ teams: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        { error: "Log in to use team workspaces." },
        { status: 401 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const me = findUserById(session.userId);

    if (body.action === "create" && body.name) {
      const t = createTeam({
        userId: session.userId,
        name: String(body.name),
        email: me?.email,
        userName: me?.name,
      });
      const res = NextResponse.json({ team: teamView(t, session.userId) });
      attachGuestCookie(res, session.userId);
      return res;
    }

    if (body.action === "invite" && body.teamId) {
      const code = newTeamInvite(String(body.teamId), session.userId);
      if (!code) return NextResponse.json({ error: "Team not found" }, { status: 404 });
      return NextResponse.json({ code });
    }

    if (body.action === "join" && body.code) {
      const r = joinTeamByCode(String(body.code), {
        userId: session.userId,
        email: me?.email,
        name: me?.name,
      });
      if ("error" in r) {
        return NextResponse.json({ error: r.error }, { status: 400 });
      }
      return NextResponse.json({ team: teamView(r.team!, session.userId) });
    }

    if (body.action === "leave" && body.teamId) {
      const r = leaveTeam(String(body.teamId), session.userId);
      if ("error" in r) {
        return NextResponse.json({ error: r.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, dissolved: Boolean(r.dissolved) });
    }

    if (body.action === "assign" && body.conversationId) {
      const c = setConversationTeam(
        String(body.conversationId),
        session.userId,
        body.teamId ? String(body.teamId) : null
      );
      if (!c) {
        return NextResponse.json(
          { error: "Chat or team not found (or no access)" },
          { status: 404 }
        );
      }
      return NextResponse.json({ conversation: { id: c.id, teamId: c.teamId } });
    }

    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    console.error("[bw] teams POST", e);
    return NextResponse.json({ error: "Team action failed." }, { status: 500 });
  }
}
