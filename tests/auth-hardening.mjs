/**
 * Auth hardening: PKCE, state binding, verified-email linking, BYOK shapes.
 *
 * The IdP here is a fixture — but it is a fixture with real rules: it refuses
 * to exchange a code unless the `code_verifier` hashes to the `code_challenge`
 * that was sent at /authorize, exactly like GitHub and Google do. So this suite
 * fails if PKCE is dropped, if the verifier is not bound to the flow, or if
 * `state` stops being checked. No product code is mocked.
 *
 * Run: npm run test:auth
 */

import http from "node:http";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { newJar, report, req, run, startServer } from "./harness.mjs";

const PORT = 3341;
const IDP_PORT = 3342;
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const challengeOf = (v) => b64url(createHash("sha256").update(v).digest());

/* ── 1 · pure PKCE, checked against the RFC's own vector ── */

const tmpOut = mkdtempSync(path.join(tmpdir(), "pkce-"));
const pkce = await (async () => {
  execFileSync("npx", ["--no-install", "tsc", "--target", "es2020", "--module", "nodenext",
    "--moduleResolution", "nodenext", "--outDir", tmpOut, "lib/auth/pkce.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: "pipe",
  });
  return import(path.join(tmpOut, "pkce.js"));
})();

await run("code challenge matches RFC 7636 Appendix B, not just 'some hash'", () => {
  // The verifier/challenge pair from RFC 7636 §4.6 — if this passes, the S256
  // construction is the standard one, which is what the IdP will check.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const want = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const got = pkce.challengeFor(verifier);
  if (got !== want) throw new Error(`S256 gave ${got}`);
});

await run("generated verifiers are usable, unique, and in the unreserved set", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = pkce.newCodeVerifier();
    if (v.length < 43 || v.length > 128) throw new Error(`verifier length ${v.length} is outside RFC range`);
    if (!/^[A-Za-z0-9\-._~]+$/.test(v)) throw new Error(`verifier has characters the RFC forbids: ${v}`);
    if (seen.has(v)) throw new Error("verifier repeated — randomness broken");
    seen.add(v);
  }
});

/* ── 2 · the flow itself, against a PKCE-enforcing IdP ──── */

const state = {
  challenge: null,
  verifierSeen: null,
  tokenCalls: 0,
  emails: [],
  userId: 9001,
  profileEmail: "victim@buildwe.test", // profile email that is NOT verified
  login: null,
};

const idp = http.createServer((req2, res) => {
  const url = new URL(req2.url, "http://x");
  if (url.pathname === "/login/oauth/access_token") {
    state.tokenCalls++;
    let raw = "";
    req2.on("data", (c) => (raw += c));
    req2.on("end", () => {
      const body = JSON.parse(raw || "{}");
      state.verifierSeen = body.code_verifier || null;
      const ok = body.code === "test-code" && body.code_verifier &&
        challengeOf(String(body.code_verifier)) === state.challenge;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        ok
          ? JSON.stringify({ access_token: "ghu_test_token" })
          : JSON.stringify({ error: "invalid_grant", error_description: "PKCE verification failed" })
      );
    });
    return;
  }
  if (url.pathname === "/user") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: state.userId, login: "octo-cat", name: "Octo Cat", email: state.profileEmail }));
    return;
  }
  if (url.pathname === "/user/emails") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state.emails));
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => idp.listen(IDP_PORT, "127.0.0.1", r));

const srv = await startServer({
  port: PORT,
  label: "auth-hardening",
  env: {
    GITHUB_CLIENT_ID: "Iv.testclient",
    GITHUB_CLIENT_SECRET: "s3cr3t-not-real",
    GITHUB_AUTH_URL: `http://127.0.0.1:${IDP_PORT}/login/oauth/authorize`,
    GITHUB_TOKEN_URL: `http://127.0.0.1:${IDP_PORT}/login/oauth/access_token`,
    GITHUB_API_URL: `http://127.0.0.1:${IDP_PORT}`,
    SIGNUPS_PER_IP_PER_HOUR: "1000",
    SIGNUPS_PER_EMAIL_PER_DAY: "1000",
    SIGNUPS_GLOBAL_PER_DAY: "1000",
    TRUST_PROXY_HOPS: "1",
  },
});
const BASE = srv.base;

