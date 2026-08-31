/**
 * PKCE (RFC 7636) for the authorization-code flow.
 *
 * Why this is not optional: BUILDWE is a public client on a browser. Without
 * PKCE, an authorization code that leaks — via a referrer, a log line, a
 * misconfigured redirect, or a malicious app registered on the same device —
 * can be redeemed by whoever picks it up, because the code alone plus
 * client_id+secret is enough. PKCE binds the code to THIS browser: the token
 * endpoint only accepts it with the verifier that produced the challenge we
 * sent at /authorize.
 *
 * The verifier never leaves the server side of the flow (it lives in an
 * httpOnly cookie); the challenge is the only half the IdP sees up front.
 */

import { createHash, randomBytes } from "node:crypto";

/** base64url without padding, as the RFC requires. */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 43–128 characters, unreserved set — the range RFC 7636 §4.1 allows. */
export function newCodeVerifier(): string {
  return b64url(randomBytes(48)); // 64 characters
}

export function challengeFor(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = newCodeVerifier();
  return { verifier, challenge: challengeFor(verifier) };
}

/**
 * Constant-time-ish comparison for the verifier round-trip. The value is not a
 * secret in the password sense, but a length-prefixed equality check keeps a
 * truncated/garbled cookie from being treated as a match.
 */
export function verifierMatches(cookie: string, expected: string): boolean {
  if (!cookie || !expected) return false;
  if (cookie.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
