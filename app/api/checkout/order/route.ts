import { NextRequest, NextResponse } from "next/server";
import { APP, RAZORPAY } from "@/lib/config";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import {
  CheckoutUnavailableError,
  createProOrder,
  demoCheckoutOrder,
  getCheckoutPublicConfig,
  livePayments,
} from "@/lib/payments/razorpay";
import { addPayment } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getCheckoutPublicConfig());
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        { error: "Log in first — PRO upgrades need an account." },
        { status: 401 }
      );
    }

    // Off-production only, and the result can never be redeemed for a plan:
    // /api/checkout/verify refuses demo orders in every environment.
    if (!livePayments()) {
      if (!APP.demoMode) {
        return NextResponse.json(
          {
            error:
              "Checkout is not configured on this server, so PRO cannot be purchased yet.",
            code: "CHECKOUT_UNAVAILABLE",
          },
          { status: 503 }
        );
      }
      const demo = demoCheckoutOrder(session.userId);
      return NextResponse.json({
        order: demo,
        keyId: "",
        planName: RAZORPAY.planName,
        displayAmount: `₹${(RAZORPAY.amountPaise / 100).toFixed(0)}`,
        demo: true,
        note: "Demo checkout — the UI can be walked through, but no plan is granted.",
      });
    }

    const order = await createProOrder(session.userId);
    const pub = getCheckoutPublicConfig();

    try {
      addPayment({
        userId: session.userId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        status: "created",
        demo: order.demo,
      });
    } catch {
      /* best effort */
    }

    const res = NextResponse.json({
      order,
      keyId: pub.keyId,
      planName: pub.planName,
      displayAmount: pub.displayAmount,
      demo: order.demo,
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    if (e instanceof CheckoutUnavailableError) {
      return NextResponse.json({ error: e.message, code: "CHECKOUT_UNAVAILABLE" }, { status: 503 });
    }
    console.error("[bw] checkout order", e);
    return NextResponse.json(
      { error: "Could not create order right now. You have not been charged." },
      { status: 502 }
    );
  }
}