const victim = newJar();
await run("a password account exists to be attacked", async () => {
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar: victim,
    body: { email: "victim@buildwe.test", password: "correct-horse-battery", name: "Victim" },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register: ${r.status} ${r.text}`);
});

/** Drive /authorize and return the cookies + the challenge that was sent. */
async function authorize() {
  const res = await fetch(`${BASE}/api/auth/oauth/github`, { redirect: "manual" });
  if (res.status !== 302 && res.status !== 307) throw new Error(`authorize returned ${res.status}`);
  const loc = new URL(res.headers.get("location"));
  const cookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  const pick = (n) => cookies.find((c) => c.startsWith(`${n}=`))?.split("=")[1];
  return {
    location: loc,
    state: pick("bw_oauth_state"),
    verifier: pick("bw_oauth_pkce"),
    raw: cookies.join("; "),
    setCookieHeaders: res.headers.getSetCookie?.() || [],
  };
}

let auth = null;
await run("/authorize sends a real S256 challenge and keeps the verifier server-side", async () => {
  auth = await authorize();
  const q = auth.location.searchParams;
  if (q.get("code_challenge_method") !== "S256") {
    throw new Error(`challenge method was ${q.get("code_challenge_method")}`);
  }
  const challenge = q.get("code_challenge");
  if (!challenge) throw new Error("no code_challenge on the authorize URL at all");
  if (challenge === auth.verifier) throw new Error("the verifier was sent as its own challenge");
  if (challengeOf(auth.verifier) !== challenge) throw new Error("challenge is not S256(verifier)");
  if (auth.location.origin !== `http://127.0.0.1:${IDP_PORT}`) {
    throw new Error("the authorize URL did not honour GITHUB_AUTH_URL");
  }
  for (const line of auth.setCookieHeaders) {
    if (/^bw_oauth_(state|pkce)=/.test(line)) {
      if (!/httponly/i.test(line)) throw new Error(`${line.slice(0, 24)} is not HttpOnly`);
      if (!/samesite=lax/i.test(line)) throw new Error(`${line.slice(0, 24)} has no SameSite`);
    }
  }
  state.challenge = challenge;
});

async function callback({ stateValue, verifierValue }) {
  const pairs = [];
  if (stateValue) pairs.push(`bw_oauth_state=${stateValue}`);
  if (verifierValue) pairs.push(`bw_oauth_pkce=${verifierValue}`);
  const res = await fetch(`${BASE}/api/auth/oauth/github/callback?code=test-code&state=${stateValue || ""}`, {
    redirect: "manual",
    headers: pairs.length ? { cookie: pairs.join("; ") } : {},
  });
  const loc = res.headers.get("location") || "";
  const setCookies = res.headers.getSetCookie?.() || [];
  const sessionCookie = setCookies.find((c) => /^bw_session=..+/.test(c));
  return { status: res.status, loc, sessionSet: Boolean(sessionCookie), sessionCookie };
}

await run("callback redeems the code with the stored verifier and signs the user in", async () => {
  state.emails = [{ email: "octo@buildwe.test", primary: true, verified: true }];
  const before = state.tokenCalls;
  const r = await callback({ stateValue: auth.state, verifierValue: auth.verifier });
  if (!r.loc.includes("welcome=1")) throw new Error(`unexpected redirect: ${r.status} ${r.loc}`);
  if (state.tokenCalls <= before) throw new Error("no token exchange happened");
  if (state.verifierSeen !== auth.verifier) throw new Error("the verifier sent upstream isn't the one issued");
  if (!r.sessionSet) throw new Error("no session cookie on a completed OAuth login");
});

await run("a verifier from a different flow logs nobody in", async () => {
  // The positive proof that we SEND the verifier lives in the previous test
  // (`verifierSeen === auth.verifier` plus a successful exchange), so what this
  // one pins down is the outcome: a verifier that doesn't match the challenge
  // must never yield a session, whichever layer catches it.
  for (const bogus of ["dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXkZz", "y".repeat(64)]) {
    const r = await callback({ stateValue: auth.state, verifierValue: bogus });
    if (!r.loc.includes("oauth=failed")) throw new Error(`a bad verifier was accepted: ${r.loc}`);
    if (r.sessionSet) throw new Error("a session was issued despite PKCE failure");
  }
});

await run("a callback with no verifier cookie never reaches the token endpoint", async () => {
  const before = state.tokenCalls;
  const r = await callback({ stateValue: auth.state, verifierValue: null });
  if (state.tokenCalls !== before) throw new Error("code exchange attempted without a verifier");
  if (!r.loc.includes("oauth=failed")) throw new Error(`expected refusal, got ${r.loc}`);
});

await run("state mismatch is refused before any network call", async () => {
  const before = state.tokenCalls;
  const res = await fetch(
    `${BASE}/api/auth/oauth/github/callback?code=test-code&state=${"deadbeef".repeat(4)}`,
    { redirect: "manual", headers: { cookie: `bw_oauth_state=${auth.state}; bw_oauth_pkce=${auth.verifier}` } }
  );
  const r = {
    status: res.status,
    loc: res.headers.get("location") || "",
    sessionSet: (res.headers.getSetCookie?.() || []).some((c) => /^bw_session=..+/.test(c)),
  };
  if (state.tokenCalls !== before) throw new Error("state is checked after the token exchange, not before");
  if (!r.loc.includes("oauth=failed")) throw new Error(`expected refusal, got ${r.loc}`);
});

