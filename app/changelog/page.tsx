import type { Metadata } from "next";
import { SitePage } from "@/components/SitePage";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in BUILDWE — every update, in plain language.",
};

const RELEASES: { v: string; date: string; title: string; items: string[] }[] = [
  {
    v: "v1.4.0",
    date: "Aug 2026",
    title: "Update 3 — the polish release",
    items: [
      "Google & GitHub sign-in (OAuth) alongside email — with guest mode kept intact",
      "Forgot password → secure single-use reset links; account deletion with full data wipe",
      "New outcome-first landing: “AI that understands the work. Not just the words.”",
      "Answer style controls: Short / Balanced / Detailed / Deep + Simple / Standard / Expert language",
      "One-tap answer actions: Simplify, Shorten, Expand, Explain, Save, plus Try-again on errors",
      "Code canvas version history — restore any of the last 12 versions",
      "Product naming: BUILDWE Chat, Code, Vision, Voice with their own taglines",
      "Design system: semantic success/warning/error states, motion language, focus visibility, reduced-motion support",
      "New trust pages: How it works, Security, Acceptable Use, Status, Help, Contact, Changelog",
      "Structured data (JSON-LD), sitemap and robots.txt for honest discoverability",
      "Prompt-injection guards around web results and uploaded files",
      "Progress states while generating (Understanding → Writing) and recovery actions",
    ],
  },
  {
    v: "v1.3.0",
    date: "Aug 2026",
    title: "Teams & permanent storage",
    items: [
      "Team workspaces: invite links, shared chats, team filters",
      "Optional Supabase permanent-DB mirror; atomic local storage writes",
    ],
  },
  {
    v: "v1.2.0",
    date: "Aug 2026",
    title: "Real audio, own keys, developer platform",
    items: [
      "Real MP3 voice generation with player + download",
      "BYOK: your own Groq/OpenRouter key, AES-256-GCM encrypted",
      "Developer API (/api/v1/chat) with key management at /developers",
      "Ad slots for free plan; Print/PDF export",
    ],
  },
  {
    v: "v1.1.0",
    date: "Aug 2026",
    title: "Search, vision, files, projects, sharing",
    items: [
      "Key-free web search with cited sources; image understanding; CSV/file analysis",
      "Projects, public share links, Razorpay PRO checkout, live HTML preview, installable PWA",
    ],
  },
  {
    v: "v1.0.0",
    date: "Aug 2026",
    title: "Launch",
    items: [
      "Auto · Chat · Code · Image · Audio in one cream-clean free workspace",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <SitePage
      eyebrow="Product"
      title="Changelog"
      lede="Every BUILDWE update, what it means for you — no jargon."
    >
      <div className="space-y-6">
        {RELEASES.map((r) => (
          <section key={r.v} className="rounded-3xl border border-[#E6E0D6] bg-white p-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded-full bg-[#F8EBE3] px-2.5 py-0.5 text-xs font-bold text-[#C45C26]">{r.v}</span>
              <h2 className="text-lg font-semibold">{r.title}</h2>
              <span className="text-xs text-[#9C958C]">{r.date}</span>
            </div>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] text-[#333]">
              {r.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </SitePage>
  );
}
