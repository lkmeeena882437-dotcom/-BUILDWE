import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oauth/{google|github} — start OAuth.
 * Works when GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET are set;
 * otherwise redirects home with a friendly note (?oauth=setup).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> | { provider: string } }
) {
  const p = params instanceof Promise ? (await params).provider : params.provider;

  if (p !== "google" && p !== "github") {
    return NextResponse.redirect(new URL("/?oauth=unknown", req.url));
  }
  const configured =
    p === "google"
      ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
      : Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  if (!configured) {
    return NextResponse.redirect(new URL(`/?oauth=setup&provider=${p}`, req.url));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL(
    `/api/auth/oauth/${p}/callback`,
    req.nextUrl.origin
  ).toString();

  const authUrl =
    p === "google"
      ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email profile",
          state,
        }).toString()}`
      : `https://github.com/login/oauth/authorize?${new URLSearchParams({
          client_id: process.env.GITHUB_CLIENT_ID!,
          redirect_uri: redirectUri,
          scope: "read:user user:email",
          state,
        }).toString()}`;

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("bw_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
