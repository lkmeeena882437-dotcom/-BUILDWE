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
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { rateLimitDurable } from "@/lib/rate-limit/durable";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = await rateLimitDurable(`reg:${ip}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
    }

    // Capture the (verified) guest identity BEFORE the account exists, so the
    // work done in guest mode can follow the user into their new account.
    const guestId = verifyGuestCookie(req.cookies.get("bw_guest")?.value);

    const body = schema.parse(await req.json());
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
    const safe = /ENOENT|EACCES|mkdir|EPERM|read-only/i.test(msg)
      ? "Couldn’t save account right now. Please try again."
      : msg.includes("already")
        ? "Email already registered. Try logging in."
        : msg.includes("Invalid") || msg.includes("email")
          ? "Enter a valid email and password (min 6 characters)."
          : "Couldn’t create account. Please try again.";
    const status = msg.includes("already") ? 409 : 400;
    console.error("[bw] register", e);
    return NextResponse.json({ error: safe }, { status });
  }
}
