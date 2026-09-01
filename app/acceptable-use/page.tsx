import type { Metadata } from "next";
import { SitePage, Section } from "@/components/SitePage";

export const metadata: Metadata = {
  title: "Acceptable Use",
  description: "The short, clear rules for using BUILDWE.",
};

export default function AcceptableUsePage() {
  return (
    <SitePage
      eyebrow="Policies"
      title="Acceptable Use"
      lede="BUILDWE is free and we intend to keep it that way. These rules protect the platform and its people."
    >
      <Section title="Do use BUILDWE to">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Learn, draft, plan, and build — for study, work, or personal projects.</li>
          <li>Generate images, voice, and code you have the rights to use.</li>
          <li>Share your chats publicly with share links, responsibly.</li>
        </ul>
      </Section>

      <Section title="Don't use BUILDWE to">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Create or spread illegal content, harassment, hate, or material harming minors.</li>
          <li>Build malware, phishing pages, or anything designed to deceive or damage.</li>
          <li>Impersonate others or generate non-consensual depictions of real people.</li>
          <li>Scrape, spam, or deliberately abuse free limits (automated mass generation, key farming, reselling free capacity).</li>
          <li>Circumvent rate limits, security controls, or other users&apos; privacy.</li>
        </ul>
      </Section>

      <Section title="What happens on violations">
        <p>
          We may throttle, suspend, or delete accounts that break these rules. Illegal activity may be
          reported to authorities. If you believe a decision was wrong, contact
          <strong> support@buildwe.online</strong>.
        </p>
      </Section>

      <Section title="Generated content">
        <p>
          You own your prompts and outputs, and you&apos;re responsible for how you use them. AI output can be
          wrong — verify before relying on it for anything important. See our{" "}
          <a href="/terms" className="font-medium text-[#C45C26] underline">Terms</a> and{" "}
          <a href="/privacy" className="font-medium text-[#C45C26] underline">Privacy Policy</a>.
        </p>
      </Section>
    </SitePage>
  );
}
