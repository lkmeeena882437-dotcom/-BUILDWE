export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adoptGuestConversations,
  findUserByEmail,
  hydrateAccountByEmail,
  migrateGuestData,
  publicUser,
  verifyPassword,
  waitForRemoteBoot,
} from "@/lib/db/store";
import {
  clearGuestCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { verifyGuestCookie } from "@/lib/auth/guest";
import { limitLogin } from "@/lib/rate-limit/guard";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid email and password." },
        { status: 422 }
      );
    }
    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    // Per-account limit is checked with the credential in hand, so it survives
    // any amount of IP rotation; the IP bucket stays as the broad flood brake.
    const rl = await limitLogin(req, email);
    if (!rl.ok) {
      return NextResponse.json(
        { error: rl.error, hint: rl.hint },
        { status: 429 }
      );
    }

    await waitForRemoteBoot();
    await hydrateAccountByEmail(email);
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
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
        await adoptGuestConversations(guestId, user.id);
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
    const msg = (e as Error).message || "";
    const busy = /STORE_BUSY|is busy/i.test(msg);
    console.error("[bw] login", e);
    return NextResponse.json(
      {
        error: busy
          ? "Couldn’t save your session right now. Please try again."
          : "Couldn’t log in. Check email/password and try again.",
      },
      { status: busy ? 503 : 400 }
    );
  }
}
