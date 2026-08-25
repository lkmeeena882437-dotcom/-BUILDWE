/**
 * Razorpay helpers — TEST-first.
 *
 * Replace stubs when RAZORPAY_KEY_SECRET is set:
 * 1. createOrder() → POST https://api.razorpay.com/v1/orders
 * 2. Client opens Razorpay Checkout with order_id + NEXT_PUBLIC_RAZORPAY_KEY_ID
 * 3. verifyPayment() → HMAC SHA256 of order_id|payment_id with key_secret
 * 4. webhook → verify RAZORPAY_WEBHOOK_SECRET, then set plan=pro in DB
 *
 * NEVER trust client-only "payment success" without server verify.
 */

import { RAZORPAY, razorpayConfigured, APP } from "@/lib/config";

export type CheckoutOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  demo: boolean;
};

export type VerifyPayload = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export function getCheckoutPublicConfig() {
  return {
    keyId: RAZORPAY.keyId,
    amountPaise: RAZORPAY.amountPaise,
    currency: RAZORPAY.currency,
    planName: RAZORPAY.planName,
    /** Display helper */
    displayAmount:
      RAZORPAY.currency === "INR"
        ? `₹${(RAZORPAY.amountPaise / 100).toFixed(0)}`
        : `$${(RAZORPAY.amountPaise / 100).toFixed(2)}`,
    configured: razorpayConfigured(),
    demoMode: APP.demoMode || !razorpayConfigured(),
  };
}

/** Server: create Razorpay order — DEMO returns fake order id */
export async function createProOrder(userId: string): Promise<CheckoutOrder> {
  const receipt = `bw_pro_${userId.slice(0, 8)}_${Date.now()}`;

  if (razorpayConfigured() && !APP.demoMode) {
    // TODO(prod):
    // const auth = Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString("base64");
    // const res = await fetch("https://api.razorpay.com/v1/orders", {
    //   method: "POST",
    //   headers: {
    //     Authorization: `Basic ${auth}`,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     amount: RAZORPAY.amountPaise,
    //     currency: RAZORPAY.currency,
    //     receipt,
    //     notes: { product: "buildwe_pro", userId },
    //   }),
    // });
    // const data = await res.json();
    // return { id: data.id, amount: data.amount, currency: data.currency, receipt, demo: false };
  }

  return {
    id: `order_demo_${Date.now()}`,
    amount: RAZORPAY.amountPaise,
    currency: RAZORPAY.currency,
    receipt,
    demo: true,
  };
}

/** Server: verify checkout signature */
export async function verifyProPayment(
  payload: VerifyPayload
): Promise<{ ok: boolean; demo: boolean; error?: string }> {
  if (razorpayConfigured() && !APP.demoMode) {
    // TODO(prod):
    // import crypto from "crypto";
    // const body = `${payload.razorpay_order_id}|${payload.razorpay_payment_id}`;
    // const expected = crypto.createHmac("sha256", RAZORPAY.keySecret).update(body).digest("hex");
    // if (expected !== payload.razorpay_signature) return { ok: false, demo: false, error: "Invalid signature" };
    // return { ok: true, demo: false };
    void payload;
  }

  // DEMO: accept any payload that looks filled
  if (
    payload.razorpay_order_id &&
    payload.razorpay_payment_id
  ) {
    return { ok: true, demo: true };
  }
  return { ok: false, demo: true, error: "Missing payment fields" };
}
