/**
 * Which links in a message deserve a card, and what we ask the server for.
 *
 * Pure string work on purpose: the client needs it to decide what to render, the
 * test suite needs it to prove the rules, and neither should have to reach a
 * network to find out. The *security* decision is not here — `lib/net/ssrf.ts`
 * owns that, server-side, and re-decides it for every URL that arrives.
 */

/** Card count per message: enough to be useful, small enough to stay out of the way. */
export const MAX_PREVIEW_CARDS = 3;

/** Hostnames a browser should not even bother asking about. Defence in depth, not the guard. */
const SKIP_HOST = /(^|\.)(localhost|localdomain|local|internal|intranet|metadata|instance-data)$/i;

/**
 * Hosts the *client* should not even offer for previewing. The server re-decides this
 * for real in `lib/net/ssrf.ts` — that list is not a security control and cannot be,
 * since it runs in the reader's browser on a name, before DNS. What it buys is the
 * experience: no request, no spinner, no card for a link that was never a website.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (SKIP_HOST.test(h)) return true;
  if (h === "::1" || h === "0.0.0.0" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false; // a public literal is fine to offer
  return !h.includes("."); // single-label names are never public websites
}

/**
 * One canonical spelling of a URL. Lowercases host, drops the fragment, drops a default
 * port and `index.html`, and sorts query parameters so `?b=2&a=1` and `?a=1&b=2`
 * are the same preview. `http` is kept as `http` — we do not silently rewrite the
 * scheme and then cache the wrong answer.
 */
export function normalizePreviewUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  // Only shape is checked here. This is a normaliser: whether an *address* may be
  // touched is decided by lib/net/ssrf.ts, and the client's skip-list is applied in
  // extractPreviewUrls, where it saves a request instead of pretending to be a guard.
  if (!host) return null;
  u.hash = "";
  u.hostname = host;
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  if (u.pathname === "/index.html") u.pathname = "/";
  // The query is sorted as raw, still-encoded `k=v` tokens: `URLSearchParams` hands
  // back decoded values, and putting those back into a URL is how `%2F` turns into
  // `/` and `%26` into a separator. Sorting the encoded tokens keeps the URL we ask
  // for byte-identical to the one the reader wrote, while still letting two
  // orderings of the same query share one cache row.
  // (target is ES5 in this repo, hence no spread of `searchParams` either.)
  const rawQuery = u.search.replace(/^\?/, "");
  const tokens = rawQuery ? rawQuery.split("&").filter((t) => t.length > 0) : [];
  tokens.sort((a, b) => {
    const ka = a.slice(0, a.indexOf("=") < 0 ? a.length : a.indexOf("="));
    const kb = b.slice(0, b.indexOf("=") < 0 ? b.length : b.indexOf("="));
    return ka === kb ? a.localeCompare(b) : ka.localeCompare(kb);
  });
  u.search = tokens.length ? "?" + tokens.join("&") : "";
  return u.toString();
}

/**
 * Pull the candidate links out of markdown, in reading order, de-duplicated.
 *
 * Code fences and inline code are dropped first: a snippet that happens to contain
 * a URL is not a link the reader meant to visit, and a card there would be noise
 * that also teaches people to distrust the cards.
 */
export function extractPreviewUrls(
  text: string,
  limit = MAX_PREVIEW_CARDS,
  exclude?: string[]
): string[] {
  const src = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  const found: string[] = [];
  // [label](url) and <url> and bare urls, in the order they appear.
  const re = /\[[^\]]*\]\(\s*(<?[^\s)>]+>?)\s*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>"')\]]+)/gi;
  // exec loop rather than matchAll: this repo compiles to ES5, where iterating a
  // RegExpStringIterator needs --downlevelIteration. The pattern cannot match an
  // empty string, so lastIndex always advances and this cannot spin.
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const candidate = (m[1] || m[2] || m[3] || "").replace(/^<|>$/g, "");
    if (candidate) found.push(candidate);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  // Links the message already shows as Sources chips are excluded: the chip is the
  // link, and repeating it as a card is both a duplicate and a wasted fetch.
  const skip: Record<string, true> = {};
  if (exclude) {
    for (let ei = 0; ei < exclude.length; ei++) {
      const k = normalizePreviewUrl(exclude[ei]);
      if (k) skip[k] = true;
    }
  }
  const out: string[] = [];
  const seen: Record<string, true> = {};
  for (let fi = 0; fi < found.length; fi++) {
    const c = found[fi];
    const cleaned = c.replace(/[.,;:!?)\]}'"»„”]+$/g, "");
    const norm = normalizePreviewUrl(cleaned);
    if (!norm || seen[norm]) continue;
    // Not a website the reader could mean, so don't ask. The server refuses it too.
    let checkHost = "";
    try {
      checkHost = new URL(norm).hostname;
    } catch {
      checkHost = "";
    }
    if (checkHost && isPrivateHost(checkHost)) continue;
    if (skip[norm]) continue;
    seen[norm] = true;
    out.push(norm);
    // Overshoot by however many we skipped, so exclusion cannot leave a message with
    // two cards where it had room for three.
    if (out.length >= limit + Object.keys(skip).length) break;
  }
  return out.slice(0, limit);
}

/** Where a preview came from, for the card's own wording and for tests. */
export type PreviewSource = "cache" | "live";

export type PreviewDto = {
  url: string;
  host: string;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  /** Present when the origin refused us; the card disappears rather than lying. */
  code?: string;
  error?: string;
};
