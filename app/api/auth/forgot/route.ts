import { NextRequest, NextResponse } from "next/server";
import { createPasswordReset, findUserByEmail } from "@/lib/db/store";
import { ALLOW_DEV_AUTH_LINKS } from "@/lib/config";
import { emailKey, safeIp } from "@/lib/rate-limit/guard";
import { rateLimitDurable } from "@/lib/rate-limit/durable";

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

    // Reset requests used to be unlimited: a script could hammer this endpoint
    // to mint tokens forever and to probe which emails have accounts. Per-email
    // and per-IP buckets, with the same "OK" answer either way.
    const gate = await Promise.all([
      rateLimitDurable(`forgot:email:${emailKey(email)}`, 5, 3600_000),
      rateLimitDurable(`forgot:ip:${safeIp(req)}`, 20, 3600_000),
    ]);
    if (gate.some((g) => !g.ok)) {
      return NextResponse.json({
        ok: true,
        message: "If that email has an account, a reset link is on its way.",
      });
    }

    const user = findUserByEmail(email);
    if (user) {
      const token = createPasswordReset(user.id);
      const link = `/reset?token=${token}`;
      // Reset tokens stay in the server log only while a local operator asked
      // for them. Production must not print a live credential next to an email.
      if (ALLOW_DEV_AUTH_LINKS) {
        console.log(`[bw] password reset link for ${email}: ${link}`);
      }
      const showDevLink = ALLOW_DEV_AUTH_LINKS;
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
