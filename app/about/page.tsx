import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — BUILDWE.ONLINE",
  description:
    "BUILDWE is the free AI platform for chat, code, image, and audio — one workspace for everyone.",
};

export default function AboutPage() {
  return (
    <div className="min-h-[100dvh] bg-[#F7F4EE] text-[#14110F]">
      <header className="border-b border-[#E6E0D6] bg-[#FBFAF7]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#14110F] text-xs text-[#F7F4EE]">
              B
            </span>
            BUILDWE
          </Link>
          <Link href="/" className="text-sm text-[#6B6560] hover:text-[#14110F]">
            ← Platform
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
          About the platform
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          BUILDWE.ONLINE
        </h1>
        <p className="mt-2 text-lg text-[#6B6560]">
          Four AI jobs. One calm place. Free for everyone.
        </p>

        <p className="mt-6 text-[15px] leading-relaxed text-[#333]">
          Most people bounce between separate tools to think, write code, make
          images, and generate voice. BUILDWE is a <strong>platform</strong> —
          not a one-off service pitch — that keeps those four jobs in a single
          workspace so more people can create without friction.
        </p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">What you can do</h2>
          <ul className="mt-3 space-y-3 text-[15px] text-[#333]">
            <li>
              <strong>Chat</strong> — decide, draft, learn. Clarity under pressure.
            </li>
            <li>
              <strong>Code</strong> — turn a brief into something you can run.
            </li>
            <li>
              <strong>Image</strong> — describe a frame and get a visual.
            </li>
            <li>
              <strong>Audio</strong> — paste a script, get a real MP3 you can download.
            </li>
            <li>
              <strong>Auto</strong> — one prompt; BUILDWE routes the work.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Beyond the basics</h2>
          <ul className="mt-3 space-y-3 text-[15px] text-[#333]">
            <li>
              <strong>Web search</strong> — toggle 🌐 or start with “search:” for live, cited sources. Works without any API key.
            </li>
            <li>
              <strong>Vision</strong> — attach an image in chat and ask about it.
            </li>
            <li>
              <strong>File analysis</strong> — drop a CSV and get rows, column types, and stats injected into the conversation.
            </li>
            <li>
              <strong>Projects &amp; Teams</strong> — group chats into projects; share chats with a team via invite links.
            </li>
            <li>
              <strong>Your own key (BYOK)</strong> — paste a free Groq/OpenRouter key in Settings → API keys; it&apos;s encrypted (AES-256-GCM) and powers your Chat, Code, and Vision.
            </li>
            <li>
              <strong>Share &amp; export</strong> — public read-only chat links, Markdown export, and Print/PDF.
            </li>
            <li>
              <strong>Developer API</strong> — build on BUILDWE from your own apps at <Link href="/developers" className="font-medium text-[#C45C26] underline">/developers</Link>.
            </li>
            <li>
              <strong>Installable</strong> — add BUILDWE to your home screen (PWA) on phone or desktop.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Why it&apos;s free</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#333]">
            Our focus is reach: help as many people as possible discover and use
            BUILDWE. Free is ad-supported. When you need higher volume and a
            calmer experience, <strong>PRO</strong> unlocks higher limits and
            priority generation.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">How the product feels</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#333]">
            Cream, modern, mobile-first. Built to feel like a serious AI product
            people already understand — without looking like a generic dark
            dashboard or a hard sell.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Rules &amp; trust</h2>
          <ul className="mt-4 space-y-2">
            <li>
              <Link href="/terms" className="font-medium text-[#C45C26] underline">
                Terms of Use &amp; AI Acceptable Use
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="font-medium text-[#C45C26] underline">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="font-medium text-[#C45C26] underline">
                Free &amp; PRO
              </Link>
            </li>
          </ul>
        </section>

        <section className="mt-10 rounded-3xl border border-[#E6E0D6] bg-white p-5">
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-2 text-sm text-[#6B6560]">
            support@buildwe.online
            <br />
            privacy@buildwe.online
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex h-10 items-center rounded-2xl bg-[#C45C26] px-4 text-sm font-semibold text-white"
          >
            Enter BUILDWE
          </Link>
        </section>
      </main>
    </div>
  );
}
