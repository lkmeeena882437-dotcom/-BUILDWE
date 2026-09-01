import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";
import { readLinkPreview, type PreviewFailureCode } from "@/lib/net/preview";
import { normalizePreviewUrl } from "@/lib/net/urls";
import {
  findLinkPreview,
  linkPreviewKey,
  LINK_PREVIEW_FAIL_TTL_MS,
  LINK_PREVIEW_OK_TTL_MS,
  saveLinkPreview,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refusals that are about the *address*, not about the site: never retried, never cached. */
const SAFETY_CODES: PreviewFailureCode[] = ["BAD_URL", "BAD_SCHEME", "BAD_PORT", "NO_HOST", "PRIVATE_TARGET"];

/**
 * `GET /api/preview?url=…` — metadata for one link, for the card under an answer.
 *
 * Deliberately narrow: one URL per call, no batching (a batch endpoint is a
 * scanner), only the caller's own identity is needed (no credits — a preview is not
 * AI work, and charging for it would make people think the card costs them), and the
 * answer is either what the page said about itself or a code explaining why we did not
 * look. `SAFETY_CODES` are answered without touching the network at all; everything
 * that does touch it goes through `lib/net/ssrf.ts` first, on every hop.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("preview", session.userId, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: rl.error, hint: rl.hint }, { status: 429 });
    }

    const raw = String(req.nextUrl.searchParams.get("url") || "").trim();
    const normalized = normalizePreviewUrl(raw);
    if (!normalized) {
      // Either unparseable, or a host the client should not be asking about at all.
      // Reported as a refusal rather than silence, so the UI can decide.
      return json({ ok: false, code: "BAD_URL", error: "That link cannot be previewed." }, 400, session.userId);
    }

    const now = Date.now();
    const hit = findLinkPreview(linkPreviewKey(normalized), now);
    if (hit) {
      if (!hit.ok) {
        return json(
          { ok: false, code: hit.code || "NO_METADATA", error: "That link could not be previewed.", source: "cache" },
          200,
          session.userId
        );
      }
      return json(
        {
          ok: true,
          source: "cache",
          preview: {
            url: normalized,
            host: hit.host,
            title: hit.title,
            description: hit.description,
            siteName: hit.siteName,
            imageUrl: hit.imageUrl,
          },
        },
        200,
        session.userId
      );
    }

    const outcome = await readLinkPreview(normalized);
    if (outcome.ok) {
      saveLinkPreview({
        key: linkPreviewKey(normalized),
        host: outcome.host,
        ok: true,
        title: outcome.meta.title,
        description: outcome.meta.description,
        siteName: outcome.meta.siteName,
        imageUrl: outcome.meta.imageUrl,
        fetchedAt: now,
        expiresAt: now + LINK_PREVIEW_OK_TTL_MS,
      });
      return json(
        {
          ok: true,
          source: "live",
          preview: {
            url: outcome.url,
            host: outcome.host,
            title: outcome.meta.title,
            description: outcome.meta.description,
            siteName: outcome.meta.siteName,
            imageUrl: outcome.meta.imageUrl,
          },
        },
        200,
        session.userId
      );
    }

    // Refusing an internal address costs nothing, so it is not worth a cache row.
    if (!SAFETY_CODES.includes(outcome.code)) {
      saveLinkPreview({
        key: linkPreviewKey(normalized),
        host: safeHostOf(normalized),
        ok: false,
        code: outcome.code,
        fetchedAt: now,
        expiresAt: now + LINK_PREVIEW_FAIL_TTL_MS,
      });
    }
    // The client renders nothing on `ok: false`: an absent card is honest, a card
    // saying "this site has no title" is noise.
    return json(
      { ok: false, code: outcome.code, error: outcome.message, source: "live" },
      SAFETY_CODES.includes(outcome.code) ? 400 : 502,
      session.userId
    );
  } catch (e) {
    console.error("[bw] preview route", e);
    return json({ ok: false, code: "PREVIEW_FAILED", error: "Preview failed. Try again." }, 500, null);
  }
}

function json(body: unknown, status: number, userId: string | null) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  if (userId) attachGuestCookie(res, userId);
  return res;
}

function safeHostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
