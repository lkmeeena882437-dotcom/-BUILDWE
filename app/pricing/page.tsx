"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { UpgradeButton } from "@/components/billing/UpgradeButton";
import { useProPrice } from "@/components/billing/useProPrice";
import { CreditPacksBlock, useWallet } from "@/components/billing/CreditsUI";

const FREE = [
  "Full platform access for everyone",
  "Chat · Code · Image · Audio",
  "Fair daily creative limits",
  "Guest mode + free accounts",
  "Ad-supported experience",
];

const PRO = [
  "Everything in Free",
  "Higher creative limits",
  "Priority generation",
  "Calmer, fewer ads",
  "Built for daily heavy use",
];

export default function PricingPage() {
  const router = useRouter();
  // Same server-owned price the checkout actually charges (audit A6).
  const proPrice = useProPrice();
  // ...and the same server-owned credit table, so this page can't invent a price.
  const wallet = useWallet();

  return (
    <div className="min-h-[100dvh] bg-[#F7F4EE] text-[#14110F]">
      <header className="border-b border-[#E6E0D6] bg-[#FBFAF7]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#14110F] text-xs text-[#F7F4EE]">
              B
            </span>
            BUILDWE
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/about" className="text-[#6B6560] hover:text-[#14110F]">
              About
            </Link>
            <Link href="/privacy" className="text-[#6B6560] hover:text-[#14110F]">
              Privacy
            </Link>
            <Link href="/terms" className="text-[#6B6560] hover:text-[#14110F]">
              Terms
            </Link>
            <Link
              href="/"
              className="rounded-xl bg-[#14110F] px-3 py-1.5 font-medium text-[#F7F4EE]"
            >
              Open platform
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
            Simple economics
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Free so the world can create.
            <br />
            PRO when you need volume.
          </h1>
          <p className="mt-3 text-[#6B6560]">
            BUILDWE is free for every new user. We grow by helping more people build —
            Free is ad-supported. PRO removes friction for heavy daily use.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-[#E6E0D6] bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">
              Free
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">$0</span>
              <span className="text-sm text-[#6B6560]">/ forever</span>
            </div>
            <p className="mt-2 text-sm text-[#6B6560]">
              Default for everyone. Share BUILDWE. Create. Invite the next builder.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {[...FREE, wallet.loaded ? `${wallet.welcome} credits free at signup` : "Free credits at signup"].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-8 flex h-11 w-full items-center justify-center rounded-2xl border border-[#E6E0D6] bg-[#F7F4EE] text-sm font-semibold"
            >
              Continue free
            </button>
          </div>

          <div className="relative rounded-3xl border-2 border-[#C45C26] bg-white p-6 shadow-md">
            <div className="absolute -top-3 right-4 rounded-full bg-[#C45C26] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              For power users
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
              PRO
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">{proPrice.label}</span>
              <span className="text-sm text-[#6B6560]">/ month</span>
            </div>
            <p className="mt-2 text-sm text-[#6B6560]">
              Higher limits, priority generation, calmer workspace.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {[...PRO, wallet.loaded ? `${wallet.proMonthly.toLocaleString()} credits every month` : "Monthly credits"].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <UpgradeButton />
            <p className="mt-3 text-center text-[11px] text-[#9C958C]">
              {proPrice.configured
                ? "Secure Razorpay checkout · cancel any time"
                : "Checkout stays disabled until live Razorpay keys are set on this server — we don't fake a success page."}
            </p>
          </div>
        </div>

        <section className="mt-10 rounded-3xl border border-[#E6E0D6] bg-white p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-[240px] flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">
                Credits
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                Pay for what the server actually did.
              </h2>
              <p className="mt-2 text-sm text-[#6B6560]">
                One generation of a tool is one credit. A heavy, multi-section tool is
                two. Chat is free, because the point of chat is to get you to the rest.
                If a run produces nothing, the credit comes back on its own — no
                support ticket, no &quot;contact us&quot;.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-[#9C958C]">Your balance</p>
              <p className="text-3xl font-semibold tabular-nums">
                {wallet.loaded ? wallet.balance : "···"}
              </p>
              {wallet.loaded && !wallet.signedIn ? (
                <p className="text-[11px] text-[#6B6560]">guest wallet · cookie only</p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ul className="space-y-1.5 text-sm">
              {[
                ["Chat", wallet.costs.chat],
                ["Any AI tool (blog, email, script…)", wallet.costs.tool],
                ["Heavy tool (long, multi-section)", 2],
                ["Image", wallet.costs.image],
                ["Voice-over", wallet.costs.audio],
                ["Transcription", wallet.costs.transcribe],
                ["Read an image", wallet.costs.vision],
                ["Each live lane in a comparison", wallet.costs.compareLane],
                ["Agent run (multi-file code job)", wallet.costs.agent],
              ].map(([label, n]) => (
                <li
                  key={String(label)}
                  className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F4EE] px-3 py-2"
                >
                  <span className="text-[#3A3630]">{label}</span>
                  <span className="font-medium tabular-nums">
                    {Number(n) === 0
                      ? "free"
                      : `${n} credit${Number(n) === 1 ? "" : "s"}`}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">
                Top up
              </div>
              <div className="mt-2">
                <CreditPacksBlock />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-[#9C958C]">
                Packs are one-time, not a subscription, and don&apos;t expire while your
                account is open. {wallet.welcome} credits land in every new account so
                quality can be judged before money moves
                {wallet.plan === "pro"
                  ? `, and PRO adds ${wallet.proMonthly.toLocaleString()} credits a month.`
                  : "."}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-14 overflow-hidden rounded-3xl border border-[#E6E0D6] bg-white">
          <div className="border-b border-[#E6E0D6] px-4 py-3 text-sm font-semibold">
            At a glance
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F7F4EE] text-xs uppercase tracking-wide text-[#6B6560]">
              <tr>
                <th className="px-4 py-3 font-medium">Capability</th>
                <th className="px-4 py-3 font-medium">Free</th>
                <th className="px-4 py-3 font-medium">PRO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E0D6]">
              {[
                ["Chat workspace", true, true],
                ["Code canvas", "Fair limits", "Higher volume"],
                ["Image generation", "Fair limits", "Higher volume"],
                ["Audio / voice", "Fair limits", "Higher volume"],
                ["Ads", "Yes", "Fewer"],
                ["Priority speed", false, true],
              ].map(([feat, free, pro]) => (
                <tr key={String(feat)}>
                  <td className="px-4 py-3 font-medium">{feat}</td>
                  <td className="px-4 py-3 text-[#6B6560]">
                    {free === true ? (
                      <Check className="h-4 w-4 text-[#C45C26]" />
                    ) : free === false ? (
                      <X className="h-4 w-4 text-[#E6E0D6]" />
                    ) : (
                      free
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6B6560]">
                    {pro === true ? (
                      <Check className="h-4 w-4 text-[#C45C26]" />
                    ) : pro === false ? (
                      <X className="h-4 w-4 text-[#E6E0D6]" />
                    ) : (
                      pro
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-center text-xs text-[#9C958C]">
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
