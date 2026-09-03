import type { Metadata } from "next";

/**
 * Metadata wrapper for /status. See app/pricing/layout.tsx for why this file
 * exists rather than an export on the page itself.
 *
 * Indexed deliberately: a public status page is useful in search when someone
 * is checking whether the service is down.
 */

export const metadata: Metadata = {
  title: "Status",
  description:
    "Live BUILDWE service status — chat and code models, image generation, voice, web search and storage, with what each one falls back to.",
  alternates: { canonical: "/status" },
  openGraph: {
    title: "Status — BUILDWE.ONLINE",
    description:
      "Live service status for chat, code, image, voice, web search and storage.",
    url: "/status",
    siteName: "BUILDWE.ONLINE",
    type: "website",
  },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
