import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { verifyProPayment, livePayments } from "@/lib/payments/razorpay";
import {
  findPaymentByOrder,
  markPaymentPaidIfPending,
  updateUser,
} from "@/lib/db/store";
import { RAZORPAY } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * The ONLY path that turns an account into PRO. Rules enforced here (audit C1):
 *  • the ledger row for the order must already exist, belong to this user, and
 *    still be `created` — so nothing can be "verified" that we never offered;
 *  • the signature is checked against the server secret AND Razorpay's own
 *    order status must say `paid` for at least the configured price;
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
      return NextResponse.json({
        ok: true,
        plan: "pro",
        alreadyUpgraded: true,
        message: "PRO is already active on this account.",
      });
    }
    if (pay.status !== "created") {
      return NextResponse.json(
        { ok: false, error: "This order can no longer be paid." },
        { status: 409 }
      );
    }
    if (pay.amount < RAZORPAY.amountPaise) {
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
        plan: "pro",
        alreadyUpgraded: true,
        message: "PRO is already active on this account.",
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
