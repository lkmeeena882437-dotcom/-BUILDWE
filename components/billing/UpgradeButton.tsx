"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCtor = new (options: Record<string, unknown>) => {
  open: () => void;
};

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function UpgradeButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState("");

  const verify = async (payload: RazorpayResponse) => {
    const r = await fetch("/api/checkout/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || "Verification failed");
    return j as { demo?: boolean };
  };

  const start = async () => {
    setBusy(true);
    setNote("");
    try {
      // 1. must be logged in
      const meR = await fetch("/api/auth/me", { credentials: "include" });
      const me = await meR.json().catch(() => ({}));
      if (me?.kind !== "user") {
        setNote("Create a free account first — then upgrade in one tap.");
        setTimeout(() => router.push("/"), 900);
        return;
      }
      if (me?.plan === "pro") {
        setDone(true);
        setNote("You're already PRO ⚡");
        return;
      }

      // 2. create order (server signs it)
      const orderR = await fetch("/api/checkout/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const orderJ = await orderR.json().catch(() => ({}));
      if (!orderR.ok) {
        throw new Error(
          orderJ.code === "CHECKOUT_UNAVAILABLE"
            ? "Payments aren't enabled on this server yet, so PRO can't be bought right now."
            : orderJ.error || "Couldn't start checkout"
        );
      }

      const { order, keyId, demo } = orderJ as {
        order: { id: string; amount: number; currency: string };
        keyId: string;
        demo: boolean;
      };

      // 3a. Demo orders exist only off-production so the flow can be walked
      // through. They are NOT redeemable — the server refuses them in every
      // environment — so we say so instead of pretending the upgrade landed.
      if (demo) {
        setNote(
          "Demo order created, but no plan was granted: demo orders cannot be redeemed. Add real Razorpay keys to sell PRO."
        );
        return;
      }

      // 3b. LIVE Razorpay checkout
      const ok = await loadRazorpayScript();
      if (!ok || !window.Razorpay) throw new Error("Couldn't load Razorpay");

      const rzp = new window.Razorpay({
        key: keyId,
        amount: order.amount,
        currency: order.currency,
        name: "BUILDWE.ONLINE",
        description: "BUILDWE PRO — monthly",
        order_id: order.id,
        theme: { color: "#C45C26" },
        handler: async (response: RazorpayResponse) => {
          try {
            await verify(response);
            setDone(true);
            setNote("PRO activated ⚡ Welcome to the fast lane.");
            router.refresh();
          } catch (e) {
            setNote((e as Error).message);
          }
        },
        modal: {
          ondismiss: () => setNote("Checkout closed — no charge made."),
        },
      });
      rzp.open();
    } catch (e) {
      setNote((e as Error).message || "Checkout failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={busy || done}
        className={
          className ||
          "mt-8 flex h-11 w-full items-center justify-center rounded-2xl bg-[#C45C26] text-sm font-semibold text-white hover:bg-[#A84B1C] disabled:opacity-60"
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : null}
        {busy ? "Opening checkout…" : done ? "PRO active" : "Upgrade to PRO →"}
      </button>
      {note && <p className="mt-2 text-center text-[11px] text-[#9C958C]">{note}</p>}
    </div>
  );
}
