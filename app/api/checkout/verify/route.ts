import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { verifyProPayment } from "@/lib/payments/razorpay";
import {
  addPayment,
  findPaymentByOrder,
  updatePayment,
  updateUser,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        { error: "Log in first — PRO upgrades need an account." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const orderId = String(body.razorpay_order_id || "");
    const result = await verifyProPayment({
      razorpay_order_id: orderId,
      razorpay_payment_id: String(body.razorpay_payment_id || ""),
      razorpay_signature: String(body.razorpay_signature || ""),
    });

    if (!result.ok) {
      try {
        const pay = findPaymentByOrder(orderId);
        if (pay) updatePayment(pay.id, { status: "failed" });
      } catch {
        /* */
      }
      return NextResponse.json(
        { ok: false, error: result.error || "Verification failed" },
        { status: 400 }
      );
    }

    // Upgrade the account (DB-backed plan; session reads it on next request)
    let alreadyPro = false;
    try {
      const updated = updateUser(session.userId, { plan: "pro" });
      alreadyPro = Boolean(updated);
      const pay = findPaymentByOrder(orderId);
      if (pay) {
        updatePayment(pay.id, {
          status: "paid",
          paymentId: String(body.razorpay_payment_id || "") || undefined,
        });
      } else {
        addPayment({
          userId: session.userId,
          orderId,
          paymentId: String(body.razorpay_payment_id || "") || undefined,
          amount: 0,
          currency: "INR",
          status: "paid",
          demo: result.demo,
        });
      }
    } catch (e) {
      console.error("[bw] checkout verify persist", e);
    }

    return NextResponse.json({
      ok: true,
      plan: "pro",
      demo: result.demo,
      upgraded: alreadyPro,
      message: result.demo
        ? "Demo payment verified — PRO activated for this account."
        : "Payment verified — PRO activated.",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

