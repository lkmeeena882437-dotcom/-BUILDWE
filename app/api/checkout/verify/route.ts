import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { verifyProPayment, livePayments } from "@/lib/payments/razorpay";
import {
  findPaymentByOrder,
  getBalance,
  markPaymentPaidIfPending,
  updateUser,
} from "@/lib/db/store";
import { RAZORPAY, creditPack } from "@/lib/config";
import { topUpCredits } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * The ONLY path that turns an account into PRO or mints a credit pack.
 * Rules enforced here (audit C1):
 *  • the ledger row for the order must already exist, belong to this user, and
 *    still be `created` — so nothing can be "verified" that we never offered;
 *  • the signature is checked against the server secret AND Razorpay's own
 *    order status must say `paid` for at least the price that order was made
 *    at (the pack price for a pack, the PRO price for PRO);
 *  • the paid status is written with a compare-and-swap, so replaying this
 *    response twice cannot double-upgrade or double-book a payment;
 *  • no demo/fake branch exists on this route, in any environment.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        { ok: false, error: "Log in first — PRO upgrades need an account." },
        { status: 401 }
      );
    }

    if (!livePayments()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Checkout is not wired up on this server yet, so PRO cannot be activated. An operator needs to set the Razorpay keys.",
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const orderId = String(body.razorpay_order_id || "").trim();
    const paymentId = String(body.razorpay_payment_id || "").trim();
    if (!orderId || !paymentId) {
      return NextResponse.json(
        { ok: false, error: "Missing order or payment id." },
        { status: 400 }
      );
    }

    // 1. The order must be one we issued to THIS user, and still unpaid.
    const pay = findPaymentByOrder(orderId);
    if (!pay || pay.userId !== session.userId) {
      return NextResponse.json(
        { ok: false, error: "Unknown order." },
        { status: 400 }
      );
    }
    if (pay.status === "paid") {
      // Idempotent replay: report the earlier success, change nothing.
      return NextResponse.json(
        pay.kind === "pack"
          ? {
              ok: true,
              kind: "pack",
              credits: pay.credits || 0,
              balance: getBalance(session.userId),
              alreadyUpgraded: true,
              message: "This pack is already credited to your wallet.",
            }
          : {
              ok: true,
              plan: "pro",
              alreadyUpgraded: true,
              message: "PRO is already active on this account.",
            }
      );
    }
    if (pay.status !== "created") {
      return NextResponse.json(
        { ok: false, error: "This order can no longer be paid." },
        { status: 409 }
      );
    }
    // What should have been paid: the pack's own price, or PRO's. A short-priced
    // order is refused rather than honoured at a discount.
    const isPack = pay.kind === "pack";
    const expectedPaise = isPack
      ? creditPack(pay.packId || "")?.paise ?? pay.amount
      : RAZORPAY.amountPaise;
    if (pay.amount < expectedPaise) {
      // A short-priced order should not exist; refuse rather than honour it.
      return NextResponse.json(
        { ok: false, error: "This order's amount is wrong. Start a new checkout." },
        { status: 409 }
      );
    }

    // 2. Signature + "did the money actually arrive" — both server-side.
    const result = await verifyProPayment(
      {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: String(body.razorpay_signature || ""),
      },
      session.userId
    );

    if (!result.ok) {
      const failed = findPaymentByOrder(orderId);
      if (failed && failed.status === "created") {
        try {
          markPaymentPaidIfPending(failed.id, null, "failed");
        } catch {
          /* marking a failure must not mask the real error */
        }
      }
      return NextResponse.json(
        { ok: false, error: result.error || "Verification failed" },
        { status: 400 }
      );
    }

    // 3. Ledger first (CAS), plan second — if the CAS loses, someone already
    //    redeemed this order and we must not write a second grant.
    const flipped = markPaymentPaidIfPending(
      pay.id,
      result.paymentId || paymentId,
      "paid",
      result.amountPaid ?? pay.amount,
      result.currency || RAZORPAY.currency
    );
    if (!flipped) {
      return NextResponse.json({
        ok: true,
        ...(isPack
          ? {
              kind: "pack",
              credits: pay.credits || 0,
              balance: getBalance(session.userId),
              alreadyUpgraded: true,
              message: "This pack is already credited to your wallet.",
            }
          : {
              plan: "pro",
              alreadyUpgraded: true,
              message: "PRO is already active on this account.",
            }),
      });
    }

    // A pack's product IS credits, and the grant is keyed on the payment id, so
    // a replay of this response cannot mint the pack twice.
    if (isPack) {
      const pack = creditPack(pay.packId || "");
      const credits = pay.credits || pack?.credits || 0;
      if (credits <= 0) {
        // The money was taken and we cannot describe what it bought - say so
        // loudly instead of silently swallowing the grant.
        console.error("[bw] pack paid but credits unknown", pay.id, pay.packId);
        return NextResponse.json(
          {
            ok: false,
            error:
              "Payment succeeded but this pack could not be credited automatically. Support has been given the payment id.",
            code: "GRANT_FAILED",
            paymentId: pay.paymentId || paymentId,
          },
          { status: 500 }
        );
      }
      const grant = topUpCredits({
        userId: session.userId,
        credits,
        refId: result.paymentId || paymentId || pay.id,
      });
      if (!grant.ok) {
        console.error("[bw] pack grant rejected", pay.id, JSON.stringify(grant));
      }
      return NextResponse.json({
        ok: true,
        kind: "pack",
        credits,
        granted: grant.ok,
        balance: grant.balance,
        message: `${credits} credits added to your wallet.`,
      });
    }

    try {
      updateUser(session.userId, { plan: "pro" });
    } catch (e) {
      console.error("[bw] checkout verify persist", e);
    }

    return NextResponse.json({
      ok: true,
      plan: "pro",
      upgraded: true,
      message: "Payment verified — PRO activated.",
    });
  } catch (e) {
    console.error("[bw] checkout verify", e);
    return NextResponse.json(
      { ok: false, error: "Could not verify the payment. You have not been charged twice." },
      { status: 500 }
    );
  }
}
