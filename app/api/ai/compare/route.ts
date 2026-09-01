import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { streamChatOrCode } from "@/lib/ai/providers";
import { estimateComplexity } from "@/lib/ai/models-catalog";
import {
  LANE_REPLY_CHARS,
  laneContract,
  laneNote,
  laneFor,
  resolveLanes,
  resolveMix,
  type MixLane,
} from "@/lib/ai/compare-seats";
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
 *   POST /api/ai/compare  { prompt, models?: string[] }              → run the lanes + combine them
 *   POST /api/ai/compare  { action:"mix", prompt, lanes:[{id,reply}] } → combine a *subset* again
 *
 * The second action is the answer to "I liked two of these three — now what?". Re-mixing does not
 * re-ask any model: the answers are already on the screen, so one judge pass over a different
 * subset is exactly one lane's worth of work, and it is priced as that.
 *
 * The rows a picker should list come from `GET /api/ai/models` (`selectable.chat`) rather than
 * from here, so the model projection has exactly one owner; this route only says what *it* will
 * accept, which is what a preview has to be priced against.
 */

/** One policy for folding lanes into an answer, used by the run and by every re-mix, so the two
 *  can never disagree about what "the combined answer" means. */
const SYNTH_SYSTEM =
  "You are BUILDWE's comparison synthesizer. You get one question and answers from different models. Produce: (1) '### Short answer' — the best single answer, (2) '### Where they agree' — one line, (3) '### Where they differ' — bullet the real differences and say which is better supported and why. Be honest when answers are equally valid. Keep it tight. Agreement between models is NOT proof of truth — note if the claim should be verified.";

function synthesisInput(prompt: string, lanes: { label: string; model: string; reply: string }[]) {
  return [
    { role: "system", content: SYNTH_SYSTEM },
    {
      role: "user",
      content: `Question: ${prompt}\n\n${lanes
        .map((l, i) => `Answer ${i + 1} (${l.label} · ${l.model}):\n${l.reply}`)
        .join("\n\n---\n\n")}`,
    },
  ];
}

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

/** The judge pass itself: one call, over whatever lanes the caller is standing on. */
async function judge(args: {
  prompt: string;
  plan: "free" | "pro";
  userKeys?: ReturnType<typeof userProviderKeys>;
  lanes: { label: string; model: string; reply: string }[];
}) {
  const run = await streamChatOrCode({
    mode: "chat",
    messages: synthesisInput(args.prompt, args.lanes),
    plan: args.plan,
    promptForRouting: args.prompt,
    ...(args.userKeys ? { userKeys: args.userKeys } : {}),
  });
  const text = await collect(run.stream);
  return { text, live: run.live && text.trim().length > 0 };
}

/**
 * The money half, spelled once: `holdCredits` already took `units` worth before anything ran, so
 * settling means giving one unit back per unit of work that did not happen and reporting the
 * arithmetic — never just the gross. `charged` is what was kept, and `balance` is what the wallet
 * UI needs to stay honest after a refund.
 */
