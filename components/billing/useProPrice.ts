"use client";

import { useEffect, useState } from "react";

export type ProPrice = {
  /** Server-owned label, e.g. "₹500" — never typed into the UI again. */
  label: string;
  period: string;
  amountPaise: number;
  currency: string;
  configured: boolean;
};

const FALLBACK: ProPrice = {
  label: "₹500",
  period: "month",
  amountPaise: 50000,
  currency: "INR",
  configured: false,
};

/**
 * The price the UI quotes and the price the order endpoint charges must come
 * from ONE place. They used to be hand-written in three spots and had already
 * drifted ($5 in the app, ₹500 on /pricing, 50000 paise in config — audit A6),
 * so both pages now read the server's checkout config instead.
 */
export function useProPrice(): ProPrice {
  const [price, setPrice] = useState<ProPrice>(FALLBACK);
  useEffect(() => {
    let alive = true;
    fetch("/api/checkout/order", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j || typeof j.displayAmount !== "string") return;
        setPrice({
          label: j.displayAmount,
          period: "month",
          amountPaise: Number(j.amountPaise) || FALLBACK.amountPaise,
          currency: String(j.currency || FALLBACK.currency),
          configured: Boolean(j.configured),
        });
      })
      .catch(() => {
        /* keep the fallback label; the order endpoint re-checks the real amount */
      });
    return () => {
      alive = false;
    };
  }, []);
  return price;
}
