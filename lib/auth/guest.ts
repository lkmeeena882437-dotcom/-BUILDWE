/**
 * BUILDWE — signed guest identities.
 *
 * WHY (audit V1, CRITICAL): the guest id used to travel as a plaintext cookie
 * (`bw_guest=guest_abc123`). Anyone could set that header by hand and read
 * another guest's conversations, projects and generations:
 *
 *   curl /api/history -H "Cookie: bw_guest=guest_1a837a62df4d"  → 200, full history
 *
 * Guest mode is the default entry point, so this was the widest data-leak path
 * in the product. Guest ids are now HMAC-signed with the server secret, exactly
 * like logged-in JWT sessions — a forged id fails signature verification and is
 * dropped.
 *
 * Format: `<guestId>.<base64url hmac>`  e.g. `guest_ab12cd34.Xr9…`
 *
 * Legacy note: unsigned cookies are rejected by default (the user simply gets a
 * fresh guest identity). Set BUILDWE_ALLOW_LEGACY_GUEST=true only if you need a
 * temporary migration window — it re-opens the forgery hole.
 */
import crypto from "crypto";
import { installSecret } from "@/lib/crypto";

const LEGACY_OK = process.env.BUILDWE_ALLOW_LEGACY_GUEST === "true";

let warned = false;

/**
 * Guest ids are HMAC-signed so one visitor cannot claim another's id and read their
 * history. The fallback here used to be a literal string — in a public repository that
 * is a skeleton key, because anyone who reads the source can sign any guest id. Now:
 * the deployment's own secret if it has one (the normal case), otherwise a key generated
 * per instance. Off-production that key is persisted beside the JSON store so dev guests
 * survive restarts; in production it is not, so a cold start hands a visitor a fresh
 * anonymous id rather than the deploy failing.
 */
function secret(): string {
  const configured =
    process.env.SESSION_SECRET || process.env.BYOK_ENCRYPTION_SECRET;
  if (configured) return configured;
  // Throwing here used to be the plan, on the grounds that a published fallback key is
  // worse than an outage — but a guest id signs nothing that matters: it cannot open an
  // account, and lib/auth/session.ts still refuses to mint real sessions without a
  // secret. So an unconfigured deployment says so once, loudly, and keeps serving
  // guests. "You forgot one env var" should not be a 500 for every logged-out visitor.
  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      warned = true;
      console.error(
        "[bw] SESSION_SECRET is unset — guest identities are signed with a per-instance key, so visitors lose their history on cold starts. Set SESSION_SECRET in the deploy environment."
      );
    }
    return crypto.randomBytes(32).toString("hex");
  }
  return installSecret("guest-signing");
}


function sign(id: string): string {
  return crypto.createHmac("sha256", secret()).update(`guest:${id}`).digest("base64url");
}

/** Fresh, unguessable guest id (96 bits of entropy). */
export function newGuestId(): string {
  return `guest_${crypto.randomBytes(12).toString("hex")}`;
}

/** guestId → cookie value (`id.signature`) */
export function signGuestId(id: string): string {
  return `${id}.${sign(id)}`;
}

/**
 * Cookie value → verified guest id, or null when missing/forged.
 * Timing-safe comparison so the signature can't be brute-forced byte by byte.
 */
export function verifyGuestCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) {
    // No signature present — legacy plaintext cookie.
    return LEGACY_OK && /^guest_[a-zA-Z0-9_-]{6,64}$/.test(raw) ? raw : null;
  }

  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^guest_[a-zA-Z0-9_-]{6,64}$/.test(id)) return null;

  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return id;
}
