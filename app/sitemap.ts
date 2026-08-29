import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = (process.env.NEXT_PUBLIC_APP_URL || "https://buildwe.online").replace(/\/$/, "");
  const now = new Date();
  const pages = [
    "",
    "/how-it-works",
    "/about",
    "/pricing",
    "/security",
    "/privacy",
    "/terms",
    "/acceptable-use",
    "/changelog",
    "/status",
    "/help",
    "/contact",
    "/developers",
  ];
  return pages.map((p) => ({
    url: `${site}${p}`,
    lastModified: now,
    changeFrequency: p === "" || p === "/status" || p === "/changelog" ? "daily" : "weekly",
    priority: p === "" ? 1 : p === "/pricing" || p === "/how-it-works" ? 0.8 : 0.6,
  }));
}
