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
 * HISTORY (audit C1, fixed 2026-08-31): a demo branch used to accept ANY
 * filled payload as a paid order and the switch defaulted ON, so `curl
 * -d '{"razorpay_order_id":"x","razorpay_payment_id":"y"}'` bought PRO for
 * free on every deploy. Demo now (i) cannot exist in production, (ii) never
 * reaches this module through the public route, and (iii) does not grant a
 * paid plan — it only returns a canned order so the UI can be exercised.
 */

import crypto from "crypto";
import { safeEqual } from "@/lib/crypto";
import { RAZORPAY, razorpayConfigured, APP } from "@/lib/config";

export type CheckoutOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
};

export type VerifyPayload = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type VerifyResult = {
  ok: boolean;
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
  };
}

export function livePayments(): boolean {
  return razorpayConfigured();
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString("base64")}`;
}

/**
 * One place that talks to Razorpay's order API. Amount, receipt prefix and the
 * product note are parameters so PRO and credit packs can never drift into two
 * different (and one day inconsistent) payment code paths.
 */
async function createOrderFor(
  userId: string,
  opts: { amountPaise: number; receiptPrefix: string; product: string }
): Promise<CheckoutOrder> {
  const receipt = `${opts.receiptPrefix}_${userId.slice(0, 8)}_${Date.now()}`;

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
      amount: opts.amountPaise,
      currency: RAZORPAY.currency,
      receipt,
      notes: { product: opts.product, userId },
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
    amount: Number(data.amount) || opts.amountPaise,
    currency: String(data.currency) || RAZORPAY.currency,
    receipt,
  };
}

/** Server: create a REAL Razorpay order. Throws instead of faking one. */
export async function createProOrder(userId: string): Promise<CheckoutOrder> {
  return createOrderFor(userId, {
    amountPaise: RAZORPAY.amountPaise,
    receiptPrefix: "bw_pro",
    product: "buildwe_pro",
  });
}

/**
 * A credit pack is the same order API with a different amount and note. There
 * is deliberately no "free sample pack" path: the only way credits appear is a
 * verified payment or the signup/welcome grant.
 */
export async function createPackOrder(
  userId: string,
  pack: { id: string; paise: number; credits: number }
): Promise<CheckoutOrder> {
  return createOrderFor(userId, {
    amountPaise: pack.paise,
    receiptPrefix: `bw_credits_${pack.id}`,
    product: `buildwe_credits:${pack.id}:${pack.credits}`,
  });
}

export class CheckoutUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutUnavailableError";
  }
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
      error: "Payments are not configured on this server, so PRO cannot be activated.",
    };
  }

  const orderId = String(payload.razorpay_order_id || "");
  const paymentId = String(payload.razorpay_payment_id || "");
  const signature = String(payload.razorpay_signature || "");
  if (!orderId || !paymentId || !signature) {
    return { ok: false, error: "Missing payment fields" };
  }
  // Refused by shape, not because anything still mints these: the local demo order
  // was deleted, so this line exists only so that an id from an older build reads as
  // "Unknown order" instead of being sent to the gateway.
  if (orderId.startsWith("order_demo_")) {
    return { ok: false, error: "Unknown order" };
  }

  const expected = crypto
    .createHmac("sha256", RAZORPAY.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  if (!/^[0-9a-f]{64}$/.test(signature) || !safeEqual(expected, signature)) {
    return { ok: false, error: "Invalid signature" };
  }

  const order = await fetchOrder(orderId);
  if (!order) {
    return {
      ok: false,
      error: "Could not confirm the payment with Razorpay. Try again in a moment.",
    };
  }
  const paid = Number(order.amount_paid || 0);
  const due = Number(order.amount_expected ?? RAZORPAY.amountPaise);
  const status = String(order.status || "");
  const notes = (order.notes || {}) as Record<string, unknown>;
  if (status !== "paid" || paid < due) {
    return { ok: false, error: "That order is not paid yet." };
  }
  // The order must belong to the account redeeming it.
  if (String(notes.userId || "") !== expectedUserId) {
    return { ok: false, error: "This order belongs to another account." };
  }

  return {
    ok: true,
    amountPaid: paid,
    currency: String(order.currency || RAZORPAY.currency),
    paymentId,
  };
}

/**
 * `demoCheckoutOrder` used to live here. Deleted on 2026-08-31 rather than left
 * "off by default": a code path that manufactures a plausible-looking order id is
 * one misconfigured env var away from a customer being told their payment worked.
 * Unconfigured checkout now answers 503 CHECKOUT_UNAVAILABLE, which is what it is.
 * The `order_demo_` refusal in verifyPayment stays so any order id minted by an
 * older build still comes back as "Unknown order" instead of being chased at the
 * gateway.
 */
