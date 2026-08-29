import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BUILDWE.ONLINE — Build anything. Create everything.",
    short_name: "BUILDWE",
    description:
      "One free AI workspace: Auto · Chat · Code · Image · Audio. Start free.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8F6F1",
    theme_color: "#C45C26",
    orientation: "portrait-primary",
    categories: ["productivity", "utilities", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
