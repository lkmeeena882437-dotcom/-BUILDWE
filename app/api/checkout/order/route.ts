import { NextRequest, NextResponse } from "next/server";
import { APP, RAZORPAY } from "@/lib/config";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import {
  CheckoutUnavailableError,
  createPackOrder,
  createProOrder,
  getCheckoutPublicConfig,
  livePayments,
  proAmountPaise,
  normalizeSeats,
} from "@/lib/payments/razorpay";
import { addPayment } from "@/lib/db/store";
import { formatPaise } from "@/lib/money";
import { CREDITS, creditPack } from "@/lib/config";

/** The formatting rule is `lib/money.ts`'s, so a page and this route cannot print two
 *  different versions of the same number. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...getCheckoutPublicConfig(),
    // The credit packs live in lib/config so the price, the credit amount and
    // this response can never disagree with what the server will honour.
    packs: CREDITS.packs.map((p) => ({
      id: p.id,
      label: p.label,
      credits: p.credits,
      paise: p.paise,
      displayAmount: formatPaise(p.paise, RAZORPAY.currency),
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        {
          error: "Log in first — a purchase needs an account, so the wallet survives a cleared cookie.",
          code: "LOGIN_REQUIRED",
        },
        { status: 401 }
      );
    }

    // Which product? `{ pack: "starter" | "value" }` buys credits; anything
    // else is the PRO subscription, so the existing client keeps working.
    const body = await req.json().catch(() => ({}));
    const packId = String(body?.pack || "").trim().toLowerCase();
    const pack = packId ? creditPack(packId) : undefined;
    if (packId && !pack) {
      return NextResponse.json(
        {
          error: `Unknown credit pack "${packId}".`,
          code: "UNKNOWN_PACK",
          packs: CREDITS.packs.map((p) => ({ id: p.id, label: p.label, credits: p.credits, paise: p.paise })),
        },
        { status: 400 }
      );
    }
    // Seats: the Business multiplier. Refused before any gateway call when the number
    // is not one we would honour, so nobody is ever charged for an entitlement the
    // server would not grant.
    const seats = normalizeSeats(body?.seats);
    if (seats.error) {
      return NextResponse.json(
        { error: seats.error, code: "BAD_SEATS", seatsMax: getCheckoutPublicConfig().seatsMax },
        { status: 400 }
      );
    }

    const productLabel = pack ? pack.label : RAZORPAY.planName;
    const productPaise = pack ? pack.paise : proAmountPaise(seats.seats);

    // The only answer when there is no gateway configured, in every environment.
    // It used to be possible to trade a "demo" order for a UI walk-through; that
    // is a fake success path on a money endpoint and it has been deleted from
    // lib/payments/razorpay.ts, so the honest 503 is now the only branch.
    if (!livePayments()) {
      return NextResponse.json(
        {
          error: pack
            ? "Checkout is not configured on this server, so credit packs cannot be sold yet."
            : "Checkout is not configured on this server, so PRO cannot be purchased yet.",
          code: "CHECKOUT_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    const order = pack
      ? await createPackOrder(session.userId, pack)
      : await createProOrder(session.userId, seats.seats);
    const pub = getCheckoutPublicConfig();

    try {
      addPayment({
        userId: session.userId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        status: "created",
        kind: pack ? "pack" : "pro",
        ...(pack ? { packId: pack.id, credits: pack.credits } : { seats: seats.seats }),
      });
    } catch {
      /* best effort */
    }

    const res = NextResponse.json({
      order,
      keyId: pub.keyId,
      planName: productLabel,
      displayAmount: pack
        ? formatPaise(pack.paise, RAZORPAY.currency)
        : formatPaise(productPaise, RAZORPAY.currency),
      /** A Business order also reports its unit price, so the receipt the UI draws
       *  says "₹500 × 3" and not a number it invented. */
      ...(pack
        ? { kind: "pack", packId: pack.id, credits: pack.credits }
        : { kind: "pro", seats: seats.seats, unitAmount: formatPaise(RAZORPAY.amountPaise, RAZORPAY.currency) }),
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
