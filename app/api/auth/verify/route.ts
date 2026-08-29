import { NextRequest, NextResponse } from "next/server";
import { findUserById, updateUser } from "@/lib/db/store";
import { verifyVerifyToken } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/verify?token=… — marks the account's email verified */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") || "";
  const parsed = verifyVerifyToken(token);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Link invalid or expired." }, { status: 400 });
  }
  const user = findUserById(parsed.userId);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }
  updateUser(parsed.userId, { emailVerified: true });
  return NextResponse.json({ ok: true, email: parsed.email });
}
