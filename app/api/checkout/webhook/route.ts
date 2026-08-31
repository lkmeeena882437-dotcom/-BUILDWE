import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { RAZORPAY } from "@/lib/config";
import {
  addPayment,
  findPaymentByOrder,
  findUserById,
  getBalance,
  updatePayment,
  updateUser,
} from "@/lib/db/store";
import { creditPack } from "@/lib/config";
import { topUpCredits } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/webhook — Razorpay server-to-server payment events.
 *
 * WHY (audit V6): PRO used to activate ONLY through the browser round-trip to
 * /api/checkout/verify. If the customer closed the tab, lost signal, or the
 * redirect failed after paying, the money was captured but the account stayed
 * on Free — a silent paid-but-not-upgraded bug with no recovery path.
 *
 * Razorpay retries webhooks, so this is the authoritative upgrade path;
 * /api/checkout/verify stays as the fast interactive one. Both are idempotent,
 * so whichever lands first wins and the second is a no-op.
 *
 * Setup: Razorpay Dashboard → Settings → Webhooks
 *   URL:    https://YOUR_DOMAIN/api/checkout/webhook
 *   Secret: RAZORPAY_WEBHOOK_SECRET  (already in .env.example)
 *   Events: payment.captured, payment.failed, subscription.charged,
 *           subscription.cancelled
 *
 * Security: the raw body is HMAC-SHA256 verified against x-razorpay-signature
 * BEFORE it is parsed. An unsigned or mismatched request never touches the DB.
 */

function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

type RazorpayEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  notes?: Record<string, string>;
};

export async function POST(req: NextRequest) {
  // Read the RAW body — re-serialising JSON would change bytes and break HMAC.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";

  if (!RAZORPAY.webhookSecret) {
    // Not configured yet. Acknowledge so Razorpay doesn't hammer retries, but
    // never trust an unverifiable payload.
    console.warn("[bw] webhook received but RAZORPAY_WEBHOOK_SECRET is unset");
    return NextResponse.json({ ok: true, ignored: "not_configured" });
  }

  const expected = crypto
    .createHmac("sha256", RAZORPAY.webhookSecret)
    .update(raw)
    .digest("hex");

  if (!timingSafeEqualHex(signature, expected)) {
    console.error("[bw] webhook signature mismatch");
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }

  let event: { event?: string; payload?: Record<string, { entity?: RazorpayEntity }> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad payload" }, { status: 400 });
  }

  const kind = String(event?.event || "");
  const entity: RazorpayEntity =
    event?.payload?.payment?.entity ||
    event?.payload?.subscription?.entity ||
    {};

  // userId travels in order notes (set in createProOrder).
  const userId = String(entity?.notes?.userId || "");
  const orderId = String(entity?.order_id || "");
  const paymentId = String(entity?.id || "");

  try {
    if (kind === "payment.captured" || kind === "subscription.charged") {
      if (!userId) {
        console.error("[bw] webhook captured without userId note", orderId);
        return NextResponse.json({ ok: true, ignored: "no_user" });
      }
      const user = findUserById(userId);
      if (!user) {
        console.error("[bw] webhook for unknown user", userId);
        return NextResponse.json({ ok: true, ignored: "unknown_user" });
      }

      const existing = orderId ? findPaymentByOrder(orderId) : null;

      // Which product was this? A credit pack must NOT flip the account to PRO.
      const productNote = String(entity?.notes?.product || "");
      const isPack =
        existing?.kind === "pack" || productNote.startsWith("buildwe_credits:");

      if (isPack) {
        const packId =
          existing?.packId || productNote.split(":")[1] || "";
        const credits =
          existing?.credits || creditPack(packId)?.credits || 0;
        if (credits > 0) {
          // Keyed on the payment id, so a webhook re-delivery (Razorpay
          // retries) and the interactive verify route cannot both pay out.
          const grant = topUpCredits({
            userId,
            credits,
            refId: paymentId || existing?.id || `webhook_${orderId}`,
          });
          if (!grant.ok) console.error("[bw] webhook pack grant rejected", grant);
        } else {
          console.error("[bw] pack paid but credits unknown", orderId, packId);
        }
        if (existing && existing.status !== "paid") {
          updatePayment(existing.id, {
            status: "paid",
            paymentId: paymentId || undefined,
          });
        }
        return NextResponse.json({
          ok: true,
          kind: "pack",
          credits,
          balance: getBalance(userId),
        });
      }

      // Idempotent: re-delivery of the same event is harmless.
      if (user.plan !== "pro") updateUser(userId, { plan: "pro" });

      if (existing) {
        if (existing.status !== "paid") {
          updatePayment(existing.id, { status: "paid", paymentId: paymentId || undefined });
        }
      } else {
        addPayment({
          userId,
          orderId: orderId || `webhook_${paymentId}`,
          paymentId: paymentId || undefined,
          amount: Number(entity?.amount) || 0,
          currency: String(entity?.currency || "INR"),
          status: "paid",
          demo: false,
        });
      }
      return NextResponse.json({ ok: true, upgraded: true });
    }

    if (kind === "payment.failed") {
      const existing = orderId ? findPaymentByOrder(orderId) : null;
      if (existing && existing.status === "created") {
        updatePayment(existing.id, { status: "failed" });
      }
      return NextResponse.json({ ok: true });
    }

    if (kind === "subscription.cancelled" || kind === "subscription.halted") {
      // Subscription ended — return the account to Free.
      if (userId && findUserById(userId)) updateUser(userId, { plan: "free" });
      return NextResponse.json({ ok: true, downgraded: true });
    }

    // Unhandled but validly signed event — acknowledge, don't error.
    return NextResponse.json({ ok: true, ignored: kind || "unknown_event" });
  } catch (e) {
    console.error("[bw] webhook handler", e);
    // 500 makes Razorpay retry, which is what we want for a transient fault.
    return NextResponse.json({ ok: false, error: "Handler error" }, { status: 500 });
  }
}
