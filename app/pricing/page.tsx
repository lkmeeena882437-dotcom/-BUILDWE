"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

const FREE = [
  "Unlimited normal AI Chat (fair use)",
  "Q&A, ideas, writing help",
  "Limited Code builds / day",
  "Limited Image generations / day",
  "Limited Audio generations / day",
  "Standard model routing",
];

const PRO = [
  "Everything in Free",
  "Priority AI routing",
  "Higher Code limits",
  "No hard daily Image cap",
  "No hard daily Audio cap",
  "Faster generation",
  "Stronger models when available",
  "Skills-tuned workspace",
];

export default function PricingPage() {
  const router = useRouter();

  return (
    <div className="min-h-[100dvh] bg-[#F8F6F1] text-[#1C1C1C]">
      <header className="border-b border-[#E5E1D8] bg-[#FDFCFA]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1C1C1C] text-xs text-[#F8F6F1]">
              B
            </span>
            BUILDWE
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/about" className="text-[#737373] hover:text-[#1C1C1C]">
              About
            </Link>
            <Link href="/privacy" className="text-[#737373] hover:text-[#1C1C1C]">
              Privacy
            </Link>
            <Link href="/terms" className="text-[#737373] hover:text-[#1C1C1C]">
              Terms
            </Link>
            <Link
              href="/"
              className="rounded-lg bg-[#1C1C1C] px-3 py-1.5 font-medium text-[#F8F6F1]"
            >
              Open app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
            Simple pricing
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Powerful AI. One clear upgrade.
          </h1>
          <p className="mt-3 text-[#737373]">
            Everyone starts on <strong className="text-[#1C1C1C]">Free</strong>.
            PRO unlocks only after payment is verified.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {/* FREE */}
          <div className="rounded-2xl border border-[#E5E1D8] bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#A3A3A3]">
              Free
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">$0</span>
              <span className="text-sm text-[#737373]">/ forever</span>
            </div>
            <p className="mt-2 text-sm text-[#737373]">
              Default plan for every new user. Chat first — create when you need.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {FREE.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-8 flex h-11 w-full items-center justify-center rounded-xl border border-[#E5E1D8] bg-[#F8F6F1] text-sm font-semibold"
            >
              Continue free
            </button>
          </div>

          {/* PRO */}
          <div className="relative rounded-2xl border-2 border-[#C45C26] bg-white p-6 shadow-md">
            <div className="absolute -top-3 right-4 rounded-full bg-[#C45C26] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Recommended
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
              BUILDWE PRO
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">$5</span>
              <span className="text-sm text-[#737373]">/ month</span>
            </div>
            <p className="mt-2 text-sm text-[#737373]">
              Charged via secure checkout (Razorpay). INR equivalent shown at pay.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {PRO.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => router.push("/?checkout=pro")}
              className="mt-8 flex h-11 w-full items-center justify-center rounded-xl bg-[#C45C26] text-sm font-semibold text-white hover:bg-[#A84B1C]"
            >
              Switch to PRO →
            </button>
            <p className="mt-3 text-center text-[11px] text-[#A3A3A3]">
              Opens checkout: amount · method · agree to Terms & Privacy
            </p>
          </div>
        </div>

        {/* Comparison */}
        <div className="mt-14 overflow-hidden rounded-2xl border border-[#E5E1D8] bg-white">
          <div className="border-b border-[#E5E1D8] px-4 py-3 text-sm font-semibold">
            Clear comparison
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F8F6F1] text-xs uppercase tracking-wide text-[#737373]">
              <tr>
                <th className="px-4 py-3 font-medium">Feature</th>
                <th className="px-4 py-3 font-medium">Free</th>
                <th className="px-4 py-3 font-medium">PRO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E1D8]">
              {[
                ["AI Chat (normal use)", true, true],
                ["Priority models", false, true],
                ["Code workspace + canvas", "Limited", "Higher"],
                ["Image / day hard cap", "Yes (hidden)", "No"],
                ["Audio / day hard cap", "Yes (hidden)", "No"],
                ["BYOK your models", "Soon", "Soon"],
              ].map(([feat, free, pro]) => (
                <tr key={String(feat)}>
                  <td className="px-4 py-3 font-medium">{feat}</td>
                  <td className="px-4 py-3 text-[#737373]">
                    {free === true ? (
                      <Check className="h-4 w-4 text-[#C45C26]" />
                    ) : free === false ? (
                      <X className="h-4 w-4 text-[#D4CFC4]" />
                    ) : (
                      free
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#737373]">
                    {pro === true ? (
                      <Check className="h-4 w-4 text-[#C45C26]" />
                    ) : pro === false ? (
                      <X className="h-4 w-4 text-[#D4CFC4]" />
                    ) : (
                      pro
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-center text-xs text-[#A3A3A3]">
          By upgrading you agree to our{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
