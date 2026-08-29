import type { Metadata } from "next";
import { SitePage, Section } from "@/components/SitePage";

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach the BUILDWE team — support, privacy, security, and partnerships.",
};

export default function ContactPage() {
  return (
    <SitePage
      eyebrow="Contact"
      title="Talk to us"
      lede="Small team, real inbox. Pick the right address and we'll route it fast."
    >
      <Section title="Email">
        <ul className="space-y-2">
          <li><strong>support@buildwe.online</strong> — bugs, account help, billing questions, feedback</li>
          <li><strong>privacy@buildwe.online</strong> — data requests, privacy questions</li>
          <li><strong>security@buildwe.online</strong> — vulnerability reports (please include steps to reproduce)</li>
        </ul>
      </Section>
      <Section title="Before you write">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Many answers live in <a href="/help" className="font-medium text-[#C45C26] underline">Help &amp; FAQ</a>.</li>
          <li>Something down? Check <a href="/status" className="font-medium text-[#C45C26] underline">Status</a> first.</li>
          <li>Billing issues on PRO? Include your account email — never your password or card details.</li>
        </ul>
      </Section>
      <Section title="Response times">
        <p>Usually within 1–2 working days. Security reports get priority.</p>
      </Section>
    </SitePage>
  );
}
