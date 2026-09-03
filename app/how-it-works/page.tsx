import type { Metadata } from "next";
import { SitePage, Section } from "@/components/SitePage";

export const metadata: Metadata = {
  alternates: { canonical: "/how-it-works" },
  title: "How it works",
  description: "What you do, and what BUILDWE does behind the scenes — in plain language.",
};

const STEPS: [string, string, string][] = [
  ["1 · Tell BUILDWE what you want", "Type it like you'd say it — “explain closures simply”, “build a quiz app”, “make a YouTube thumbnail”, “read this script aloud”. No commands, no code, no prompt syntax.", "You: one clear sentence."],
  ["2 · BUILDWE picks the path", "Your request is understood, the right capability is chosen (Chat, Code, Vision, Voice), the best available model is picked for the job, and any tools — live web search, file analysis, image understanding — are attached automatically.", "BUILDWE: routing, model choice, prompt optimization — all behind the scenes."],
  ["3 · You get the answer — checked", "Answers lead with the conclusion, then explanation, then detail. Sources show as chips when web results were used, code lands in a canvas with live preview, images and voice render in their studios. You can simplify, shorten, expand, or verify any answer with one tap.", "You: the result. BUILDWE: formatting + verification."],
];

const CAPS: [string, string, string][] = [
  ["BUILDWE Chat", "Think. Write. Understand.", "Questions, drafts, plans, learning — with live web search, file analysis, and image understanding built in."],
  ["BUILDWE Code", "Build. Debug. Ship.", "Describe what you want to build. Code arrives complete and runnable, in a canvas with live HTML preview and version history."],
  ["BUILDWE Vision", "Imagine. Create. Transform.", "Describe a picture — get the image. Attach a picture — ask about it. Iterative edits like “make it a YouTube thumbnail” just work."],
  ["BUILDWE Voice", "Speak. Listen. Create.", "Paste a script, pick a voice, get real audio you can play and download as MP3."],
];

export default function HowItWorksPage() {
  return (
    <SitePage
      eyebrow="How it works"
      title="You explain the goal. BUILDWE does the how."
      lede="BUILDWE is built to hide complexity, not expose it. Here's exactly what happens between your sentence and your answer."
    >
      <div className="space-y-4">
        {STEPS.map(([h, body, who]) => (
          <div key={h} className="rounded-3xl border border-[#E6E0D6] bg-white p-5">
            <h3 className="text-sm font-semibold">{h}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-[#333]">{body}</p>
            <p className="mt-2 text-xs font-medium text-[#C45C26]">{who}</p>
          </div>
        ))}
      </div>

      <Section title="The four capabilities">
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPS.map(([name, tag, desc]) => (
            <div key={name} className="rounded-3xl border border-[#E6E0D6] bg-white p-5">
              <div className="text-sm font-semibold">{name}</div>
              <div className="mt-0.5 text-[15px] font-medium text-[#C45C26]">{tag}</div>
              <p className="mt-2 text-sm leading-relaxed text-[#6B6560]">{desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Honest limitations">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>AI can be wrong. Verify important facts — use the source chips and the Verify action.</li>
          <li>Free tier has fair daily limits on code, images, and audio; chat stays generous.</li>
          <li>Web search reflects what the open web returns — recency and coverage vary.</li>
          <li>Full AI quality improves when a platform or your own provider key is connected (Settings → API keys).</li>
        </ul>
      </Section>
    </SitePage>
  );
}
