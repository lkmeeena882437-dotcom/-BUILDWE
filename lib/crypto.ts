/**
 * AES-256-GCM secret box for user-provided API keys (BYOK).
 * Stored as: v1:<iv>:<tag>:<data> (all hex). Never returned to the client.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * A per-installation secret, for deployments that have no configured one.
 *
 * Every "secure" fallback used to be a literal printed in this file — and this repo is
 * public, so a literal is not a fallback, it is the key published next to the ciphertext.
 * A generated key that is persisted beside the JSON store keeps the only property that
 * made the literal convenient (it survives a restart, so dev BYOK keys still decrypt and
 * a guest keeps their history) without the property that made it dangerous. If the
 * filesystem is read-only, the caller gets an ephemeral key for this process instead.
 */
export function installSecret(name: string): string {
  const fresh = () => crypto.randomBytes(32).toString("hex");
  if (!/^[a-z0-9-]{3,40}$/.test(name)) throw new Error("bad secret name");
  try {
    const dir = process.env.BUILDWE_DATA_DIR || path.join(os.tmpdir(), "buildwe-data");
    const file = path.join(dir, `${name}.key`);
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, "utf8").trim();
      if (/^[0-9a-f]{64}$/.test(saved)) return saved;
    }
    const created = fresh();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, created, { mode: 0o600 });
    return created;
  } catch {
    return fresh();
  }
}

function keyMaterial(): Buffer {
  const configured =
    process.env.BYOK_ENCRYPTION_SECRET || process.env.SESSION_SECRET;
  // A known key would make every stored BYOK key decryptable by anyone holding
  // the database — refuse rather than pretend the encryption is real.
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error(
      "BYOK_ENCRYPTION_SECRET is not set. Refusing to encrypt user keys with a development key."
    );
  }
  // derive a stable 32-byte key from whatever-length secret
  return crypto
    .createHash("sha256")
    .update(configured || installSecret("byok-encryption"))
    .digest();
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

/**
 * Constant-time string equality. `a !== b` on a signature leaks how many leading
 * characters were right through its timing, and an email-verification token is exactly
 * the kind of thing someone is willing to spend a request budget on.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
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
  // Same rule as the session and BYOK keys: an unconfigured box gets a per-install
  // secret, never a string a reader of this repository can use to mint a verification
  // token for any address. Production refuses rather than signing with anything shared.
  const secret = configured || installSecret("verification-tokens");
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
  if (!payload || !sig || !safeEqual(hmac(payload), sig)) return null;
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
