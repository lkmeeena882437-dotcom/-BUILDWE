export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { getUsage } from "@/lib/db/store";
import { LIMITS } from "@/lib/config";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    let usage = {
      userId: session.userId,
      day: new Date().toISOString().slice(0, 10),
      chat: 0,
      code: 0,
      image: 0,
      audio: 0,
    };
    try {
      usage = getUsage(session.userId);
    } catch {
      /* */
    }
    const res = NextResponse.json({
      ...session,
      usage,
      limits:
        session.plan === "pro"
          ? {
              code: LIMITS.pro.codeMonthly,
              image: LIMITS.pro.imageMonthly,
              audio: LIMITS.pro.audioMonthly,
              chat: 2000,
            }
          : {
              code: LIMITS.free.codeDaily,
              image: LIMITS.free.imageDaily,
              audio: LIMITS.free.audioDaily,
              chat: 400,
            },
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] me", e);
    return NextResponse.json({
      userId: "guest_anon",
      kind: "guest",
      user: null,
      plan: "free",
      name: "Guest",
      usage: { chat: 0, code: 0, image: 0, audio: 0, day: new Date().toISOString().slice(0, 10) },
      limits: {
        code: LIMITS.free.codeDaily,
        image: LIMITS.free.imageDaily,
        audio: LIMITS.free.audioDaily,
        chat: 400,
      },
    });
  }
}
