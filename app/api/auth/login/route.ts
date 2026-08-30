export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  findUserByEmail,
  migrateGuestData,
  publicUser,
  verifyPassword,
} from "@/lib/db/store";
import {
  clearGuestCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { verifyGuestCookie } from "@/lib/auth/guest";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { rateLimitDurable } from "@/lib/rate-limit/durable";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = await rateLimitDurable(`login:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
    }

    const body = schema.parse(await req.json());
    const user = findUserByEmail(body.email);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }
    // Work started in guest mode before logging in should follow the user in
    // (audit V5) — same migration as signup.
    const guestId = verifyGuestCookie(req.cookies.get("bw_guest")?.value);
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
    console.error("[bw] login", e);
    return NextResponse.json(
      { error: "Couldn’t log in. Check email/password and try again." },
      { status: 400 }
    );
  }
}
