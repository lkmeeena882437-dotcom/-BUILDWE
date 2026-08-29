import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { createProOrder, getCheckoutPublicConfig } from "@/lib/payments/razorpay";
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
  } catch {
    return NextResponse.json(
      { error: "Could not create order" },
      { status: 500 }
    );
  }
}
