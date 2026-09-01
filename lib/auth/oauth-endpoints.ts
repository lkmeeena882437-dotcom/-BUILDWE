/**
 * OAuth endpoint resolution.
 *
 * The IdP URLs were hardcoded, which meant two things: GitHub Enterprise or a
 * Keycloak-style local IdP could not be used at all, and the flow could not be
 * tested without calling a real vendor (so nobody tested it — that is how the
 * missing PKCE and the unverified-email link both survived).
 *
 * Same discipline as `AI_BASE_URL_<PROVIDER>`: an override is accepted only if
 * it is an absolute http(s) URL, so a stray value can never turn into
 * `fetch(undefined)` or a redirect to a relative path.
 */

function abs(name: string, fallback: string): string {
  const v = (process.env[name] || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/.test(v) ? v : fallback;
}

export const OAUTH = {
  google: () => ({
    authorize: abs("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    token: abs("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    userinfo: abs("GOOGLE_USERINFO_URL", "https://www.googleapis.com/oauth2/v3/userinfo"),
  }),
  github: () => ({
    authorize: abs("GITHUB_AUTH_URL", "https://github.com/login/oauth/authorize"),
    token: abs("GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
    api: abs("GITHUB_API_URL", "https://api.github.com"),
  }),
} as const;

export type OAuthProvider = keyof typeof OAUTH;

export function isOAuthProvider(p: string): p is OAuthProvider {
  return p === "google" || p === "github";
}

export function oauthConfigured(p: OAuthProvider): boolean {
  return p === "google"
    ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    : Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}
