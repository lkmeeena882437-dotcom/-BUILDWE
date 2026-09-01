"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, X } from "lucide-react";
import clsx from "clsx";
import { UpgradeButton } from "@/components/billing/UpgradeButton";
import { useProPrice } from "@/components/billing/useProPrice";
import { PackBuyButton, useBuyPack, useWallet } from "@/components/billing/CreditsUI";
import { SegmentedControl } from "@/lib/ui/SegmentedControl";
import { formatPaise } from "@/lib/money";

const AUDIENCE = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
] as const;

type Audience = (typeof AUDIENCE)[number]["value"];

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
  // Same server-owned price the checkout actually charges (audit A6). `loaded` says whether
  // it has answered at all: until then every price on this page renders as `···` rather
  // than a plausible-looking number the server never agreed to.
  const proPrice = useProPrice();
  // ...and the same server-owned credit table, so this page can't invent a price.
  const wallet = useWallet();
  const buyPack = useBuyPack();

  const [audience, setAudience] = useState<Audience>("personal");
  const [seats, setSeats] = useState(1);
  const business = audience === "business";
  // Personal is one seat by definition, so leaving Business cannot leave a stale count
  // hiding under a label that no longer mentions it.
  const seatCount = business ? Math.min(Math.max(seats, 1), Math.max(1, proPrice.seatsMax)) : 1;
  const perSeatPaise = proPrice.amountPaise;
  const totalLabel = proPrice.loaded ? formatPaise(perSeatPaise * seatCount, proPrice.currency) : "···";
  const unitLabel = proPrice.loaded ? formatPaise(perSeatPaise, proPrice.currency) : "···";
  // The per-seat base is the server's config value, quoted here for a total that has not
  // been bought yet. The number someone *has* been granted stays untouched (`proMonthly`),
  // because that one is only ever minted on the server.
  const baseMonthly = wallet.proMonthlyBase;
  const isPro = wallet.loaded && wallet.plan === "pro";
  const onFreePlan = wallet.loaded && wallet.signedIn && !isPro;
  // The packs the server sells, in the server's order — no tier is hard-coded here, so a
  // third pack appears in this grid without a second edit.
  const packs = wallet.packs;
  const rates = packs.map((p) => p.paise / Math.max(1, p.credits));
  const bestRate = rates.length ? Math.min(...rates) : 0;

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

        <div className="mt-8 flex flex-col items-center gap-2">
          <SegmentedControl
            items={AUDIENCE.map((a) => ({ value: a.value, label: a.label }))}
            value={audience}
            onChange={(v) => {
              setAudience(v);
              if (v === "personal") setSeats(1);
            }}
            ariaLabel="Who is PRO for?"
            dark={false}
          />
          <p className="max-w-md text-center text-[11px] leading-relaxed text-[#6B6560]">
            {business
              ? "Business is the same PRO, billed per seat: each seat is one more month's worth of credits on this account. It is a volume unit, not a login."
              : "One account, one monthly grant. Switch to Business to price more volume."}
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col rounded-3xl border border-[#E6E0D6] bg-white p-6 shadow-sm" data-tier="free">
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
            {/* Not a fake button: a signed-in free account is already on this tier, and saying
                so beats a "Continue free" that goes nowhere. A guest gets the real action. */}
            <button
              type="button"
              disabled={onFreePlan}
              onClick={() => router.push("/")}
              className="bw-tier__cta mt-auto flex h-11 w-full items-center justify-center rounded-2xl border border-[#E6E0D6] bg-[#F7F4EE] text-sm font-semibold disabled:cursor-default disabled:opacity-70"
            >
              {onFreePlan ? "You're on this plan" : "Continue free"}
            </button>
          </div>

          {packs
            .slice(0, 1)
            .map((p) => (
              <div key={p.id} className="flex flex-col rounded-3xl border border-[#E6E0D6] bg-white p-6 shadow-sm" data-tier={p.id}>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">
                  {p.label}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">{p.displayAmount}</span>
                  <span className="text-sm text-[#6B6560]">/ one time</span>
                </div>
                <p className="mt-2 text-sm text-[#6B6560]">
                  {wallet.loaded
                    ? `Top up the same wallet ${p.credits} times over, whenever it runs low.`
                    : "Top up the same wallet, whenever it runs low."}
                </p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {[
                    `${p.credits} credits, added the moment the payment clears`,
                    "Never expires while your account is open",
                    "Every tool, every model — nothing new to learn",
                    rates.length > 1 && bestRate > 0 && p.paise / Math.max(1, p.credits) === bestRate
                      ? "Best rate per credit of the two packs"
                      : `\u20b9${(p.paise / 100 / Math.max(1, p.credits)).toFixed(2)} per credit`,
                  ].map((x) => (
                    <li key={x} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <PackBuyButton block className="bw-tier__cta" pack={p} onBuy={() => buyPack(p.id)} signedIn={wallet.signedIn} />
                </div>
              </div>
            ))}

          <div className="relative flex flex-col rounded-3xl border-2 border-[#C45C26] bg-white p-6 shadow-md" data-tier="pro">
            <div className="absolute -top-3 right-4 rounded-full bg-[#C45C26] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Recommended
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
              PRO{business ? " · Business" : ""}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tabular-nums">{totalLabel}</span>
              <span className="text-sm text-[#6B6560]">
                / month{business && seatCount > 1 ? ` · ${seatCount} seats` : ""}
              </span>
            </div>
            <p className="mt-2 text-sm text-[#6B6560]">
              Higher limits, priority generation, calmer workspace
              {business ? `, and ${seatCount} × the monthly credit grant.` : "."}
            </p>

            {business && (
              <div className="mt-4 rounded-2xl border border-[#E6E0D6] bg-[#F7F4EE] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B6560]">
                    Seats
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-action="seats-minus"
                      aria-label="One seat fewer"
                      disabled={seatCount <= Math.max(1, proPrice.seatsMin)}
                      onClick={() => setSeats((n) => Math.max(1, n - 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#E6E0D6] bg-white disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[2ch] text-center text-lg font-semibold tabular-nums" aria-live="polite">
                      {seatCount}
                    </span>
                    <button
                      type="button"
                      data-action="seats-plus"
                      aria-label="One seat more"
                      disabled={!proPrice.loaded || seatCount >= proPrice.seatsMax}
                      onClick={() => setSeats((n) => Math.min(proPrice.seatsMax, n + 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#E6E0D6] bg-white disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-[#6B6560]">
                  {proPrice.loaded
                    ? `${unitLabel} per seat · ${formatPaise(perSeatPaise * seatCount, proPrice.currency)} total, and ${
                        (wallet.proMonthly / Math.max(1, wallet.proSeats)) * seatCount
                      } credits a month.`
                    : "Reading the server's price and seat bound…"}
                </p>
                {proPrice.loaded && seatCount >= proPrice.seatsMax && (
                  <p className="mt-1 text-[11px] text-[#8C2F22]">
                    {proPrice.seatsMax} seats is what one order can carry here — buy again for more.
                  </p>
                )}
              </div>
            )}

            <ul className="mt-6 space-y-2.5 text-sm">
              {[
                ...PRO,
                wallet.loaded
                  ? `${(business ? Math.round((wallet.proMonthly / Math.max(1, wallet.proSeats)) * seatCount) : wallet.proMonthly).toLocaleString()} credits every month`
                  : "Monthly credits",
              ].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-6">
              <UpgradeButton
                seats={seatCount}
                label={
                  business && seatCount > 1
                    ? `Buy ${seatCount} seats — ${totalLabel} →`
                    : business
                      ? `Buy 1 seat — ${totalLabel} →`
                      : `Upgrade to PRO — ${totalLabel} →`
                }
                description={
                  business
                    ? `BUILDWE PRO — ${seatCount} seat${seatCount > 1 ? "s" : ""} (monthly)`
                    : "BUILDWE PRO — monthly"
                }
              />
            </div>
            <p className="mt-3 text-center text-[11px] text-[#9C958C]">
              {isPro
                ? "PRO is already active here. A new order changes the seat count; the extra credits land with your next monthly grant."
                : proPrice.configured
                  ? "Secure Razorpay checkout · cancel any time"
                  : "Checkout stays disabled until live Razorpay keys are set on this server — we don't fake a success page."}
            </p>
          </div>

          {packs
            .slice(1)
            .map((p) => (
              <div key={p.id} className="flex flex-col rounded-3xl border border-[#E6E0D6] bg-white p-6 shadow-sm" data-tier={p.id}>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">
                  {p.label}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">{p.displayAmount}</span>
                  <span className="text-sm text-[#6B6560]">/ one time</span>
                </div>
                <p className="mt-2 text-sm text-[#6B6560]">
                  {wallet.loaded
                    ? `The bigger single top-up: ${p.credits} credits for ${p.displayAmount}.`
                    : "The bigger single top-up."}
                </p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {[
                    `${p.credits} credits, added the moment the payment clears`,
                    "Never expires while your account is open",
                    rates.length > 1 && bestRate > 0 && p.paise / Math.max(1, p.credits) === bestRate
                      ? "Cheapest per credit of the two packs"
                      : `Still ${formatPaise(p.paise, proPrice.currency || "INR")} one time`,
                    "No subscription, no renewal",
                  ].map((x) => (
                    <li key={x} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C26]" />
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <PackBuyButton block className="bw-tier__cta" pack={p} onBuy={() => buyPack(p.id)} signedIn={wallet.signedIn} />
                </div>
              </div>
            ))}

          {wallet.loaded && packs.length === 0 && (
            <div className="rounded-3xl border border-dashed border-[#E6E0D6] bg-white p-6 text-sm text-[#6B6560] sm:col-span-2 xl:col-span-2">
              Credit packs are not enabled on this server, so there is nothing to top up with —
              PRO is unaffected. This page shows that instead of a pack it cannot sell.
            </div>
          )}
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
              <p className="mt-2 text-sm text-[#6B6560]">
                {wallet.loaded && wallet.packs.length
                  ? `Packs are the two cards above — ${wallet.packs.map((p) => `${p.credits} credits for ${p.displayAmount}`).join(", ")}. They are one-time and they don't expire, so the honest way to use them is to buy one when a month's own grant runs out, not in advance.`
                  : "Pack prices load from the server; nothing here is typed in."}
              </p>
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
