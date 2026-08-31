import type { MetadataRoute } from "next";
import { STUDIOS, TOOLS } from "@/lib/tools/registry";

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
    "/status",
    "/help",
    "/contact",
    "/developers",
  ];
  // Tool and studio pages are real, static routes, so they belong in the
  // sitemap; a catalogue page that lists nothing crawlable is how a tool
  // library becomes invisible.
  const entries: MetadataRoute.Sitemap = pages.map((p) => ({
    url: `${site}${p}`,
    lastModified: now,
    changeFrequency: p === "" || p === "/status" ? "daily" : "weekly",
    priority: p === "" ? 1 : p === "/pricing" || p === "/how-it-works" ? 0.8 : 0.6,
  }));
  entries.push({ url: `${site}/tools`, lastModified: now, changeFrequency: "weekly", priority: 0.9 });
  entries.push({ url: `${site}/studios`, lastModified: now, changeFrequency: "weekly", priority: 0.7 });
  for (const t of TOOLS) {
    entries.push({
      url: `${site}/tools/${t.id}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }
  for (const s of STUDIOS) {
    entries.push({
      url: `${site}/studios/${s.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }
  return entries;
}
