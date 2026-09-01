import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { streamChatOrCode } from "@/lib/ai/providers";
import { estimateComplexity } from "@/lib/ai/models-catalog";
import { laneContract, laneNote, laneFor, resolveLanes } from "@/lib/ai/compare-seats";
import { userProviderKeys } from "@/lib/ai/byok";
import { bump } from "@/lib/metrics/metrics";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { uid } from "@/lib/db/store";
import { CREDITS } from "@/lib/config";
import { getBalance, holdCredits, refundCreditsFor, insufficientCreditsResponse } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Model comparison: fan one prompt out over a set of models the *caller* picked, then
 * synthesize ONE answer. Honest: a lane with no live provider reports `live: false` and is
 * refunded — we never fabricate model voices, and we never bill for one.
 *
 *   GET  /api/ai/compare  → the lane contract (range, price per lane, this deployment's defaults)
 *   POST /api/ai/compare  { prompt, models?: string[] }
 *
 * The rows a picker should list come from `GET /api/ai/models` (`selectable.chat`) rather than
 * from here, so the model projection has exactly one owner; this route only says what *it* will
 * accept, which is what a preview has to be priced against.
 */

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.token) out += j.token;
      } catch {
        /* partial */
      }
    }
    buf = buf.slice(buf.lastIndexOf("\n") + 1);
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const res = NextResponse.json({ ok: true, ...laneContract(userProviderKeys(session.userId)) });
    // Which lanes are default depends on whose keys are connected, so a shared cache entry is a
    // wrong answer for the next reader.
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    console.error("[bw] compare contract", e);
    return NextResponse.json(
      { ok: false, error: "Could not read the comparison settings." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("compare", session.userId, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: "Compare is heavy — wait a minute between runs.",
          code: "RATE_LIMIT",
          hint: "Wait about a minute, then run the comparison again.",
        },
        { status: 429 }
      );
    }

    // Each run is N+1 model calls: one per lane plus the pass that combines them. Without a
    // quota check this was the cheapest free burner on the platform (audit A4). Free users are
    // limited by their chat allowance, and a comparison is charged as one unit per live lane.
    const limit = checkLimit(session.userId, session.plan, "chat");
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: limit.message || "Daily limit reached.",
          code: "LIMIT",
          hint: "Compare runs several models at once, so it counts against your chat allowance.",
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || "").trim().slice(0, 2000);
    if (!prompt) {
      return NextResponse.json({ error: "Enter a prompt to compare on." }, { status: 400 });
    }

    // BYOK first, exactly as chat and the agent do it. A comparison that ignored the user's own
    // key would mark their lanes offline while their own chat worked — the bug this route shipped
    // with until `lib/ai/byok.ts` made the answer one function.
    const userKeys = session.kind === "user" ? userProviderKeys(session.userId) : undefined;

    // `picked`, not `plan`: in this file `plan` is the pricing plan, and a lane list that shadows it
    // is how a reader ends up holding the wrong thing.
    const picked = resolveLanes(body?.models, userKeys);
    if (!picked.ok) {
      return NextResponse.json(picked.body, { status: picked.status });
    }

    const complexity = estimateComplexity(prompt);
    const messages = [{ role: "user", content: prompt }];

    // A lane that never answers must not be billed: hold for every seat up front, then give back
    // one credit per dead lane (audit rule — the paid call is never taken after the fact).
    const seatList = picked.ids.map((id, i) => laneFor(id, i));
    const cmpId = uid("cmp");
    const hold = holdCredits({
      userId: session.userId,
      kind: "compare",
      units: seatList.length,
      reason: "compare",
      refId: cmpId,
    });
    if (!hold.ok) return insufficientCreditsResponse(hold.balance, hold.needed);

    const refund = (deadLanes: number) => {
      const amount = CREDITS.cost.compareLane * deadLanes;
      if (amount > 0) {
        refundCreditsFor({
          userId: session.userId,
          cost: amount,
          reason: "compare-lane-refund",
          refId: cmpId,
        });
      }
      return amount;
    };
    /** What the caller pays for this run, and why — spelled out once, so the wallet UI and the
     *  copy next to the button cannot drift apart from the arithmetic in this file. */
    const creditsBlock = (counts: { total: number; live: number; dead: number }, refunded: number) => ({
      perLane: CREDITS.cost.compareLane,
      held: hold.cost,
      refunded,
      charged: hold.cost - refunded,
      balance: getBalance(session.userId),
      lanes: counts,
    });

    const lanes = await Promise.all(
      seatList.map(async (seat) => {
        const { stream, live } = await streamChatOrCode({
          mode: "chat",
          messages,
          plan: session.plan,
          promptForRouting: prompt,
          forceModel: seat.id,
          userKeys,
        });
        const reply = await collect(stream);
        return {
          ...seat,
          live,
          reply: live ? reply.slice(0, 2400) : "",
          // `note` only exists on a lane that did not answer, and it says which of the two
          // reasons that was — a key the user can add, or a vendor that did not reply.
          ...(live && reply.trim() ? {} : { note: laneNote(seat.id, userKeys) }),
        };
      })
    );

    const liveLanes = lanes.filter((l) => l.live && l.reply.trim());
    const deadLanes = lanes.length - liveLanes.length;
    const counts = { total: lanes.length, live: liveLanes.length, dead: deadLanes };
    const refundAmount = refund(deadLanes);
    bump("compare_run");
    if (liveLanes.length && session.kind === "user") {
      recordUsage(session.userId, "chat", liveLanes.length);
    }
    if (!liveLanes.length) bump("compare_offline");
    if (!liveLanes.length) {
      const message =
        "Model comparison needs at least one live model. Connect your own key in Settings → API keys, or try again shortly.";
      const res = NextResponse.json({
        ok: true,
        available: false,
        message,
        synthesis: message,
        // The lanes come back even when none of them answered: "you asked these three, and here is
        // why each one did not" is a useful screen, and "no results" is not.
        lanes: lanes.map((l) => ({
          id: l.id,
          label: l.label,
          model: l.model,
          // `l.live`, not `false`: a lane whose provider replied with nothing is a different fact
          // from a lane that had no provider, and the note is what distinguishes them.
          live: Boolean(l.live),
          reply: "",
          note: l.note || laneNote(l.id, userKeys),
        })),
        credits: creditsBlock(counts, refundAmount),
      });
      attachGuestCookie(res, session.userId);
      return res;
    }

    // Synthesis — one judge pass over the live answers (never treats model agreement as proof;
    // differences are surfaced, not buried)
    const synthesisInput = [
      {
        role: "system",
        content:
          "You are BUILDWE's comparison synthesizer. You get one question and answers from different models. Produce: (1) '### Short answer' — the best single answer, (2) '### Where they agree' — one line, (3) '### Where they differ' — bullet the real differences and say which is better supported and why. Be honest when answers are equally valid. Keep it tight. Agreement between models is NOT proof of truth — note if the claim should be verified.",
      },
      {
        role: "user",
        content: `Question: ${prompt}\n\n${liveLanes
          .map((l, i) => `Answer ${i + 1} (${l.label} · ${l.model}):\n${l.reply}`)
          .join("\n\n---\n\n")}`,
      },
    ];
    const synthRun = await streamChatOrCode({
      mode: "chat",
      messages: synthesisInput,
      plan: session.plan,
      promptForRouting: prompt,
      userKeys,
    });
    const synthesis = await collect(synthRun.stream);

    const res = NextResponse.json({
      ok: true,
      available: true,
      complexity,
      lanes: lanes.map((l) => ({
        id: l.id,
        label: l.label,
        model: l.model,
        live: l.live,
        reply: l.reply,
        ...(l.live ? {} : { note: l.note || laneNote(l.id, userKeys) }),
      })),
      synthesis: synthRun.live ? synthesis : "",
      credits: creditsBlock(counts, refundAmount),
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] compare route", e);
    return NextResponse.json(
      { error: "Comparison failed. Try again." },
      { status: 500 }
    );
  }
}
