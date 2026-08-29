import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_APP_URL || "https://buildwe.online";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/reset", "/verify"],
      },
    ],
    sitemap: `${site.replace(/\/$/, "")}/sitemap.xml`,
  };
}
