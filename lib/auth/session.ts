import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { findUserById, publicUser, type User } from "@/lib/db/store";
import { newGuestId, signGuestId, verifyGuestCookie } from "@/lib/auth/guest";

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
  sub: string;
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

export async function verifyToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

function cookieSecure() {
  // Vercel production is always HTTPS
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_ENV)
  );
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieSecure(),
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
    secure: cookieSecure(),
    sameSite: "lax",
  });
}

function userFromPayload(payload: SessionPayload) {
  return {
    userId: payload.sub,
    kind: "user" as const,
    user: {
      id: payload.sub,
      email: payload.email || "",
      name: payload.name || "User",
      plan: (payload.plan || "free") as "free" | "pro",
      skills: [] as string[],
      createdAt: "",
    },
    plan: (payload.plan || "free") as "free" | "pro",
    name: payload.name || "User",
  };
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
    if (payload?.sub && payload.kind === "user") {
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
      // JWT trusted when DB instance lost user (serverless)
      return userFromPayload(payload);
    }
    if (payload?.sub && payload.kind === "guest") {
      return {
        userId: payload.sub,
        kind: "guest",
        user: null,
        plan: "free",
        name: payload.name || "Guest",
      };
    }
  }

  // Guest ids must be HMAC-signed (audit V1) — a forged/unsigned cookie is
  // discarded and the visitor simply starts a fresh guest identity.
  const guest = verifyGuestCookie(jar.get(GUEST_COOKIE)?.value) || newGuestId();
  return {
    userId: guest,
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
    if (payload?.sub && payload.kind === "user") {
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
      return userFromPayload(payload);
    }
    if (payload?.sub) {
      return {
        userId: payload.sub,
        kind: "guest" as const,
        user: null,
        plan: "free" as const,
        name: payload.name || "Guest",
      };
    }
  }
  // Signature-verified guest id (audit V1); forged cookies get a fresh identity.
  const g = verifyGuestCookie(req.cookies.get(GUEST_COOKIE)?.value) || newGuestId();
  return {
    userId: g,
    kind: "guest" as const,
    user: null,
    plan: "free" as const,
    name: "Guest",
  };
}

/**
 * Re-issue the guest cookie in SIGNED form. Same call signature as before, so
 * every existing route keeps working — only the stored value gains an HMAC.
 */
export function attachGuestCookie(res: NextResponse, userId: string) {
  if (userId.startsWith("guest")) {
    res.cookies.set(GUEST_COOKIE, signGuestId(userId), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: cookieSecure(),
      maxAge: 60 * 60 * 24 * 365,
    });
  }
}

/** Clear the guest cookie once its data has been migrated into a real account. */
export function clearGuestCookie(res: NextResponse) {
  res.cookies.set(GUEST_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
    secure: cookieSecure(),
    sameSite: "lax",
  });
}

export type { User };
