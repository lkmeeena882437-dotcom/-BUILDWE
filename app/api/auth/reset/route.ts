import { NextRequest, NextResponse } from "next/server";
import { consumePasswordReset } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "");
    if (!token) {
      return NextResponse.json({ error: "Reset link is invalid." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters." },
        { status: 400 }
      );
    }
    const user = consumePasswordReset(token, password);
    if (!user) {
      return NextResponse.json(
        { error: "This reset link is invalid, used, or expired. Request a new one." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, message: "Password updated — log in with your new password." });
  } catch (e) {
    console.error("[bw] reset", e);
    return NextResponse.json({ error: "Couldn't reset password." }, { status: 500 });
  }
}
