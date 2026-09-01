import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { newPkce } from "@/lib/auth/pkce";
import { OAUTH, isOAuthProvider, oauthConfigured } from "@/lib/auth/oauth-endpoints";

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

  if (!isOAuthProvider(p)) {
    return NextResponse.redirect(new URL("/?oauth=unknown", req.url));
  }
  if (!oauthConfigured(p)) {
    return NextResponse.redirect(new URL(`/?oauth=setup&provider=${p}`, req.url));
  }

  const state = randomBytes(16).toString("hex");
  // PKCE: the challenge goes to the IdP now, the verifier stays in an httpOnly
  // cookie and is replayed at the token endpoint. A stolen code is useless
  // without it.
  const { verifier, challenge } = newPkce();
  const redirectUri = new URL(
    `/api/auth/oauth/${p}/callback`,
    req.nextUrl.origin
  ).toString();

  const authUrl =
    p === "google"
      ? `${OAUTH.google().authorize}?${new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email profile",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString()}`
      : `${OAUTH.github().authorize}?${new URLSearchParams({
          client_id: process.env.GITHUB_CLIENT_ID!,
          redirect_uri: redirectUri,
          scope: "read:user user:email",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString()}`;

  const res = NextResponse.redirect(authUrl);
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  };
  res.cookies.set("bw_oauth_state", state, cookieOpts);
  res.cookies.set("bw_oauth_pkce", verifier, cookieOpts);
  return res;
}
