export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, publicUser } from "@/lib/db/store";
import { setSessionCookie, signSession } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`reg:${ip}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
    }

    const body = schema.parse(await req.json());
    const user = createUser({
      email: body.email,
      password: body.password,
      name: body.name || body.email.split("@")[0],
    });
    const token = await signSession({
      sub: user.id,
      kind: "user",
      email: user.email,
      name: user.name,
      plan: user.plan,
    });
    const res = NextResponse.json({ user: publicUser(user) });
    setSessionCookie(res, token);
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
