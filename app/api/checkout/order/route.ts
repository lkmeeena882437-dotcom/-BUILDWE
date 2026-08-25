import { NextRequest, NextResponse } from "next/server";
import { createProOrder, getCheckoutPublicConfig } from "@/lib/payments/razorpay";

export async function GET() {
  return NextResponse.json(getCheckoutPublicConfig());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId =
      typeof body.userId === "string" && body.userId
        ? body.userId
        : "guest_demo";

    const order = await createProOrder(userId);
    const pub = getCheckoutPublicConfig();

    return NextResponse.json({
      order,
      keyId: pub.keyId,
      planName: pub.planName,
      displayAmount: pub.displayAmount,
      demo: order.demo,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not create order" },
      { status: 500 }
    );
  }
}
