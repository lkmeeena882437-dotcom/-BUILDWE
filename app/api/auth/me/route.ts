import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { getUsage } from "@/lib/db/store";
import { LIMITS } from "@/lib/config";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const usage = getUsage(session.userId);
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
}
