import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { findUserById, updateUser } from "@/lib/db/store";
import { applyFeedback, buildMind, type MindProfile } from "@/lib/ai/mind";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stores lightweight “mind” feedback on the user profile skills array
 * using prefixed notes: prefer:… / avoid:…
 * Guests: accepted but not persisted long-term.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const kind = body.kind === "down" ? "down" : "up";
    const note = String(body.note || "").slice(0, 160);

    if (session.kind !== "user" || !session.user) {
      const res = NextResponse.json({
        ok: true,
        persisted: false,
        message: "Feedback noted for this session. Sign in to save Mind long-term.",
      });
      attachGuestCookie(res, session.userId);
      return res;
    }

    const u = findUserById(session.user.id);
    if (!u) {
      return NextResponse.json({ ok: true, persisted: false });
    }

    const prefix = kind === "up" ? "prefer:" : "avoid:";
    const entry = `${prefix}${note || (kind === "up" ? "good reply style" : "generic replies")}`;
    const skills = [...(u.skills || []).filter((s) => !s.startsWith(prefix) || s !== entry), entry].slice(
      -20
    );
    updateUser(u.id, { skills });

    const prefer = skills
      .filter((s) => s.startsWith("prefer:"))
      .map((s) => s.slice(7));
    const avoid = skills
      .filter((s) => s.startsWith("avoid:"))
      .map((s) => s.slice(6));
    const mind: MindProfile = buildMind([], skills, { prefer, avoid });

    const res = NextResponse.json({ ok: true, persisted: true, mind });
    return res;
  } catch (e) {
    console.error("[bw] feedback", e);
    return NextResponse.json({ ok: false, error: "Couldn’t save feedback." }, { status: 500 });
  }
}
