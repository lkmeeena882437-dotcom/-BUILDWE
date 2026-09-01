"use client";

import { useEffect, useState } from "react";

export type ProPrice = {
  /** Server-owned label, e.g. "₹500" — never typed into the UI again. */
  label: string;
  period: string;
  amountPaise: number;
  currency: string;
  configured: boolean;
  /** false until the server has answered: nothing here may quote a price it made up. */
  loaded: boolean;
  /** the bounds the order endpoint enforces, so the stepper can't offer a refused number */
  seatsMin: number;
  seatsMax: number;
};

/**
 * Every field is the "not yet" value on purpose. This used to carry `label: "₹500"` and
 * `amountPaise: 50000` as a fallback, which meant a page could show a price for a moment
 * that the server had never agreed to — and audit A6 exists because a hand-written ₹500
 * and a config ₹500 drifted apart once already. Callers render `···` while `loaded` is
 * false; a blank price is a delay, a wrong price is a bug.
 */
const PENDING: ProPrice = {
  label: "",
  period: "month",
  amountPaise: 0,
  currency: "INR",
  configured: false,
  loaded: false,
  seatsMin: 1,
  seatsMax: 1,
};

/**
 * The price the UI quotes and the price the order endpoint charges must come
 * from ONE place. They used to be hand-written in three spots and had already
 * drifted ($5 in the app, ₹500 on /pricing, 50000 paise in config — audit A6),
 * so both pages now read the server's checkout config instead.
 */
export function useProPrice(): ProPrice {
  const [price, setPrice] = useState<ProPrice>(PENDING);
  useEffect(() => {
    let alive = true;
    fetch("/api/checkout/order", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j || typeof j.displayAmount !== "string") return;
        setPrice({
          label: j.displayAmount,
          period: "month",
          amountPaise: Number(j.amountPaise) || 0,
          currency: String(j.currency || "INR"),
          configured: Boolean(j.configured),
          loaded: true,
          seatsMin: Math.max(1, Number(j.seatsMin) || 1),
          seatsMax: Math.max(1, Number(j.seatsMax) || 1),
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
