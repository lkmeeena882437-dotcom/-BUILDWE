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
import fs from "fs";
import os from "os";
import path from "path";

const LEGACY_OK = process.env.BUILDWE_ALLOW_LEGACY_GUEST === "true";

/**
 * Guest ids are HMAC-signed so one visitor cannot claim another's id and read their
 * history. The fallback used to be a literal string in this file — and this file is in a
 * PUBLIC repository, so the literal is a skeleton key: anyone who reads the source can
 * sign any guest id they like. Production now refuses to sign at all without a real
 * secret, the same rule `lib/auth/session.ts` already applies to sessions. Off
 * production the key is random per process: a dev guest survives every reload, and a
 * server restart simply gives them a fresh id, which is the right trade for a box that
 * has no secret configured.
 */
/**
 * Off-production fallback: a random key, persisted beside the JSON store so a dev guest
 * survives a server restart (their wallet and history are keyed by this id) without the
 * key ever being a string printed in a public repository. If the file cannot be written —
 * a read-only filesystem, a serverless box — the key is simply per-process and a restart
 * hands visitors a fresh guest id, which is the correct trade when nothing is configured.
 */
function devSecret(): string {
  try {
    const dir = process.env.BUILDWE_DATA_DIR || path.join(os.tmpdir(), "buildwe-data");
    const file = path.join(dir, "guest-signing.key");
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, "utf8").trim();
      if (/^[0-9a-f]{64}$/.test(saved)) return saved;
    }
    const fresh = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, fresh, { mode: 0o600 });
    return fresh;
  } catch {
    return crypto.randomBytes(32).toString("hex");
  }
}

function secret(): string {
  const configured =
    process.env.SESSION_SECRET || process.env.BYOK_ENCRYPTION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. Refusing to sign guest ids with a published development key."
    );
  }
  return devSecret();
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
