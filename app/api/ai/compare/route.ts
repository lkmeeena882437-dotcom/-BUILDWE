import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";

import { streamChatOrCode } from "@/lib/ai/providers";
import { estimateComplexity } from "@/lib/ai/models-catalog";
import { bump } from "@/lib/metrics/metrics";
import { checkLimit, recordUsage } from "@/lib/ai/limits";
import { uid } from "@/lib/db/store";
import { CREDITS } from "@/lib/config";
import { holdCredits, refundCreditsFor, insufficientCreditsResponse } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/compare { prompt }
 * Multi-model comparison (Update #1 P1): fan the prompt out to 3 model
 * seats, then synthesize ONE answer. Honest: without live provider keys,
 * lanes report "offline" — we never fabricate model voices.
 */

/**
 * Which models get asked. `gemma2-9b-it` used to be hard-coded here and is a
 * retired Groq model, so one lane failed on every run (audit A4). Seats are now
 * chosen from the live provider set when we can, and the list is overridable
 * per deployment with COMPARE_SEATS="id,id,id".
 */
const DEFAULT_SEATS = [
  { id: "llama-3.3-70b-versatile", label: "Model A · reasoning" },
  { id: "llama-3.1-8b-instant", label: "Model B · speed" },
  { id: "llama-3.2-3b-instruct", label: "Model C · writing" },
];

function seats(): { id: string; label: string }[] {
  const raw = (process.env.COMPARE_SEATS || "").trim();
  if (!raw) return DEFAULT_SEATS.slice(0, Number(process.env.COMPARE_SEAT_COUNT || 3));
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((id, i) => ({ id, label: `Model ${String.fromCharCode(65 + i)} · ${id}` }));
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

    // Each run is SEATS+1 model calls. Without a quota check this was the
    // cheapest free burner on the platform: 10 runs/min × 4 calls, forever
    // (audit A4). Free users are limited by their chat allowance, and a
    // comparison is charged as one chat unit per live lane it actually used.
    const limit = checkLimit(session.userId, session.plan, "chat");
    if (!limit.ok) {
      return NextResponse.json(
        { error: limit.message || "Daily limit reached.", code: "LIMIT", hint: "Compare runs several models at once, so it counts against your chat allowance." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || "").trim().slice(0, 2000);
    if (!prompt) {
      return NextResponse.json({ error: "Enter a prompt to compare on." }, { status: 400 });
    }

    const complexity = estimateComplexity(prompt);
    const messages = [{ role: "user", content: prompt }];

    // A lane that never answers must not be billed: hold for every seat up
    // front, then give back one credit per dead lane (audit rule - the paid
    // call is never taken after the fact).
    const seatList = seats();
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
        const { stream, model, live } = await streamChatOrCode({
          mode: "chat",
          messages,
          plan: session.plan,
          promptForRouting: prompt,
          forceModel: seat.id,
        });
        const reply = await collect(stream);
        return {
          label: seat.label,
          model,
          live,
          reply: live ? reply.slice(0, 2400) : "",
        };
      })
    );

    const liveLanes = lanes.filter((l) => l.live && l.reply.trim());
    const deadLanes = lanes.length - liveLanes.length;
    if (deadLanes > 0) {
      refundCreditsFor({
        userId: session.userId,
        cost: CREDITS.cost.compareLane * deadLanes,
        reason: "compare-lane-refund",
        refId: cmpId,
      });
    }
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
        lanes: [],
      });
      attachGuestCookie(res, session.userId);
      return res;
    }

    // Synthesis — one judge pass over the live answers (never treats model
    // agreement as proof; differences are surfaced, not buried)
    const synthesisInput = [
      {
        role: "system",
        content:
          "You are BUILDWE's comparison synthesizer. You get one question and answers from different models. Produce: (1) '### Short answer' — the best single answer, (2) '### Where they agree' — one line, (3) '### Where they differ' — bullet the real differences and say which is better supported and why. Be honest when answers are equally valid. Keep it tight. Agreement between models is NOT proof of truth — note if the claim should be verified.",
      },
      {
        role: "user",
        content: `Question: ${prompt}\n\n${liveLanes
          .map((l, i) => `Answer ${i + 1} (${l.label}):\n${l.reply}`)
          .join("\n\n---\n\n")}`,
      },
    ];
    const synthRun = await streamChatOrCode({
      mode: "chat",
      messages: synthesisInput,
      plan: session.plan,
      promptForRouting: prompt,
    });
    const synthesis = await collect(synthRun.stream);

    const res = NextResponse.json({
      ok: true,
      available: true,
      complexity,
      lanes: lanes.map((l) => ({
        label: l.label,
        model: l.model,
        live: l.live,
        reply: l.reply,
      })),
      synthesis: synthRun.live ? synthesis : "",
      credits: {
        charged: hold.cost,
        lanes: { total: lanes.length, live: liveLanes.length, refunded: deadLanes },
      },
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
