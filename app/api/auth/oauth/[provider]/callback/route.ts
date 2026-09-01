import { NextRequest, NextResponse } from "next/server";
import {
  clearGuestCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { verifyGuestCookie } from "@/lib/auth/guest";
import { adoptGuestConversations, findOrCreateOauthUser, migrateGuestData } from "@/lib/db/store";
import { OAUTH, isOAuthProvider } from "@/lib/auth/oauth-endpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Profile = { oauthId: string; email?: string; name?: string };

async function googleProfile(code: string, redirectUri: string, verifier: string): Promise<Profile | null> {
  try {
    const tokenRes = await fetch(OAUTH.google().token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        // PKCE — the code is only redeemable by whoever started the flow.
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;
    const info = await fetch(OAUTH.google().userinfo, {
      headers: { Authorization: `Bearer ${access_token}` },
      cache: "no-store", // identity must never come from a cache
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

async function githubProfile(code: string, redirectUri: string, verifier: string): Promise<Profile | null> {
  try {
    const tokenRes = await fetch(OAUTH.github().token, {
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
        code_verifier: verifier,
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
    const gh = OAUTH.github().api;
    const user = await fetch(`${gh}/user`, {
      headers,
      cache: "no-store",
    }).then((r) => r.json());
    if (!user?.id) return null;
    let email: string | undefined;
    const emails = await fetch(`${gh}/user/emails`, {
      headers,
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const primary = Array.isArray(emails)
      ? emails.find((e: { primary?: boolean; verified?: boolean }) => e.primary && e.verified)
      : undefined;
    // VERIFIED ONLY. `user.email` from the GitHub profile endpoint is NOT
    // verified — and this email is what links an OAuth identity to an existing
    // BUILDWE account. Trusting it would let anyone who adds victim@example.com
    // to their GitHub profile log in as that person (audit A2 / W0.13).
    email = primary?.email || undefined;
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

  if (!isOAuthProvider(p)) return home("?oauth=unknown");

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const cookieState = req.cookies.get("bw_oauth_state")?.value || "";
  if (!code || !state || state !== cookieState) {
    return home("?oauth=failed");
  }

  // The verifier cookie must exist AND belong to this flow. A callback that
  // arrives without one is either a replay or a client that skipped /authorize.
  const verifier = req.cookies.get("bw_oauth_pkce")?.value || "";
  if (!verifier) return home("?oauth=failed");

  const redirectUri = new URL(`/api/auth/oauth/${p}/callback`, url.origin).toString();
  const profile =
    p === "google"
      ? await googleProfile(code, redirectUri, verifier)
      : await githubProfile(code, redirectUri, verifier);
  if (!profile) return home("?oauth=failed");

  try {
    const user = findOrCreateOauthUser({
      provider: p,
      oauthId: profile.oauthId,
      email: profile.email,
      name: profile.name,
    });

    // Guest → account migration (audit V5), same as email signup/login.
    const guestId = verifyGuestCookie(req.cookies.get("bw_guest")?.value);
    if (guestId) {
      try {
        migrateGuestData(guestId, user.id);
        await adoptGuestConversations(guestId, user.id);
      } catch (err) {
        console.error("[bw] guest migration (oauth)", err);
      }
    }

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
    res.cookies.set("bw_oauth_pkce", "", { path: "/", maxAge: 0 });
    if (guestId) clearGuestCookie(res);
    return res;
  } catch (e) {
    console.error("[bw] oauth session", e);
    return home("?oauth=failed");
  }
}
