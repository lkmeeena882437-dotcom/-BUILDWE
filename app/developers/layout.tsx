import type { Metadata } from "next";

/**
 * Metadata wrapper for /developers. See app/pricing/layout.tsx for why this
 * file exists rather than an export on the page itself.
 */

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Build on BUILDWE — API keys, endpoints and usage limits for chat, code, image, voice and web search from one workspace.",
  alternates: { canonical: "/developers" },
  openGraph: {
    title: "Developers — BUILDWE.ONLINE",
    description:
      "API keys, endpoints and usage limits for chat, code, image, voice and web search.",
    url: "/developers",
    siteName: "BUILDWE.ONLINE",
    type: "website",
  },
};

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
