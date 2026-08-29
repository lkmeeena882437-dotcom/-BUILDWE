import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByEmail, publicUser, verifyPassword } from "@/lib/db/store";
import { setSessionCookie, signSession } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`login:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  try {
    const body = schema.parse(await req.json());
    const user = findUserByEmail(body.email);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
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
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
