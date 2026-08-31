/**
 * Razorpay — live-only money path.
 *
 * Flow (all server-side, nothing here trusts the client):
 * 1. createProOrder() → POST https://api.razorpay.com/v1/orders
 * 2. Client opens Razorpay Checkout with order_id + NEXT_PUBLIC_RAZORPAY_KEY_ID
 * 3. verifyProPayment() →
 *      a. HMAC SHA256 of `order_id|payment_id` with key_secret (timing-safe)
 *      b. GET /v1/orders/{id} and require status paid + amount_paid ≥ price
 *         (a valid signature alone says "someone signed", not "we were paid")
 * 4. Route grants plan=pro only for the order's own user and only once.
 *
 * HISTORY (audit C1, fixed 2026-08-31): the demo branch used to accept ANY
 * filled payload as a paid order and demo mode defaulted ON, so `curl
 * -d '{"razorpay_order_id":"x","razorpay_payment_id":"y"}'` bought PRO for
 * free on every deploy. Demo now (i) cannot exist in production, (ii) never
 * reaches this module through the public route, and (iii) does not grant a
 * paid plan — it only returns a canned order so the UI can be exercised.
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

export type VerifyResult = {
  ok: boolean;
  demo: boolean;
  error?: string;
  /** Server-side truth about the money, used for the ledger row. */
  amountPaid?: number;
  currency?: string;
  paymentId?: string;
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
    /** Only meaningful off-production; drives the UI's "not wired yet" notice. */
    demoMode: APP.demoMode,
  };
}

export function livePayments(): boolean {
  return razorpayConfigured();
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString("base64")}`;
}

/** Server: create a REAL Razorpay order. Throws instead of faking one. */
export async function createProOrder(userId: string): Promise<CheckoutOrder> {
  const receipt = `bw_pro_${userId.slice(0, 8)}_${Date.now()}`;

  if (!livePayments()) {
    throw new CheckoutUnavailableError(
      "Payments are not configured on this server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing), so no order can be created."
    );
  }

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: RAZORPAY.amountPaise,
      currency: RAZORPAY.currency,
      receipt,
      notes: { product: "buildwe_pro", userId },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !raw?.id) {
    const err = raw?.error as { description?: string } | undefined;
    const desc = err?.description || `HTTP ${res.status}`;
    throw new CheckoutUnavailableError(`Could not create the order (${desc}).`);
  }
  const data = raw;
  return {
    id: String(data.id),
    amount: Number(data.amount) || RAZORPAY.amountPaise,
    currency: String(data.currency) || RAZORPAY.currency,
    receipt,
    demo: false,
  };
}

export class CheckoutUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutUnavailableError";
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const ha = Buffer.from(a, "utf8");
  const hb = Buffer.from(b, "utf8");
  return ha.length === hb.length && crypto.timingSafeEqual(ha, hb);
}

/** Ask Razorpay, not the browser, whether this order was actually paid. */
async function fetchOrder(orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`,
      {
        headers: { Authorization: authHeader() },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** Server: verify the checkout signature, then confirm the money landed. */
export async function verifyProPayment(
  payload: VerifyPayload,
  expectedUserId: string
): Promise<VerifyResult> {
  if (!livePayments()) {
    return {
      ok: false,
      demo: false,
      error: "Payments are not configured on this server, so PRO cannot be activated.",
    };
  }

  const orderId = String(payload.razorpay_order_id || "");
  const paymentId = String(payload.razorpay_payment_id || "");
  const signature = String(payload.razorpay_signature || "");
  if (!orderId || !paymentId || !signature) {
    return { ok: false, demo: false, error: "Missing payment fields" };
  }
  // Demo orders are minted locally and must never be redeemable.
  if (orderId.startsWith("order_demo_")) {
    return { ok: false, demo: false, error: "Unknown order" };
  }

  const expected = crypto
    .createHmac("sha256", RAZORPAY.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  if (!/^[0-9a-f]{64}$/.test(signature) || !safeEqualHex(expected, signature)) {
    return { ok: false, demo: false, error: "Invalid signature" };
  }

  const order = await fetchOrder(orderId);
  if (!order) {
    return {
      ok: false,
      demo: false,
      error: "Could not confirm the payment with Razorpay. Try again in a moment.",
    };
  }
  const paid = Number(order.amount_paid || 0);
  const due = Number(order.amount_expected ?? RAZORPAY.amountPaise);
  const status = String(order.status || "");
  const notes = (order.notes || {}) as Record<string, unknown>;
  if (status !== "paid" || paid < due) {
    return { ok: false, demo: false, error: "That order is not paid yet." };
  }
  // The order must belong to the account redeeming it.
  if (String(notes.userId || "") !== expectedUserId) {
    return { ok: false, demo: false, error: "This order belongs to another account." };
  }

  return {
    ok: true,
    demo: false,
    amountPaid: paid,
    currency: String(order.currency || RAZORPAY.currency),
    paymentId,
  };
}

/** Dev-only canned order so the checkout UI can be walked without keys. Never grants a plan. */
export function demoCheckoutOrder(userId: string): CheckoutOrder {
  return {
    id: `order_demo_${crypto.randomBytes(6).toString("hex")}`,
    amount: RAZORPAY.amountPaise,
    currency: RAZORPAY.currency,
    receipt: `bw_demo_${userId.slice(0, 8)}_${Date.now()}`,
    demo: true,
  };
}
