/**
 * The part of a fetched page we are allowed to look at, and nothing else.
 *
 * A preview card shows what a page says about itself: `<title>`, `og:*`,
 * `twitter:*`, and the description meta. This file does that with regexes over the
 * `<head>` only — no DOM, no parser dependency, and no script execution. Two rules
 * matter more than the rest:
 *
 * 1. **We only ever take `<head>` metadata.** The body of the page is read into a
 *    string, scanned, thrown away. Nothing here produces HTML we would insert
 *    anywhere; the card renders text through React, so an `og:title` full of markup
 *    is a long, silly headline and nothing more.
 * 2. **The image URL is only kept if it is http(s).** `og:image` is attacker-chosen,
 *    and `javascript:` or `file:` in an `<img src>` is exactly the bug this feature
 *    must not have. `lib/net/preview.ts` additionally drops a cross-host image, so
 *    a preview never turns the reader's browser into a probe of a third site.
 */

export type HtmlMeta = {
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  /** Canonical URL if the page declared one — used for display, never for fetching. */
  canonical?: string;
  foundAny: boolean;
};

/** Head scanning stops here. A page that hides its metadata past 64 KB is not worth the read. */
export const HTML_SCAN_LIMIT = 64 * 1024;

/** Card text limits, so a 4 000-character `og:description` cannot stretch a bubble. */
export const TITLE_LIMIT = 180;
export const DESCRIPTION_LIMIT = 320;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

export function decodeEntities(input: string): string {
  let s = String(input || "");
  s = s.replace(/&#x([0-9a-fA-F]{1,6});/g, (_all, hex) => {
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
  s = s.replace(/&#(\d{1,7});/g, (_all, dec) => {
    const code = parseInt(dec, 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]{1,10});/g, (all, name) => {
    const v = NAMED_ENTITIES[String(name).toLowerCase()];
    return v === undefined ? all : v;
  });
  return s;
}

/** Collapse the whitespace a pretty-printed head is made of, then cap the length. */
function tidy(input: string, limit: number): string {
  // Tags are removed before entities are decoded, in that order on purpose: decode
  // first and a title written as `&lt;b&gt;hi&lt;/b&gt;` becomes markup to strip, so the
  // text a person chose to show us would be eaten. There is nothing to be unsafe
  // about either way — the card renders this through React, not as HTML — but the
  // order is what keeps the *words* intact.
  const one = decodeEntities(
    String(input || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\t\n\r\f\v\u00a0]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim()
  )
    .replace(/[\t\n\r\f\v\u00a0]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  if (one.length <= limit) return one;
  return one.slice(0, limit - 1).trim() + "\u2026";
}

/** Read `name="value"` / `name='value'` / bare attributes out of one tag string. */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "";
    if (!(key in out)) out[key] = val;
  }
  return out;
}

function absolutize(candidate: string, baseUrl?: string): string | undefined {
  const raw = String(candidate || "").trim();
  if (!raw) return undefined;
  if (baseUrl) {
    try {
      const u = new URL(raw, baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
      return u.toString();
    } catch {
      return undefined;
    }
  }
  if (!/^https?:\/\//i.test(raw)) return undefined;
  return raw;
}

/**
 * Only the head: everything past `</head>` is dropped before we scan, and a page
 * with no `</head>` is cut at the byte limit. A body can carry an `og:`-shaped meta
 * tag inside a `<div>` — cutting the region is what makes that irrelevant.
 */
function headRegion(html: string): string {
  const capped = html.length > HTML_SCAN_LIMIT ? html.slice(0, HTML_SCAN_LIMIT) : html;
  const end = capped.search(/<\/head>/i);
  return end >= 0 ? capped.slice(0, end) : capped;
}

export function parseHtmlMeta(html: string, baseUrl?: string): HtmlMeta {
  const region = headRegion(String(html || ""));
  const picked: Record<string, string> = {};
  // Quote-aware: a `>` inside content="..." is common on real pages ("> 10 tips"),
  // and a `[^>]*` tag pattern would stop at it and lose the whole attribute.
  const metaRe = /<meta\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(region)) !== null) {
    const a = attrsOf(m[0]);
    const key = (a.property || a.name || a["itemprop"] || "").toLowerCase();
    if (!key || !a.content) continue;
    // First one wins per key: that is what a browser does for `og:*`, and it stops a
    // later "og:title: ..." tag from overwriting the page's own headline.
    if (picked[key] === undefined) picked[key] = a.content;
  }
  let title =
    picked["og:title"] || picked["twitter:title"] || picked.title || picked["twitter:text:title"];
  if (!title) {
    const t = /<title\b[^>]*>([\s\S]{0,4000}?)<\/title>/i.exec(region);
    if (t) title = t[1];
  }
  const description =
    picked["og:description"] ||
    picked["twitter:description"] ||
    picked.description ||
    picked["description"];
  const siteName = picked["og:site_name"] || picked["twitter:site"] || picked["application-name"];
  const image =
    picked["og:image"] || picked["og:image:url"] || picked["og:image:secure_url"] || picked["twitter:image"];
  const canonical = absolutize(picked["og:url"] || "", baseUrl);

  const cleanTitle = tidy(title || "", TITLE_LIMIT);
  const cleanDesc = tidy(description || "", DESCRIPTION_LIMIT);
  const cleanSite = tidy(siteName || "", 80);
  const img = absolutize(image || "", baseUrl);
  // Decided from the cleaned values, and from the image only if the image survived
  // absolutising: a page whose `<title>` is three spaces, or whose only claim to
  // fame is an unusable `og:image`, has nothing to show — and `foundAny: true` there
  // buys an empty card.
  const out: HtmlMeta = { foundAny: Boolean(cleanTitle || cleanDesc || cleanSite || img) };
  if (cleanTitle) out.title = cleanTitle;
  if (cleanDesc) out.description = cleanDesc;
  if (cleanSite) out.siteName = cleanSite.replace(/^@/, "");
  if (img) out.imageUrl = img;
  if (canonical) out.canonical = canonical;
  return out;
}
