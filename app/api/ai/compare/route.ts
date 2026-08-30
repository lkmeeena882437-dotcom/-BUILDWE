import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { streamChatOrCode } from "@/lib/ai/providers";
import { estimateComplexity } from "@/lib/ai/models-catalog";
import { bump } from "@/lib/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/compare { prompt }
 * Multi-model comparison (Update #1 P1): fan the prompt out to 3 model
 * seats, then synthesize ONE answer. Honest: without live provider keys,
 * lanes report "offline" — we never fabricate model voices.
 */

const SEATS = [
  { id: "llama-3.3-70b-versatile", label: "Model A · reasoning" },
  { id: "llama-3.1-8b-instant", label: "Model B · speed" },
  { id: "gemma2-9b-it", label: "Model C · writing" },
];

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
    const rl = rateLimit(`compare:${session.userId}:${clientIp(req)}`, 10, 60_000);
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

    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || "").trim().slice(0, 2000);
    if (!prompt) {
      return NextResponse.json({ error: "Enter a prompt to compare on." }, { status: 400 });
    }

    const complexity = estimateComplexity(prompt);
    const messages = [{ role: "user", content: prompt }];

    const lanes = await Promise.all(
      SEATS.map(async (seat) => {
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
    bump("compare_run");
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
