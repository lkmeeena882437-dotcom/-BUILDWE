import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById, updateUser } from "@/lib/db/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Custom instructions / skills — like ChatGPT custom instructions */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (session.kind !== "user" || !session.user) {
    return NextResponse.json({ skills: [], requireAuth: true });
  }
  const u = findUserById(session.user.id);
  const skills = (u?.skills || []).filter(
    (s) => !s.startsWith("prefer:") && !s.startsWith("avoid:")
  );
  return NextResponse.json({ skills, requireAuth: false });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user" || !session.user) {
      return NextResponse.json(
        { error: "Sign in to save skills / custom instructions." },
        { status: 401 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const incoming = Array.isArray(body.skills)
      ? body.skills.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [];
    const u = findUserById(session.user.id);
    if (!u) {
      return NextResponse.json({ error: "Account not found on this instance. Try again." }, { status: 404 });
    }
    // preserve feedback tags
    const feedback = (u.skills || []).filter(
      (s) => s.startsWith("prefer:") || s.startsWith("avoid:")
    );
    const skills = [...incoming.slice(0, 16), ...feedback].slice(0, 24);
    updateUser(u.id, { skills });
    return NextResponse.json({
      skills: skills.filter((s) => !s.startsWith("prefer:") && !s.startsWith("avoid:")),
    });
  } catch (e) {
    console.error("[bw] skills", e);
    return NextResponse.json({ error: "Couldn’t save skills." }, { status: 500 });
  }
}
