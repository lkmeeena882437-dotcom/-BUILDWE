/**
 * Razorpay — REAL integration with automatic DEMO fallback.
 *
 * Live path (when RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET set and demo mode off):
 * 1. createProOrder() → POST https://api.razorpay.com/v1/orders (basic auth)
 * 2. Client opens Razorpay Checkout with order_id + NEXT_PUBLIC_RAZORPAY_KEY_ID
 * 3. verifyProPayment() → HMAC SHA256 of `order_id|payment_id` with key_secret
 * 4. Route then sets plan=pro in the DB for the logged-in user
 *
 * Demo path: fake order id + any filled payload verifies (for testing the flow).
 * NEVER trust client-only "payment success" without server verify.
 */

import crypto from "crypto";
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

function livePayments(): boolean {
  return razorpayConfigured() && !APP.demoMode;
}

/** Server: create Razorpay order — DEMO returns fake order id */
export async function createProOrder(userId: string): Promise<CheckoutOrder> {
  const receipt = `bw_pro_${userId.slice(0, 8)}_${Date.now()}`;

  if (livePayments()) {
    try {
      const auth = Buffer.from(
        `${RAZORPAY.keyId}:${RAZORPAY.keySecret}`
      ).toString("base64");
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: RAZORPAY.amountPaise,
          currency: RAZORPAY.currency,
          receipt,
          notes: { product: "buildwe_pro", userId },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.id) {
        return {
          id: String(data.id),
          amount: Number(data.amount) || RAZORPAY.amountPaise,
          currency: String(data.currency) || RAZORPAY.currency,
          receipt,
          demo: false,
        };
      }
      console.error("[bw] razorpay order failed", res.status, data);
    } catch (e) {
      console.error("[bw] razorpay order error", e);
    }
  }

  return {
    id: `order_demo_${Date.now()}`,
    amount: RAZORPAY.amountPaise,
    currency: RAZORPAY.currency,
    receipt,
    demo: true,
  };
}

/** Server: verify checkout signature (real HMAC check when live) */
export async function verifyProPayment(
  payload: VerifyPayload
): Promise<{ ok: boolean; demo: boolean; error?: string }> {
  if (livePayments()) {
    if (
      !payload.razorpay_order_id ||
      !payload.razorpay_payment_id ||
      !payload.razorpay_signature
    ) {
      return { ok: false, demo: false, error: "Missing payment fields" };
    }
    // demo orders can never verify against the live secret
    if (payload.razorpay_order_id.startsWith("order_demo_")) {
      return { ok: false, demo: false, error: "Demo order sent to live verify" };
    }
    const body = `${payload.razorpay_order_id}|${payload.razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", RAZORPAY.keySecret)
      .update(body)
      .digest("hex");
    if (expected !== payload.razorpay_signature) {
      return { ok: false, demo: false, error: "Invalid signature" };
    }
    return { ok: true, demo: false };
  }

  // DEMO: accept any payload that looks filled
  if (payload.razorpay_order_id && payload.razorpay_payment_id) {
    return { ok: true, demo: true };
  }
  return { ok: false, demo: true, error: "Missing payment fields" };
}
