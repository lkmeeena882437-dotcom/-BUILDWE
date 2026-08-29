import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { CookieConsent } from "@/components/CookieConsent";

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://buildwe.online";

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
      description: "One free AI workspace — Chat, Code, Vision, Voice.",
    },
    {
      "@type": "SoftwareApplication",
      name: "BUILDWE",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android, iOS (PWA)",
      description:
        "AI that understands the work. Chat, code, images, and voice in one free workspace with web search and file understanding.",
      url: SITE,
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "INR" },
        { "@type": "Offer", name: "PRO", price: "500", priceCurrency: "INR" },
      ],
    },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "BUILDWE.ONLINE — Build anything. Create everything.",
    template: "%s · BUILDWE",
  },
  description:
    "Chat, code, create images, and generate audio — one free AI workspace with web search and vision. Start free. PRO $5/mo.",
  applicationName: "BUILDWE.ONLINE",
  manifest: "/manifest.webmanifest",
  keywords: ["AI", "chat", "code", "image", "audio", "web search", "vision", "BUILDWE"],
  openGraph: {
    title: "BUILDWE.ONLINE",
    description: "Build anything. Create everything.",
    url: "https://buildwe.online",
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
