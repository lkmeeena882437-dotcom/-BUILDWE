/**
 * The one place that reads a page someone else pointed us at.
 *
 * `lib/net/ssrf.ts` decides *whether* an address may be touched; this file decides
 * *how*. Every knob here exists because the alternative was worse:
 *
 * - `redirect: "manual"` and a re-check per hop, because `follow` would let the
 *   origin pick the URL that actually gets fetched.
 * - a hard timeout, because a slow host must not pin a request.
 * - a byte cap enforced *while streaming*, because `Content-Length` is a promise,
 *   not a fact — a server can claim 200 bytes and send 200 MB.
 * - `text/html` only, because a preview of a 40 MB PDF or a `.zip` is a download
 *   with extra steps, and a `text/plain` page has no metadata to show anyway.
 * - no `Authorization` and no cookies, ever: this request is made on behalf of the
 *   person who clicked, not on behalf of the deployment.
 * - one `Accept-Language`, stated plainly, rather than leaking the reader's.
 */

import { assertSafeUrl, UnsafeUrlError, type GuardOptions } from "./ssrf";
import { parseHtmlMeta, type HtmlMeta } from "./htmlMeta";

export const PREVIEW_TIMEOUT_MS = 8000;
export const PREVIEW_MAX_BYTES = 256 * 1024;
export const PREVIEW_MAX_HOPS = 5;

export type PreviewFailureCode =
  | "BAD_URL"
  | "BAD_SCHEME"
  | "BAD_PORT"
  | "NO_HOST"
  | "UNRESOLVED"
  | "PRIVATE_TARGET"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "TOO_LARGE"
  | "NOT_HTML"
  | "HTTP_STATUS"
  | "TOO_MANY_REDIRECTS"
  | "NO_METADATA";

export type PreviewOk = {
  ok: true;
  url: string;
  host: string;
  status: number;
  meta: HtmlMeta;
};
export type PreviewFail = { ok: false; code: PreviewFailureCode; message: string };
export type PreviewResult = PreviewOk | PreviewFail;

export type PreviewOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxHops?: number;
  /** Test-only pass-through to the guard (see the note at the top of ssrf.ts). */
  guard?: GuardOptions;
  fetchImpl?: typeof fetch;
};

/** Honest about who is calling. Sites that block previews are told so, not tricked. */
const PREVIEW_UA = "Mozilla/5.0 (compatible; BUILDWEPreview/1.0; link preview)";

function fail(code: PreviewFailureCode, message: string): PreviewFail {
  return { ok: false, code, message };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Read a link preview. Never throws: a page that refuses us, times out, or is
 * internal is a coded answer, and the caller decides what a person sees.
 */
export async function readLinkPreview(raw: string, opts: PreviewOptions = {}): Promise<PreviewResult> {
  const timeoutMs = opts.timeoutMs ?? PREVIEW_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? PREVIEW_MAX_BYTES;
  const maxHops = opts.maxHops ?? PREVIEW_MAX_HOPS;
  const doFetch = opts.fetchImpl || fetch;
  let current = String(raw || "").trim();
  let hops = 0;

  for (;;) {
    let safe: { url: URL; host: string };
    try {
      safe = await assertSafeUrl(current, opts.guard);
    } catch (e) {
      if (e instanceof UnsafeUrlError) return fail(e.code, e.message);
      return fail("BAD_URL", "That URL could not be checked safely.");
    }

    let res: Response;
    try {
      res = await doFetch(safe.url.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "en",
          "User-Agent": PREVIEW_UA,
        },
      });
    } catch (e) {
      const name = e && typeof e === "object" ? String((e as { name?: string }).name || "") : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return fail("TIMEOUT", `The site did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      return fail("UNREACHABLE", "That site could not be reached from this server.");
    }

    if (isRedirect(res.status)) {
      try {
        await res.body?.cancel();
      } catch {
        /* the body is already gone; the redirect decision stands */
      }
      const location = res.headers.get("location") || "";
      if (!location) return fail("UNREACHABLE", "That site sent a redirect with nowhere to go.");
      if (hops >= maxHops) return fail("TOO_MANY_REDIRECTS", "That link redirects too many times to preview.");
      hops++;
      try {
        current = new URL(location, safe.url).toString();
      } catch {
        return fail("BAD_URL", "That site redirected to something unreadable.");
      }
      continue;
    }

    const status = res.status;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const declared = Number(res.headers.get("content-length") || "0");
    if (Number.isFinite(declared) && declared > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        /* nothing to release */
      }
      return fail("TOO_LARGE", "That page is bigger than a preview needs.");
    }
    if (status >= 400) {
      try {
        await res.body?.cancel();
      } catch {
        /* nothing to release */
      }
      return fail("HTTP_STATUS", `That site answered ${status}.`);
    }
    if (type && !type.includes("text/html") && !type.includes("xhtml")) {
      try {
        await res.body?.cancel();
      } catch {
        /* nothing to release */
      }
      return fail("NOT_HTML", "That link is not a web page, so there is nothing to preview.");
    }

    let bytes: Uint8Array;
    try {
      bytes = await readCapped(res, maxBytes);
    } catch (e) {
      if (e instanceof RangeError) return fail("TOO_LARGE", "That page is bigger than a preview needs.");
      const name = e && typeof e === "object" ? String((e as { name?: string }).name || "") : "";
      if (name === "TimeoutError" || name === "AbortError") return fail("TIMEOUT", "The site stopped answering mid-page.");
      try {
        await res.body?.cancel();
      } catch {
        /* already closed */
      }
      return fail("UNREACHABLE", "The page could not be read.");
    }

    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const meta = parseHtmlMeta(html, safe.url.toString());
    // A cross-host `og:image` would make the reader's browser request a third party
    // on the link author's say-so. Same host, or no picture.
    if (meta.imageUrl) {
      let imageHost = "";
      try {
        imageHost = new URL(meta.imageUrl).hostname.toLowerCase();
      } catch {
        imageHost = "";
      }
      if (imageHost !== safe.host.toLowerCase()) delete meta.imageUrl;
    }
    if (!meta.foundAny) return fail("NO_METADATA", "That page does not describe itself, so there is nothing to preview.");
    return { ok: true, url: safe.url.toString(), host: safe.host, status, meta };
  }
}

/** Read the body, refusing the moment it exceeds the cap — `Content-Length` is not trusted. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new RangeError("too large");
    return new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* the socket is closing anyway */
      }
      throw new RangeError("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return out;
}