function settle(args: {
  userId: string;
  held: number;
  refId: string;
  reason: string;
  units: { total: number; live: number };
}) {
  const dead = Math.max(0, args.units.total - args.units.live);
  const refunded = CREDITS.cost.compareLane * dead;
  if (refunded > 0) {
    refundCreditsFor({
      userId: args.userId,
      cost: refunded,
      reason: `${args.reason}-refund`,
      refId: args.refId,
    });
  }
  return {
    perLane: CREDITS.cost.compareLane,
    held: args.held,
    refunded,
    charged: args.held - refunded,
    balance: getBalance(args.userId),
    lanes: { ...args.units, dead },
  };
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

    // Both actions are model calls, so both go through the same quota: one run is N lanes + a
    // judge pass, one re-mix is a judge pass. Without a quota check this was the cheapest free
    // burner on the platform (audit A4). A comparison is charged as one unit per live lane.
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
    const action = String(body?.action || "run");
    if (action !== "run" && action !== "mix") {
      return NextResponse.json(
        {
          error: `Unknown action "${action}".`,
          code: "BAD_ACTION",
          hint: 'POST /api/ai/compare takes action "run" (the default) or "mix".',
        },
        { status: 400 }
      );
    }

    const prompt = String(body?.prompt || "").trim().slice(0, 2000);
    if (!prompt) {
      return NextResponse.json({ error: "Enter a prompt to compare on." }, { status: 400 });
    }

    // BYOK first, exactly as chat and the agent do it. A comparison that ignored the user's own
    // key would mark their lanes offline while their own chat worked — the bug this route shipped
    // with until `lib/ai/byok.ts` made the answer one function.
    const userKeys = session.kind === "user" ? userProviderKeys(session.userId) : undefined;

    if (action === "mix") {
      const mix = resolveMix(body?.lanes);
      if (!mix.ok) return NextResponse.json(mix.body, { status: mix.status });

      // One unit held for one judge pass — the lanes were paid for on the run that produced them.
      const mixId = uid("cmp");
      const hold = holdCredits({
        userId: session.userId,
        kind: "compare",
        units: 1,
        reason: "compare-mix",
        refId: mixId,
      });
      if (!hold.ok) return insufficientCreditsResponse(hold.balance, hold.needed);

      const verdict = await judge({ prompt, plan: session.plan, userKeys, lanes: mix.lanes });
      const credits = settle({
        userId: session.userId,
        held: hold.cost,
        refId: mixId,
        reason: "compare-mix",
        units: { total: 1, live: verdict.live ? 1 : 0 },
      });
      bump("compare_mix");
      if (verdict.live && session.kind === "user") recordUsage(session.userId, "chat", 1);

      const res = NextResponse.json({
        ok: true,
        action: "mix",
        available: verdict.live,
        synthesis: verdict.live ? verdict.text : "",
        ...(!verdict.live
          ? { message: "The combined-answer pass could not run, so nothing was charged." }
          : {}),
        // `used`, not `lanes`: a mix did not ask these models, it folded their answers, and a
        // reader comparing the two shapes must not expect a `reply` field here.
        used: mix.lanes.map((l) => mixLaneView(l)),
        credits,
      });
      attachGuestCookie(res, session.userId);
      return res;
    }

    const picked = resolveLanes(body?.models, userKeys);
    if (!picked.ok) {
      // `picked`, not `plan`: in this file `plan` is the pricing plan, and a lane list that shadows it
      // is how a reader ends up holding the wrong thing.
      return NextResponse.json(picked.body, { status: picked.status });
    }

    const complexity = estimateComplexity(prompt);
    const messages = [{ role: "user", content: prompt }];

    // A lane that never answers must not be billed: hold for every seat up front, then settle
    // (audit rule — the paid call is never taken after the fact).
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
        const kept = live ? reply.slice(0, LANE_REPLY_CHARS) : "";
        return {
          ...seat,
          live: live && kept.trim().length > 0,
          reply: kept,
          // `note` only exists on a lane that did not produce text, and it says which of the two
          // reasons that was — a key the user can add, or a vendor that did not reply.
          ...(!(live && kept.trim()) ? { note: laneNote(seat.id, userKeys) } : {}),
        };
      })
    );

    const liveLanes = lanes.filter((l) => l.live);
    bump("compare_run");
    const credits = settle({
      userId: session.userId,
      held: hold.cost,
      refId: cmpId,
      reason: "compare",
      units: { total: lanes.length, live: liveLanes.length },
    });
    if (liveLanes.length && session.kind === "user") {
      recordUsage(session.userId, "chat", liveLanes.length);
    }
    if (!liveLanes.length) bump("compare_offline");

    const laneViews = lanes.map((l) => ({
      id: l.id,
      label: l.label,
      model: l.model,
      // `l.live` already means "answered with something", so an empty reply and a missing provider
      // stay distinguishable in the UI without guessing from the text.
      live: l.live,
      reply: l.reply,
      ...("note" in l ? { note: l.note } : {}),
    }));

    if (!liveLanes.length) {
      const message =
        "Model comparison needs at least one live model. Connect your own key in Settings → API keys, or try again shortly.";
      const res = NextResponse.json({
        ok: true,
        action: "run",
        available: false,
        message,
        synthesis: message,
        // The lanes come back even when none of them answered: "you asked these three, and here is
        // why each one did not" is a useful screen, and "no results" is not.
        lanes: laneViews,
        credits,
      });
      attachGuestCookie(res, session.userId);
      return res;
    }

    // Synthesis — one judge pass over the live answers, bundled into the run's price
    const verdict = await judge({ prompt, plan: session.plan, userKeys, lanes: liveLanes });
    if (!verdict.live) bump("compare_synth_offline");

    const res = NextResponse.json({
      ok: true,
      action: "run",
      available: true,
      complexity,
      lanes: laneViews,
      // Which lanes the combined answer was actually built from, so the UI can say it.
      combinedFrom: liveLanes.map((l) => l.id),
      synthesis: verdict.live ? verdict.text : "",
      ...(!verdict.live
        ? {
            synthesisNote:
              "No model answered the combined pass, so the lanes below stand on their own — you were charged for the lanes, not for a synthesis that did not happen.",
          }
        : {}),
      credits,
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

/** What a re-mix says about each answer it folded: which model it came from, and whether the text
 *  had to be trimmed to the length a comparison publishes. No `live` field — in this response
 *  "was folded in" is not the same claim as "a provider answered", and reusing that name would
 *  let a mix look like a run. */
function mixLaneView(l: MixLane) {
  return {
    id: l.id,
    label: l.label,
    model: l.model,
    chars: l.chars,
    ...(l.trimmed ? { trimmed: true, note: `Trimmed to ${l.chars} characters.` } : {}),
  };
}
