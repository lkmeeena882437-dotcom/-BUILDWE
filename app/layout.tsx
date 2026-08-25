import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BUILDWE.ONLINE — Build anything. Create everything.",
    template: "%s · BUILDWE",
  },
  description:
    "Chat, code, create images, and generate audio — one AI workspace. Start free. PRO $5/mo.",
  applicationName: "BUILDWE.ONLINE",
  keywords: ["AI", "chat", "code", "image", "audio", "BUILDWE"],
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
      </body>
    </html>
  );
}
