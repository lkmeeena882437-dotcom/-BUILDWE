"use client";

import { useMemo } from "react";
import { Zap, Sparkles, Users } from "lucide-react";

/**
 * Tasteful house ads for FREE users only. PRO never sees these.
 * Set NEXT_PUBLIC_AD_HTML to override with real ad network markup.
 */

const HOUSE_ADS = [
  {
    icon: Zap,
    title: "Tired of limits?",
    body: "PRO unlocks higher limits, priority generation, and a calmer workspace.",
    cta: "Go PRO",
    href: "/pricing",
  },
  {
    icon: Sparkles,
    title: "BUILDWE works offline-demo",
    body: "Connect your own model key in Settings → API keys to unlock full-quality answers.",
    cta: "Add key",
    href: "#byok",
  },
  {
    icon: Users,
    title: "Building something cool?",
    body: "Invite a friend — BUILDWE stays free when the community grows.",
    cta: "Share BUILDWE",
    href: "/?share=1",
  },
];

export function AdSlot({
  plan,
  slot,
  onGoPro,
}: {
  plan: string;
  slot: "chat-empty" | "sidebar";
  onGoPro?: () => void;
}) {
  const ad = useMemo(() => {
    const idx = Math.floor(Date.now() / 60_000) % HOUSE_ADS.length; // rotates hourly-ish
    return HOUSE_ADS[idx];
  }, [slot]);

  const custom =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_AD_HTML;

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
        {ad.cta === "Go PRO" && onGoPro ? (
          <button
            type="button"
            onClick={onGoPro}
            className="shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {ad.cta}
          </button>
        ) : (
          <a
            href={ad.href}
            className="shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {ad.cta}
          </a>
        )}
      </div>
    </div>
  );
}
