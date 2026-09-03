import type { Metadata } from "next";

/**
 * Metadata wrapper for /pricing.
 *
 * The page itself is a client component ("use client"), and a client component
 * cannot export `metadata` — Next only reads that export from server modules.
 * Without this file the route inherited the root layout's title and had no
 * canonical of its own, which for a page people actively search for ("buildwe
 * pricing") is the one page that most needs both.
 *
 * `canonical` and `openGraph.url` stay RELATIVE on purpose: the root layout
 * sets `metadataBase` from NEXT_PUBLIC_APP_URL, so Next resolves them against
 * the real deployment origin. Hardcoding an absolute URL here would make a
 * staging deploy advertise the production address — the exact bug fixed in #20.
 */

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "BUILDWE pricing — start free with daily chat, code, image and voice usage, or go PRO for higher limits and premium models. Credits never expire.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — BUILDWE.ONLINE",
    description:
      "Start free, upgrade to PRO for higher limits and premium models. Credits never expire.",
    url: "/pricing",
    siteName: "BUILDWE.ONLINE",
    type: "website",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
