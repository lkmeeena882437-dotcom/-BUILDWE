import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { getCheckoutPublicConfig } from "@/lib/payments/razorpay";
import { TOOLS } from "@/lib/tools/registry";
import { CookieConsent } from "@/components/CookieConsent";
import { CreditsSheet } from "@/components/billing/CreditsUI";

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://buildwe.online";

/**
 * One source for the price. The marketing shell used to say "$5/mo" while
 * /pricing said "₹500" and the checkout endpoint charged 50000 paise — three
 * hand-typed copies of one number that had already drifted (audit A6). The
 * layout now reads the same server config the order endpoint uses.
 */
const PRICE = getCheckoutPublicConfig();
const PRO_PRICE_LABEL = `${PRICE.displayAmount}/mo`;
const PRO_PRICE_VALUE = (PRICE.amountPaise / 100).toFixed(2);

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "BUILDWE",
      url: SITE,
      logo: `${SITE}/icon-512.png`,
      contactPoint: [
        {
          "@type": "ContactPoint",
          email: "support@buildwe.online",
          contactType: "customer support",
        },
      ],
    },
    {
      "@type": "WebSite",
      name: "BUILDWE.ONLINE",
      url: SITE,
      description: `One free AI workspace — chat, code, vision, voice and ${TOOLS.length} purpose-built tools.`,
    },
    {
      "@type": "SoftwareApplication",
      name: "BUILDWE",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android, iOS (PWA)",
      description: `AI that understands the work. Chat, code, images and voice plus ${TOOLS.length} purpose-built generators in one free workspace, with web search and file understanding.`,
      url: SITE,
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: PRICE.currency },
        {
          "@type": "Offer",
          name: PRICE.planName || "PRO",
          price: PRO_PRICE_VALUE,
          priceCurrency: PRICE.currency,
        },
      ],
    },
  ],
};

export const metadata: Metadata = {
  // Without this, Next resolves every relative `alternates.canonical` (and any
  // relative OG image) against localhost:3000 — /tools was literally emitting
  // <link rel="canonical" href="/tools">, which is not a valid canonical and
  // tells crawlers nothing. SITE already reads NEXT_PUBLIC_APP_URL.
  metadataBase: new URL(SITE),
  title: {
    default: "BUILDWE.ONLINE — Build anything. Create everything.",
    template: "%s · BUILDWE",
  },
  description: `Chat, code, images, voice and ${TOOLS.length} purpose-built AI tools in one free workspace — web search, vision and file understanding included. Start free, PRO ${PRO_PRICE_LABEL}.`,
  applicationName: "BUILDWE.ONLINE",
  manifest: "/manifest.webmanifest",
  keywords: [
    "AI",
    "chat",
    "code",
    "image",
    "audio",
    "web search",
    "vision",
    "AI tools",
    "blog post generator",
    "BUILDWE",
  ],
  openGraph: {
    title: "BUILDWE.ONLINE",
    description: "Build anything. Create everything.",
    url: SITE,
    siteName: "BUILDWE.ONLINE",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F6F1" },
    { media: "(prefers-color-scheme: dark)", color: "#141311" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="antialiased"
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        {children}
        <PwaRegister />
        <CookieConsent />
        {/* The credit sheet is global: any runner can raise it when a 402
            INSUFFICIENT_CREDITS arrives mid-work. */}
        <CreditsSheet />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
