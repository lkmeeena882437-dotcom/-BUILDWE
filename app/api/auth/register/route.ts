import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, publicUser } from "@/lib/db/store";
import {
  attachGuestCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`reg:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  try {
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
    const msg = (e as Error).message || "Register failed";
    const status = msg.includes("already") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
