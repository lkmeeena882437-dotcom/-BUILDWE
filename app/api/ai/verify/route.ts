import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { extractClaims } from "@/lib/ai/quality";
import { webSearch } from "@/lib/ai/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/verify { text }
 * Honest verification: extracts check-worthy claims and looks for
 * corroborating sources via live web search. Labels per claim:
 *   verified   — a live source's snippet matches the claim's key figures/terms
 *   uncertain  — no matching source found (NOT "wrong" — just unconfirmed)
 * No fabricated confidence percentages.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = rateLimit(`verify:${session.userId}:${clientIp(req)}`, 15, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many verifications — wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || "").slice(0, 8000);
    if (!text.trim()) {
      return NextResponse.json({ error: "Nothing to verify." }, { status: 400 });
    }

    const claims = extractClaims(text);
    if (!claims.length) {
      return NextResponse.json({
        ok: true,
        verdict: "nothing-to-check",
        message:
          "No statistics, dates, prices, or superlatives found in this answer — nothing that needs external verification.",
        claims: [],
      });
    }

    // verify the top claims against live sources (key-free)
    const results = await Promise.all(
      claims.slice(0, 3).map(async (c) => {
        const found = await webSearch(c.text.slice(0, 120), { max: 3, timeoutMs: 7000 });
        const keyNums = (c.text.match(/\d+(\.\d+)?/g) || []).map(Number);
        let verdict: "verified" | "uncertain" = "uncertain";
        let source: { title: string; url: string; host: string } | undefined;

        for (const r of found) {
          const snippetNums = (r.snippet.match(/\d+(\.\d+)?/g) || []).map(Number);
          const sharesNumber =
            keyNums.length > 0 &&
            keyNums.some((n) => snippetNums.some((m) => Math.abs(m - n) < 0.01));
          const sharesTerms = contentOverlap(c.text, r.snippet) >= 2;
          if (sharesNumber || sharesTerms) {
            verdict = "verified";
            source = { title: r.title, url: r.url, host: r.host };
            break;
          }
        }
        return { claim: c.text, kind: c.kind, verdict, source };
      })
    );

    const verified = results.filter((r) => r.verdict === "verified").length;
    const res = NextResponse.json({
      ok: true,
      verdict: verified === results.length ? "verified" : "needs-verification",
      message:
        verified === results.length
          ? `All ${results.length} checkable claim(s) matched a live source.`
          : `${verified}/${results.length} claim(s) matched a live source — the rest are marked uncertain (unconfirmed, not necessarily wrong).`,
      claims: results,
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] verify route", e);
    return NextResponse.json(
      { error: "Verification failed. Try again." },
      { status: 500 }
    );
  }
}

function contentOverlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      (s.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).filter(
        (w) =>
          !/^(this|that|with|from|have|been|will|your|their|about|which|while|there|these|those|would|could|should|more|most|than|also|into|only|very|just|like|make|made|take|gives?)/.test(
            w
          )
      )
    );
  const A = words(a);
  const B = words(b);
  let hit = 0;
  for (const w of Array.from(A)) if (B.has(w)) hit++;
  return hit;
}
