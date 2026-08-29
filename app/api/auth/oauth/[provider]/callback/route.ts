import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, signSession } from "@/lib/auth/session";
import { findOrCreateOauthUser } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Profile = { oauthId: string; email?: string; name?: string };

async function googleProfile(code: string, redirectUri: string): Promise<Profile | null> {
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;
    const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    }).then((r) => r.json());
    if (!info?.sub) return null;
    return {
      oauthId: String(info.sub),
      email: info.email_verified ? String(info.email || "") : undefined,
      name: info.name ? String(info.name) : undefined,
    };
  } catch (e) {
    console.error("[bw] google oauth", e);
    return null;
  }
}

async function githubProfile(code: string, redirectUri: string): Promise<Profile | null> {
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code,
        client_id: process.env.GITHUB_CLIENT_ID!,
        client_secret: process.env.GITHUB_CLIENT_SECRET!,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;
    const headers = {
      Authorization: `Bearer ${access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "BUILDWE",
    };
    const user = await fetch("https://api.github.com/user", { headers }).then((r) => r.json());
    if (!user?.id) return null;
    let email: string | undefined;
    const emails = await fetch("https://api.github.com/user/emails", { headers })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const primary = Array.isArray(emails)
      ? emails.find((e: { primary?: boolean; verified?: boolean }) => e.primary && e.verified)
      : undefined;
    email = primary?.email || user.email || undefined;
    return {
      oauthId: String(user.id),
      email,
      name: user.name || user.login,
    };
  } catch (e) {
    console.error("[bw] github oauth", e);
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> | { provider: string } }
) {
  const p = params instanceof Promise ? (await params).provider : params.provider;
  const url = new URL(req.url);
  const home = (q: string) => NextResponse.redirect(new URL(`/${q}`, req.url));

  if (p !== "google" && p !== "github") return home("?oauth=unknown");

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const cookieState = req.cookies.get("bw_oauth_state")?.value || "";
  if (!code || !state || state !== cookieState) {
    return home("?oauth=failed");
  }

  const redirectUri = new URL(`/api/auth/oauth/${p}/callback`, url.origin).toString();
  const profile =
    p === "google"
      ? await googleProfile(code, redirectUri)
      : await githubProfile(code, redirectUri);
  if (!profile) return home("?oauth=failed");

  try {
    const user = findOrCreateOauthUser({
      provider: p,
      oauthId: profile.oauthId,
      email: profile.email,
      name: profile.name,
    });
    const token = await signSession({
      sub: user.id,
      kind: "user",
      email: user.email,
      name: user.name,
      plan: user.plan,
    });
    const res = NextResponse.redirect(new URL("/?welcome=1", req.url));
    setSessionCookie(res, token);
    res.cookies.set("bw_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    console.error("[bw] oauth session", e);
    return home("?oauth=failed");
  }
}
