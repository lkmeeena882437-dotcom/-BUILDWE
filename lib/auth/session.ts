import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { findUserById, publicUser, type User, uid } from "@/lib/db/store";

const COOKIE = "bw_session";
const GUEST_COOKIE = "bw_guest";

function secret() {
  const s =
    process.env.SESSION_SECRET ||
    process.env.BYOK_ENCRYPTION_SECRET ||
    "buildwe-dev-secret-change-me-in-production-32b";
  return new TextEncoder().encode(s);
}

export type SessionPayload = {
  sub: string; // user id or guest:<id>
  kind: "user" | "guest";
  email?: string;
  name?: string;
  plan?: "free" | "pro";
};

export async function signSession(payload: SessionPayload, days = 30) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession(): Promise<{
  userId: string;
  kind: "user" | "guest";
  user: ReturnType<typeof publicUser> | null;
  plan: "free" | "pro";
  name: string;
}> {
  const jar = cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload?.sub) {
      if (payload.kind === "user") {
        const u = findUserById(payload.sub);
        if (u) {
          return {
            userId: u.id,
            kind: "user",
            user: publicUser(u),
            plan: u.plan,
            name: u.name,
          };
        }
      }
      if (payload.kind === "guest") {
        return {
          userId: payload.sub,
          kind: "guest",
          user: null,
          plan: "free",
          name: payload.name || "Guest",
        };
      }
    }
  }

  // Ensure guest id cookie exists for stable history
  let guest = jar.get(GUEST_COOKIE)?.value;
  if (!guest) {
    guest = `guest_${uid("g").slice(2)}`;
  }
  return {
    userId: guest.startsWith("guest") ? guest : `guest_${guest}`,
    kind: "guest",
    user: null,
    plan: "free",
    name: "Guest",
  };
}

export async function getSessionFromRequest(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload?.sub) {
      if (payload.kind === "user") {
        const u = findUserById(payload.sub);
        if (u) {
          return {
            userId: u.id,
            kind: "user" as const,
            user: publicUser(u),
            plan: u.plan as "free" | "pro",
            name: u.name,
          };
        }
      }
      return {
        userId: payload.sub,
        kind: "guest" as const,
        user: null,
        plan: "free" as const,
        name: payload.name || "Guest",
      };
    }
  }
  const g = req.cookies.get(GUEST_COOKIE)?.value || `guest_${uid("g").slice(2)}`;
  return {
    userId: g.startsWith("guest") ? g : `guest_${g}`,
    kind: "guest" as const,
    user: null,
    plan: "free" as const,
    name: "Guest",
  };
}

export function attachGuestCookie(res: NextResponse, userId: string) {
  if (userId.startsWith("guest")) {
    res.cookies.set(GUEST_COOKIE, userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
}

export type { User };