await run("an UNVERIFIED profile email cannot hijack an existing account", async () => {
  // GitHub's /user email is not proof of control. If linking trusted it, this
  // OAuth identity would return the victim's user id.
  state.profileEmail = "victim@buildwe.test";
  state.emails = [{ email: "victim@buildwe.test", primary: true, verified: false }];
  state.userId = 9002; // a fresh IdP identity, so account reuse can't mask the result
  auth = await authorize();
  state.challenge = auth.location.searchParams.get("code_challenge");
  const r = await callback({ stateValue: auth.state, verifierValue: auth.verifier });
  if (!r.loc.includes("welcome=1")) throw new Error(`login unexpectedly failed: ${r.loc}`);
  if (!r.sessionCookie) throw new Error("no session to inspect — the flow did not complete");
  const oauthMe = await req(BASE, "/api/auth/me", {
    headers: { cookie: r.sessionCookie.split(";")[0] },
  });
  if (oauthMe.json?.kind !== "user") throw new Error(`session didn't resolve to an account: ${oauthMe.text}`);
  const email = String(oauthMe.json?.user?.email || oauthMe.json?.email || "");
  if (email === "victim@buildwe.test") {
    throw new Error("OAuth linked the identity to the victim's password account via an unverified email");
  }
  if (!/github_9001@users\.|buildwe\.online/.test(email) && !email.endsWith("users.buildwe.online")) {
    throw new Error(`expected a synthetic unverified-email account, got ${email}`);
  }
  const victimMe = await req(BASE, "/api/auth/me", { jar: victim });
  if (victimMe.json?.kind !== "user") throw new Error("victim's own session broke — collateral damage");
  const dbUser = victimMe.json || {};
  if (dbUser?.user?.provider === "github" || dbUser?.provider === "github") {
    throw new Error("the victim's password account got linked to an unverified GitHub email");
  }
});

await run("a sign-in never reads the IdP profile out of Next's data cache", async () => {
  // Found the hard way: the OAuth profile fetch was cacheable, so the second
  // sign-in of the run received the FIRST identity. A cached profile means the
  // wrong account, or an account linked to an email that changed since.
  state.userId = 9003;
  state.emails = [{ email: "fresh-identity@buildwe.test", primary: true, verified: true }];
  const a = await authorize();
  state.challenge = a.location.searchParams.get("code_challenge");
  const r = await callback({ stateValue: a.state, verifierValue: a.verifier });
  if (!r.loc.includes("welcome=1")) throw new Error(`login failed: ${r.loc}`);
  const me = await req(BASE, "/api/auth/me", {
    headers: { cookie: (r.sessionCookie || "").split(";")[0] },
  });
  const email = String(me.json?.user?.email || "");
  if (email !== "fresh-identity@buildwe.test") {
    throw new Error(`stale identity served — got ${email} (a cached /user response)`);
  }
});

/* ── 3 · BYOK key shapes ─────────────────────────────────── */

await run("a 20-character string is no longer a valid 'API key'", async () => {
  const r = await req(BASE, "/api/user/keys", {
    method: "POST",
    jar: victim,
    body: { groq: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  });
  if (r.status !== 422) throw new Error(`junk key accepted (status ${r.status})`);
  if (r.json?.code !== "KEY_FORMAT") throw new Error(`unexpected code ${r.json?.code}`);
  const after = await req(BASE, "/api/user/keys", { jar: victim });
  if (after.json?.keys?.groq) throw new Error("the junk key was stored anyway");
  if (after.json?.active) throw new Error("junk key marked the account as having BYOK");
});

await run("a well-formed key is stored, masked, and never echoed back", async () => {
  const secret = `gsk_${"Z9k2".repeat(12)}`;
  const r = await req(BASE, "/api/user/keys", { method: "POST", jar: victim, body: { groq: secret } });
  if (r.status !== 200) throw new Error(`valid key rejected: ${r.status} ${r.text}`);
  if (r.text.includes(secret)) throw new Error("the saved response returned the plaintext key");
  const view = await req(BASE, "/api/user/keys", { jar: victim });
  const shown = view.json?.keys?.groq || "";
  if (!shown || shown.includes(secret.slice(8))) throw new Error(`key is not masked: ${shown}`);
  if (!view.json?.active) throw new Error("a stored key didn't mark the account active");
  const cleared = await req(BASE, "/api/user/keys", { method: "POST", jar: victim, body: { clear: "groq" } });
  if (cleared.json?.active) throw new Error("clear didn't remove the key");
});

/* ── teardown ────────────────────────────────────────────── */

const failures = report("Auth hardening · PKCE + BYOK shapes");
await srv.stop();
idp.close();
try {
  rmSync(tmpOut, { recursive: true, force: true });
} catch {
  /* */
}
process.exit(failures ? 1 : 0);
