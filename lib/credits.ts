/**
 * Credit economy — the policy layer between a route and the wallet.
 *
 * The rule the boss set on 2026-08-31, kept deliberately small:
 *   1 credit  = one normal generation
 *   2 credits = a heavy tool (real token budget, multi-section output)
 *   10 credits free at signup, so quality can be judged before money moves
 *   ₹99 → 100 credits · ₹399 → 500 credits (the only place credits are sold)
 *
 * Two properties matter more than the numbers:
 *  1. **Hold before the work, refund when the work didn't happen.** A balance
 *     checked only *after* the model call is not a limit — it's an invoice
 *     nobody pays, and it makes "run the free tier forever" a strategy.
 *  2. **A credit that moves is a ledger row.** Every hold, refund and grant
 *     writes one, and grants carry an idempotency key, so a replayed payment
 *     verify cannot mint money twice.
 *
 * Chat is intentionally unpriced (0): it keeps the daily fair-use cap instead.
 * Metering the thing that hooks a user is how you lose them before they ever
 * see what the paid part does well.
 */

import { NextResponse } from "next/server";
import { CREDITS, RAZORPAY, creditPack } from "@/lib/config";
import {
  getBalance,
  getWallet,
  grantCredits,
  grantWelcomeCredits,
  listCreditLedger,
  maybeGrantProMonthly,
  planSeatsOf,
  refundCredits,
  spendCredits,
} from "@/lib/db/store";
import type { Plan } from "@/lib/db/store";
import { INPUT_LIMITS } from "@/lib/ai/gateway";

export type WorkKind =
  | "tool"
  | "image"
  | "audio"
  | "transcribe"
  | "agent"
  | "compare"
  | "vision"
  | "chat";

/** What one unit of this kind of work costs. */
export function costFor(kind: WorkKind, opts: { toolCost?: number; units?: number } = {}): number {
  switch (kind) {
    case "tool":
      return Math.max(1, Math.floor(opts.toolCost ?? CREDITS.cost.tool));
    case "image":
      return CREDITS.cost.image;
    case "audio":
      return CREDITS.cost.audio;
    case "transcribe":
      return CREDITS.cost.transcribe;
    case "agent":
      return CREDITS.cost.agent;
    case "vision":
      return CREDITS.cost.vision;
    case "compare":
      // one lane = one live model call, and that is exactly what it costs us
      return CREDITS.cost.compareLane * Math.max(1, Math.floor(opts.units ?? 1));
    case "chat":
    default:
      return CREDITS.cost.chat;
  }
}

/**
 * A guest has no account row to mint its signup grant from, so the grant is
 * attached to the first wallet touch. Cookie-scoped by nature — the durable
 * anti-abuse boundary is the per-day quota and, from Wave 6, the database.
 */
export function ensureWelcome(userId: string) {
  const w = getWallet(userId);
  if (w.welcomeAt) return { granted: 0, balance: w.balance };
  const res = grantWelcomeCredits(userId, CREDITS.welcome);
  return { granted: res.ok ? CREDITS.welcome : 0, balance: res.balance };
}

export type Hold =
  | { ok: true; refId: string; cost: number; balance: number }
  | { ok: false; balance: number; needed: number; cost: number };

/**
 * Take the money before the model runs. `refId` ties the hold to the request so
 * a refund can't be applied twice, and so two concurrent requests can't both
 * spend the same last credit (the second one fails closed, in the store's
 * locked read-modify-write).
 */
export function holdCredits(args: {
  userId: string;
  kind: WorkKind;
  reason: string;
  refId: string;
  toolCost?: number;
  units?: number;
}): Hold {
  ensureWelcome(args.userId);
  const cost = costFor(args.kind, { toolCost: args.toolCost, units: args.units });
  if (cost <= 0) {
    return { ok: true, refId: args.refId, cost: 0, balance: getBalance(args.userId) };
  }
  const res = spendCredits({
    userId: args.userId,
    amount: cost,
    reason: args.reason,
    refId: args.refId,
  });
  if (!res.ok) {
    return { ok: false, balance: res.balance, needed: res.needed, cost };
  }
  return { ok: true, refId: args.refId, cost, balance: res.balance };
}

/**
 * The same hold/refund pair for paid artifact routes that don't go through the
 * tool runner (image, speech, transcription, vision, an agent run). They read
 * their cost from the same table, so a number can never drift between surfaces.
 */
export type ArtifactKind = "image" | "audio" | "transcribe" | "vision" | "agent" | "compareLane";

export function holdForArtifact(
  userId: string,
  kind: ArtifactKind,
  refId: string
): Hold {
  return holdCredits({
    userId,
    kind: kind === "compareLane" ? "compare" : kind,
    units: kind === "compareLane" ? 1 : undefined,
    reason: kind,
    refId,
  });
}

