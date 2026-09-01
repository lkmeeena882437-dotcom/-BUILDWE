"use client";

import { useEffect, useMemo, useState } from "react";
import { extractPreviewUrls, type PreviewDto } from "@/lib/net/urls";
import { fetchPreviewApi } from "@/lib/client/api";

/**
 * Rich link previews.
 *
 * A URL in an answer used to be blue text you had to trust. This puts one card per
 * distinct link above the fold of that answer: the host, the title the page chose for
 * itself, one line of description, and nothing invented.
 *
 * Three decisions worth stating, because they are the difference between a preview
 * feature and an SSRF/privacy bug:
 *
 * - **The browser never reads the target.** We ask our own `/api/preview`, which
 *   refuses internal addresses and is rate-limited. A client-side fetch would let the
 *   page author probe whoever is reading the chat.
 * - **`og:image` is opt-in.** A picture from the linked host is a request from the
 * *reader's* browser, with the reader's IP, to a host the reader never chose. So the
 *   card shows a "Show image" control instead of firing it, and asks no referrer.
 * - **Silence on failure.** If the server refused, timed out, or found a page that
 *   describes nothing, the card is not rendered at all. A grey "preview unavailable"
 *   box on every third link is what makes people distrust the good ones.
 *
 * It is not used inside tool output, and `extractPreviewUrls` ignores anything in a
 * code fence, so a snippet that mentions a URL never grows a card.
 */

/** Cards are cheap to re-derive but the fetch is not; this memo is per tab, not persistent. */
const RESOLVED_MAX = 50;
const resolved: Record<string, { dto: PreviewDto | null }> = {};
const pending: Record<string, Promise<PreviewDto | null>> = {};
let resolvedCount = 0;

function loadPreview(url: string): Promise<PreviewDto | null> {
  const hit = resolved[url];
  if (hit) return Promise.resolve(hit.dto);
  const inFlight = pending[url];
  if (inFlight) return inFlight;
  const p = fetchPreviewApi(url).then(
    (dto) => {
      delete pending[url];
      if (!resolved[url]) {
        resolved[url] = { dto };
        resolvedCount++;
        // Insertion order is good enough for a 50-entry memo of non-integer keys.
        if (resolvedCount > RESOLVED_MAX) {
          for (const k in resolved) {
            delete resolved[k];
            resolvedCount--;
            break;
          }
        }
      }
      return dto;
    },
    () => {
      delete pending[url];
      return null;
    }
  );
  pending[url] = p;
  return p;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function LinkPreviewCard({ url }: { url: string }) {
  const [dto, setDto] = useState<PreviewDto | null>(() => resolved[url]?.dto ?? null);
  const [wantsImage, setWantsImage] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => {
    if (resolved[url]) {
      setDto(resolved[url].dto);
      return;
    }
    let alive = true;
    // No deadline of our own: `lib/net/preview.ts` owns the one timeout, and two
    // racing clocks just decide which of them the bug is hiding behind. The card is
    // decoration under an answer that is already on screen, so "still not here" and
    // "nothing to show" must look identical.
    loadPreview(url).then((d) => {
      if (alive && d) setDto(d);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!dto) return null;
  const href = dto.url || url;
  const host = dto.host ? dto.host.replace(/^www\./i, "") : hostOf(href);
  const title = dto.title || host || "Open link";
  const initial = (host || "?").charAt(0).toUpperCase();

  return (
    <div className="bw-preview" data-preview-host={host || undefined}>
      <span className="bw-preview__mark" aria-hidden="true">
        {initial || "?"}
      </span>
      <div className="bw-preview__body">
        <span className="bw-preview__host">{dto.siteName || host || "Link"}</span>
        <a
          className="bw-preview__title"
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          title={href}
        >
          {title}
        </a>
        {dto.description ? <p className="bw-preview__desc">{dto.description}</p> : null}
      </div>
      {dto.imageUrl && !imageBroken ? (
        wantsImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="bw-preview__img"
            src={dto.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageBroken(true)}
          />
        ) : (
          <button type="button" className="bw-preview__imgbtn" onClick={() => setWantsImage(true)}>
            Show image
          </button>
        )
      ) : null}
    </div>
  );
}

/**
 * Renders one card per distinct link in a message. `text` is the raw markdown so the
 * extraction can see fences and skip them; the rendered HTML is the wrong place to
 * look for links (the anchor is already sanitised, and its text may not be the URL).
 */
export function LinkPreviews({
  text,
  limit,
  exclude,
}: {
  text: string;
  limit?: number;
  /** URLs the message already shows another way (Sources chips) — no duplicate card. */
  exclude?: string[];
}) {
  // One dependency that describes the exclusion set, so the memo is not invalidated by
  // a fresh array literal on every keystroke.
  const skipKey = exclude && exclude.length ? exclude.join("\n") : "";
  const urls = useMemo(
    () => extractPreviewUrls(text, limit, skipKey ? skipKey.split("\n") : undefined),
    [text, limit, skipKey]
  );
  if (!urls.length) return null;
  return (
    <div className="bw-previews" aria-label="Link previews">
      {urls.map((u) => (
        <LinkPreviewCard key={u} url={u} />
      ))}
    </div>
  );
}
