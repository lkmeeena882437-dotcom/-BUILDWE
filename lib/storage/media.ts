/**
 * BUILDWE media storage — persist generated audio and images we own.
 *
 * WHY
 * ---
 * Generated audio was returned as a base64 data URL and never stored, so it
 * vanished on refresh: the history row existed but the sound was gone.
 * Generated images were hot-linked from a third party, so we did not own the
 * artifact and the link could rot at any time.
 *
 * This module uploads bytes to a Supabase Storage bucket and returns a stable
 * public URL. When Supabase is not configured it returns null and every
 * caller keeps its previous behaviour, so nothing regresses on a deployment
 * that has not set it up yet.
 */

const BUCKET = "buildwe-media";

function cfg() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key, ok: Boolean(url && key) };
}

export function mediaStorageEnabled(): boolean {
  return cfg().ok;
}

/** Size ceiling per object — generous for audio/images, cheap to enforce. */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Upload raw bytes and return a public URL, or null if storage is unavailable.
 * Failures are non-fatal by design: the caller falls back to whatever it did
 * before, so a storage outage degrades persistence rather than breaking
 * generation.
 */
export async function putMedia(opts: {
  /** path inside the bucket, e.g. "audio/<userId>/<id>.mp3" */
  path: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<string | null> {
  const { url, key, ok } = cfg();
  if (!ok) return null;

  const body = Buffer.isBuffer(opts.bytes) ? opts.bytes : Buffer.from(opts.bytes);
  if (!body.length || body.length > MAX_BYTES) return null;

  // Keep the object key predictable and traversal-free.
  const safePath = opts.path
    .replace(/\.\./g, "")
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9/_.-]/g, "_")
    .slice(0, 200);

  try {
    const res = await fetch(
      `${url}/storage/v1/object/${BUCKET}/${safePath}`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": opts.contentType,
          "x-upsert": "true",
        },
        body: body as unknown as BodyInit,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) {
      console.error("[bw] media upload", res.status, safePath);
      return null;
    }
    return `${url}/storage/v1/object/public/${BUCKET}/${safePath}`;
  } catch (e) {
    console.error("[bw] media upload error", (e as Error)?.message);
    return null;
  }
}

/** Convenience: persist a data URL, returning a hosted URL or the original. */
export async function persistDataUrl(
  dataUrl: string,
  path: string
): Promise<string> {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return dataUrl;

  const hosted = await putMedia({
    path,
    bytes: Buffer.from(m[2], "base64"),
    contentType: m[1],
  });
  // Falling back to the data URL keeps audio working with no storage set up.
  return hosted || dataUrl;
}

/**
 * Mirror a remote image we did not generate ourselves onto our own storage,
 * so history entries keep working if the upstream link rots.
 */
export async function mirrorRemoteImage(
  remoteUrl: string,
  path: string
): Promise<string> {
  if (!mediaStorageEnabled()) return remoteUrl;
  try {
    const res = await fetch(remoteUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return remoteUrl;

    const type = res.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return remoteUrl;

    const bytes = Buffer.from(await res.arrayBuffer());
    const hosted = await putMedia({ path, bytes, contentType: type });
    return hosted || remoteUrl;
  } catch {
    return remoteUrl;
  }
}
