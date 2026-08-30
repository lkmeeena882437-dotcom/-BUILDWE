/**
 * AES-256-GCM secret box for user-provided API keys (BYOK).
 * Stored as: v1:<iv>:<tag>:<data> (all hex). Never returned to the client.
 */
import crypto from "crypto";

function keyMaterial(): Buffer {
  const configured =
    process.env.BYOK_ENCRYPTION_SECRET || process.env.SESSION_SECRET;
  // A known key would make every stored BYOK key decryptable by anyone with
  // the database — refuse rather than pretend the encryption is real.
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error(
      "BYOK_ENCRYPTION_SECRET is not set. Refusing to encrypt user keys with the public development key."
    );
  }
  const secret =
    configured || "buildwe-dev-byok-secret-change-me-in-production-32b";
  // derive a stable 32-byte key from whatever-length secret
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${data.toString("hex")}`;
}

export function decryptSecret(boxed: string): string {
  try {
    const [v, ivHex, tagHex, dataHex] = boxed.split(":");
    if (v !== "v1" || !ivHex || !tagHex || !dataHex) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyMaterial(),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return "";
  }
}

/** gsk_abcd…wxyz → gsk_a…wxyz (display only) */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 10) return plain.slice(0, 2) + "…";
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`;
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function newApiKey(): string {
  return `bw_sk_${crypto.randomBytes(20).toString("hex")}`;
}

/* ── Stateless email-verification tokens ─────────────────── */

function hmac(s: string): string {
  const configured = process.env.SESSION_SECRET;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. Refusing to sign verification tokens with the public development key."
    );
  }
  const secret = configured || "buildwe-dev-secret-change-me-in-production-32b";
  return crypto.createHmac("sha256", secret).update(s).digest("base64url");
}

export function signVerifyToken(userId: string, email: string, minutes = 48 * 60) {
  const exp = Date.now() + minutes * 60_000;
  const payload = Buffer.from(`${userId}|${email}|${exp}`).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function verifyVerifyToken(
  token: string
): { userId: string; email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || hmac(payload) !== sig) return null;
  try {
    const [userId, email, exp] = Buffer.from(payload, "base64url")
      .toString("utf8")
      .split("|");
    if (!userId || !email || Number(exp) < Date.now()) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