/** The artifact was not produced — give the credit back. */
export function refundArtifact(userId: string, kind: ArtifactKind, cost: number, refId: string) {
  return refundCreditsFor({ userId, cost, reason: `${kind}-refund`, refId });
}

/** The work did not happen — give it back. */
export function refundCreditsFor(args: {
  userId: string;
  cost: number;
  reason: string;
  refId: string;
}) {
  if (args.cost <= 0) return { ok: true as const };
  return refundCredits({
    userId: args.userId,
    amount: args.cost,
    reason: args.reason,
    refId: args.refId,
  });
}

/**
 * A second model call happened inside one request (the tool runner's corrective
 * pass). Charging it is what stops "ask until it passes the contract" from being
 * free. If the user can't cover it, the caller keeps the first answer — which is
 * why this returns a flag instead of throwing.
 */
export function chargeExtra(args: {
  userId: string;
  kind: WorkKind;
  amount: number;
  reason: string;
  refId: string;
}): boolean {
  if (args.amount <= 0) return true;
  const res = spendCredits({
    userId: args.userId,
    amount: args.amount,
    reason: args.reason,
    refId: args.refId,
  });
  return res.ok;
}

/**
 * The 402 every paid surface returns when the wallet is short. Kept in one
 * place so the top-up path can recognise it by `code` and the copy can't drift.
 */
export function insufficientCreditsResponse(balance: number, needed: number) {
  return NextResponse.json(
    {
      error: `Out of credits — this needs ${needed} and your balance is ${balance}.`,
      code: "INSUFFICIENT_CREDITS",
      hint: `Top up from ${packLabel(CREDITS.packs[0])}. Packs don't expire, and a run that produces nothing is refunded automatically.`,
      balance,
      needed,
      packs: CREDITS.packs.map((p) => ({
        id: p.id,
        label: p.label,
        credits: p.credits,
        paise: p.paise,
        display: packLabel(p),
      })),
    },
    { status: 402, headers: { "cache-control": "no-store" } }
  );
}

/**
 * Hold credits for a paid artifact route before any provider call. Either the
 * caller gets a `hold` it can refund with, or it must return the Response.
 */
export function creditGate(userId: string, kind: ArtifactKind, refId: string) {
  const hold = holdForArtifact(userId, kind, refId);
  if (!hold.ok) {
    return { ok: false as const, res: insufficientCreditsResponse(hold.balance, hold.needed) };
  }
  return { ok: true as const, hold };
}

/** What the client shows after a paid call succeeds. */
export function creditReceipt(userId: string, hold: { ok: true; cost: number }) {
  return { charged: hold.cost, balance: getBalance(userId) };
}

/** "₹99 for 100 credits" — derived, so a price change can never strand copy. */
export function packLabel(p: { paise: number; credits: number }): string {
  const sym = RAZORPAY.currency === "INR" ? "\u20b9" : "$";
  return `${sym}${(p.paise / 100).toFixed(0)} for ${p.credits} credits`;
}

export function topUpCredits(args: { userId: string; credits: number; refId: string }) {
  return grantCredits({
    userId: args.userId,
    amount: args.credits,
    reason: "top-up",
    refId: args.refId,
  });
}

/** Everything the wallet UI and the pricing page need, from one read. */
export function creditSummary(userId: string, plan: Plan) {
  // Business multiplies the monthly grant by the seats that were paid for, and it is
  // done here because this is the one function both the wallet UI and the pricing page
  // read — a per-seat number invented in a component would disagree with the grant.
  const seats = plan === "pro" ? planSeatsOf(userId) : 1;
  const monthly = CREDITS.proMonthly * seats;
  maybeGrantProMonthly(userId, plan, monthly);
  ensureWelcome(userId);
  const wallet = getWallet(userId);
  return {
    balance: wallet.balance,
    // The UI has to warn about a ceiling before it hits a 413, and the ceiling is the
    // gateway's - not a number copied into a component, which is how a limit drifts.
    limits: { messageChars: INPUT_LIMITS.messageChars },
    welcome: CREDITS.welcome,
    welcomeAt: wallet.welcomeAt || null,
    plan,
    proMonthly: monthly,
    /** The multiplier behind `proMonthly`, so the UI can say "1,000 × 3 seats". */
    proSeats: seats,
    costs: {
      ...CREDITS.cost,
      packs: CREDITS.packs.map((p) => ({
        id: p.id,
        label: p.label,
        credits: p.credits,
        paise: p.paise,
      })),
    },
    ledger: listCreditLedger(userId, 30).map((c) => ({
      id: c.id,
      delta: c.delta,
      reason: c.reason,
      balanceAfter: c.balanceAfter,
      createdAt: c.createdAt,
    })),
  };
}

export { creditPack, CREDITS };
/** Re-exported so a route can report a balance after a refund without importing the store twice. */
export { getBalance };
