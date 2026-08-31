"use client";

import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles, Users, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Tasteful house ads for FREE users only. PRO never sees these.
 * Set NEXT_PUBLIC_AD_HTML to override with real ad network markup.
 *
 * REWRITTEN (2026-08-31) because two CTAs went nowhere:
 *  • "Add key" pointed at `#byok`, and no element with that id exists — BYOK is a modal
 *    the host owns, so the ad now asks the host to open it (same shape as "Go PRO").
 *  • "Share BUILDWE" pointed at `/?share=1`, which page.tsx never reads. It copies the
 *    site link through the same clipboard call the rest of the app uses.
 * The pick also used to be `Math.floor(Date.now() / 60_000) % n` inside a `useMemo` keyed
 * on `slot`: the server and the client could compute different ads (a hydration mismatch),
 * and both slots on one screen showed the same one. It is deterministic per slot now.
 */

type HouseAd = {
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  /** An action the host can perform. Preferred over `href` when the host offers it. */
  action?: "gopro" | "byok" | "copylink";
  /** A real route, used only when there is no in-app action for this ad. */
  href?: string;
};

const HOUSE_ADS: HouseAd[] = [
  {
    icon: Zap,
    title: "Tired of limits?",
    body: "PRO unlocks higher limits, priority generation, and a calmer workspace.",
    cta: "Go PRO",
    action: "gopro",
    href: "/pricing",
  },
  {
    icon: Sparkles,
    title: "No provider key? BUILDWE still computes",
    body: "Arithmetic, unit and date conversions and a real starting structure run without a model. Add your own key for full answers.",
    cta: "Add key",
    action: "byok",
  },
  {
    icon: Users,
    title: "Building something cool?",
    body: "Invite a friend — BUILDWE stays free when the community grows.",
    cta: "Copy link",
    action: "copylink",
  },
];

/** Per-slot offset so the sidebar and the empty state don't echo each other. */
function pick(slot: "chat-empty" | "sidebar", rotation: number): HouseAd {
  const base = slot === "sidebar" ? 0 : 1;
  return HOUSE_ADS[(base + rotation) % HOUSE_ADS.length];
}

export function AdSlot({
  plan,
  slot,
  onGoPro,
  onAddKey,
}: {
  plan: string;
  slot: "chat-empty" | "sidebar";
  onGoPro?: () => void;
  onAddKey?: () => void;
}) {
  // Rotation is a client-side cadence, never a render-time clock: the first paint is
  // deterministic, so server and client agree, and the ad still changes if someone
  // leaves the workspace open for an hour.
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    const every = 30 * 60_000;
    const t = setInterval(() => setRotation((r) => r + 1), every);
    return () => clearInterval(t);
  }, []);
  const ad = useMemo(() => pick(slot, rotation), [slot, rotation]);
  const [copied, setCopied] = useState(false);

  const custom = typeof process !== "undefined" && process.env.NEXT_PUBLIC_AD_HTML;

  if (plan === "pro") return null;

  if (custom) {
    return (
      <div className="rounded-2xl border border-dashed p-3 text-center" data-ad-slot={slot}>
        <div className="mb-1 text-[9px] uppercase tracking-widest opacity-40">Sponsored</div>
        <div dangerouslySetInnerHTML={{ __html: process.env.NEXT_PUBLIC_AD_HTML! }} />
      </div>
    );
  }

  const Icon = ad.icon;
  const run =
    ad.action === "gopro" ? onGoPro : ad.action === "byok" ? onAddKey : undefined;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Denied or no clipboard (http, old Safari): say nothing rather than pretend.
    }
  }

  return (
    <div
      className="rounded-2xl border border-dashed px-3 py-2.5"
      data-ad-slot={slot}
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "var(--secondary)", color: "var(--muted)" }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold">{ad.title}</span>
            <span
              className="rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-wide"
              style={{ background: "var(--secondary)", color: "var(--soft)" }}
            >
              Sponsored
            </span>
          </div>
          <p className="truncate text-[11px]" style={{ color: "var(--muted)" }}>
            {ad.body}
          </p>
        </div>
        {run ? (
          <button
            type="button"
            onClick={run}
            className="shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {ad.cta}
          </button>
        ) : ad.action === "copylink" ? (
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {copied && <Check className="h-3 w-3" aria-hidden />}
            {copied ? "Copied" : ad.cta}
          </button>
        ) : ad.href ? (
          <a
            href={ad.href}
            className="shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {ad.cta}
          </a>
        ) : null}
      </div>
    </div>
  );
}
