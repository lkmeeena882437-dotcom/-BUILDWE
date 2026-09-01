export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, migrateGuestData, publicUser } from "@/lib/db/store";
import {
  clearGuestCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { verifyGuestCookie } from "@/lib/auth/guest";
import { limitSignup } from "@/lib/rate-limit/guard";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Body first, then BOTH limits: per-IP and per-email. Keying on the email
    // too means rotating X-Forwarded-For no longer buys fresh quota (audit C3).
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid email and password (min 8 characters)." },
        { status: 422 }
      );
    }
    const gate = await limitSignup(req, parsed.data.email);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error, hint: gate.hint },
        { status: 429 }
      );
    }

    // Capture the (verified) guest identity BEFORE the account exists, so the
    // work done in guest mode can follow the user into their new account.
    const guestId = verifyGuestCookie(req.cookies.get("bw_guest")?.value);

    const body = parsed.data;
    const user = createUser({
      email: body.email,
      password: body.password,
      name: body.name || body.email.split("@")[0],
    });

    // Guest → account migration (audit V5). Best-effort: a migration problem
    // must never block a successful signup.
    let migrated = { conversations: 0, projects: 0, generations: 0, shares: 0 };
    if (guestId) {
      try {
        migrated = migrateGuestData(guestId, user.id);
      } catch (err) {
        console.error("[bw] guest migration", err);
      }
    }

    const token = await signSession({
      sub: user.id,
      kind: "user",
      email: user.email,
      name: user.name,
      plan: user.plan,
    });
    const res = NextResponse.json({ user: publicUser(user), migrated });
    setSessionCookie(res, token);
    if (guestId) clearGuestCookie(res);
    return res;
  } catch (e) {
    const msg = (e as Error).message || "Couldn’t create account.";
    // Never leak raw ENOENT paths to UI
    // STORE_BUSY is the store saying "somebody else is writing". That is a wait-a-moment, not a
    // "fix what you typed", so it gets 503 — the client shows the message either way, but a status
    // of 400 on a transient server condition teaches the wrong lesson to whoever reads the logs.
    const busy = /STORE_BUSY|is busy/i.test(msg);
    const safe = /ENOENT|EACCES|mkdir|EPERM|read-only/i.test(msg) || busy
      ? "Couldn’t save account right now. Please try again."
      : msg.includes("already")
        ? "Email already registered. Try logging in."
        : msg.includes("Invalid") || msg.includes("email")
          ? "Enter a valid email and password (min 6 characters)."
          : "Couldn’t create account. Please try again.";
    const status = msg.includes("already") ? 409 : busy ? 503 : 400;
    console.error("[bw] register", e);
    return NextResponse.json({ error: safe }, { status });
  }
}
