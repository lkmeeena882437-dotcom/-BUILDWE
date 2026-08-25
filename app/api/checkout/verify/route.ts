import { NextRequest, NextResponse } from "next/server";
import { verifyProPayment } from "@/lib/payments/razorpay";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await verifyProPayment({
      razorpay_order_id: String(body.razorpay_order_id || ""),
      razorpay_payment_id: String(body.razorpay_payment_id || ""),
      razorpay_signature: String(body.razorpay_signature || "demo"),
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Verification failed" },
        { status: 400 }
      );
    }

    // TODO(prod): update subscriptions table / Supabase plan = pro
    return NextResponse.json({
      ok: true,
      plan: "pro",
      demo: result.demo,
      message: result.demo
        ? "Demo payment verified — set plan=pro in client/session"
        : "Payment verified",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
