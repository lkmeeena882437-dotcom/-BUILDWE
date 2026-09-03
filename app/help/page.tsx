import type { Metadata } from "next";
import Link from "next/link";
import { SitePage, Section } from "@/components/SitePage";

export const metadata: Metadata = {
  alternates: { canonical: "/help" },
  title: "Help & FAQ",
  description: "Answers to common BUILDWE questions — free plan, guest mode, limits, keys, mobile, deletion.",
};

const FAQ: [string, string][] = [
  ["Is BUILDWE really free?", "Yes. The free plan is ad-supported and includes chat, code, images, and voice with fair daily limits. PRO (₹500/mo) raises limits and removes ads. No card needed to start."],
  ["Do I need an account?", "No — guest mode works instantly for trying things. History in guest mode is saved on this device only. Create a free account to own your workspace, sync across devices, use your own API keys, buy PRO, or share team chats."],
  ["Do I need to write prompts or commands?", "No. Type what you want in plain language — “plan my Goa trip budget”, “build a pomodoro app”, “make a poster for my cafe”. BUILDWE figures out the right tool. Commands like “search:” exist as optional shortcuts, never requirements."],
  ["How do I get better answers?", "Use the ✨ style button in the composer: pick Short / Balanced / Detailed / Deep length and Simple / Standard / Expert language. On any answer, tap Simplify, Shorten, Expand, or Explain."],
  ["Can BUILDWE browse the web?", "Yes — tap the 🌐 globe in the composer (or start with “search:”). Answers then cite live sources as chips. This works even without any API keys."],
  ["Why does one of my answers say it was computed offline?", "No model provider was reachable for that reply, so BUILDWE answered from what it can do on the server itself: arithmetic, unit and date conversions, and real starting structure for writing and code — each one computed, never recalled. Image, voice, transcription and web search are separate and work as usual. Point a key at the deployment (Settings → API keys) and the same question goes to a real model instead."],
  ["What are the limits?", "Free: generous chat, ~15 code builds/day, ~5 images/day, ~5 voice clips/day. PRO: 500 code/month and effectively unlimited images and voice. Limits are enforced server-side."],
  ["Does it work on mobile?", "Yes — the whole workspace is mobile-first. On Android/Chrome or iOS/Safari, use “Add to Home Screen” to install BUILDWE as an app (PWA)."],
  ["How do I delete my data?", "Per chat: trash icon in history. Project: delete chip in sidebar. Team: leave from Teams. API key: revoke at /developers or Settings. Everything: Settings → Delete account (permanent, instant)."],
  ["Is my data private?", "Prompts go to AI providers only to generate your answer. Passwords are scrypt-hashed, your own API keys are AES-256-GCM encrypted, and nothing is sold. See Privacy."],
];

export default function HelpPage() {
  return (
    <SitePage
      eyebrow="Help"
      title="Help & FAQ"
      lede="Quick answers. Still stuck? Contact us — a human replies."
    >
      <div className="space-y-3">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group rounded-3xl border border-[#E6E0D6] bg-white p-4">
            <summary className="cursor-pointer list-none text-[15px] font-semibold">
              {q}
              <span className="float-right text-[#C45C26] transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-[15px] leading-relaxed text-[#333]">{a}</p>
          </details>
        ))}
      </div>

      <Section title="Quick starts">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>New here? Read <Link href="/how-it-works" className="font-medium text-[#C45C26] underline">How it works</Link> (2 minutes).</li>
          <li>Building an app integration? <Link href="/developers" className="font-medium text-[#C45C26] underline">Developer API</Link>.</li>
          <li>Something looks broken? Check <Link href="/status" className="font-medium text-[#C45C26] underline">Status</Link>.</li>
        </ul>
      </Section>
    </SitePage>
  );
}
