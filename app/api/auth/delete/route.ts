import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionFromRequest } from "@/lib/auth/session";
import { deleteUserCascade, findUserById, verifyPassword } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/delete { password } — deletes the account and ALL its data */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json({ error: "Log in first." }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const password = String(body?.password || "");

    const user = findUserById(session.userId);
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    // OAuth-only accounts have an unusable random password — confirm by email instead
    if (user.passwordHash && user.provider !== "google" && user.provider !== "github") {
      if (!password || !verifyPassword(password, user.passwordHash)) {
        return NextResponse.json(
          { error: "Password doesn't match. Account NOT deleted." },
          { status: 403 }
        );
      }
    } else if (String(body?.confirm || "").toUpperCase() !== "DELETE") {
      return NextResponse.json(
        { error: "Type DELETE to confirm. Account NOT deleted." },
        { status: 403 }
      );
    }

    deleteUserCascade(session.userId);
    const res = NextResponse.json({ ok: true, deleted: true });
    clearSessionCookie(res);
    return res;
  } catch (e) {
    console.error("[bw] account delete", e);
    return NextResponse.json({ error: "Couldn't delete account." }, { status: 500 });
  }
}
