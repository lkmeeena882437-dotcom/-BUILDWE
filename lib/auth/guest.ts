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

const LEGACY_OK = process.env.BUILDWE_ALLOW_LEGACY_GUEST === "true";

function secret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.BYOK_ENCRYPTION_SECRET ||
    "buildwe-dev-secret-change-me-in-production-32b"
  );
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
