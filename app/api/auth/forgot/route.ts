import { NextRequest, NextResponse } from "next/server";
import { createPasswordReset, findUserByEmail } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot { email }
 * Always answers OK (never reveals whether an email exists).
 * Delivery: an SMTP provider can be wired later; until then the reset
 * link is logged server-side, and returned in the response ONLY when
 * SHOW_DEV_LINKS=true (local dev convenience) — never in production.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    }

    const user = findUserByEmail(email);
    if (user) {
      const token = createPasswordReset(user.id);
      const link = `/reset?token=${token}`;
      console.log(`[bw] password reset link for ${email}: ${link}`);
      const showDevLink = process.env.SHOW_DEV_LINKS === "true";
      return NextResponse.json({
        ok: true,
        message: "If that email has an account, a reset link is on its way.",
        ...(showDevLink ? { devLink: link } : {}),
      });
    }

    // same response shape — no account enumeration
    return NextResponse.json({
      ok: true,
      message: "If that email has an account, a reset link is on its way.",
    });
  } catch (e) {
    console.error("[bw] forgot", e);
    return NextResponse.json({ error: "Couldn't start reset." }, { status: 500 });
  }
}
