import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — BUILDWE.ONLINE",
  description: "How BUILDWE.ONLINE collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="August 25, 2026">
      <P>
        BUILDWE.ONLINE (“BUILDWE”, “we”, “us”) provides an AI workspace for chat,
        code, image, and audio. This policy explains what we collect and why.
      </P>

      <H>1. Information we collect</H>
      <Ul>
        <li>
          <strong>Account data</strong> — email, name, avatar when you sign in
          (e.g. Google or magic link).
        </li>
        <li>
          <strong>Usage data</strong> — feature used (chat/code/image/audio),
          timestamps, plan tier, approximate device/browser info, and IP for
          abuse prevention.
        </li>
        <li>
          <strong>Content you submit</strong> — prompts, uploads, and generated
          outputs needed to run the product.
        </li>
        <li>
          <strong>Payment data</strong> — handled by Razorpay (or similar). We
          store subscription status and payment references, not full card
          numbers.
        </li>
        <li>
          <strong>Optional BYOK keys</strong> — if you connect your own AI API
          key, it is stored encrypted and used only to fulfill your requests.
        </li>
      </Ul>

      <H>2. How we use information</H>
      <Ul>
        <li>Provide and improve chat, code, image, and audio features.</li>
        <li>Enforce fair-use, rate limits, and fraud/abuse protection.</li>
        <li>Bill PRO subscriptions and show plan status.</li>
        <li>Send essential service messages (security, billing).</li>
        <li>Comply with law and protect our rights and users.</li>
      </Ul>

      <H>3. AI providers</H>
      <P>
        Prompts may be sent to third-party model providers (for example Groq,
        OpenRouter, image/TTS vendors) to generate responses. Those providers
        process data under their own terms. We configure providers to avoid
        using your content for their model training where the provider allows
        that setting. Do not submit secrets, passwords, or regulated personal
        data you are not allowed to process with AI tools.
      </P>

      <H>4. Cookies & local storage</H>
      <P>
        We use essential cookies/local storage for session, theme, and product
        preferences. We do not sell personal information.
      </P>

      <H>5. Retention</H>
      <P>
        Account and history are kept while your account is active. You may
        delete conversations in-product. After account deletion we remove or
        anonymize personal data within a reasonable period unless law requires
        longer retention.
      </P>

      <H>6. Security</H>
      <P>
        API keys and secrets stay on the server. We use HTTPS, access controls,
        and least-privilege practices. No method of transmission is 100%
        secure.
      </P>

      <H>7. Your rights</H>
      <P>
        Depending on your region you may request access, correction, export, or
        deletion of personal data by contacting{" "}
        <strong>privacy@buildwe.online</strong>.
      </P>

      <H>8. Children</H>
      <P>
        BUILDWE is not directed at children under 13 (or higher age where
        required). Do not use the service if you are under the applicable age.
      </P>

      <H>9. Changes</H>
      <P>
        We may update this policy. Material changes will be reflected by the
        “Last updated” date on this page.
      </P>

      <H>10. Contact</H>
      <P>
        privacy@buildwe.online · BUILDWE.ONLINE
      </P>
    </LegalShell>
  );
}

function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-[#F8F6F1] text-[#1C1C1C]">
      <header className="border-b border-[#E5E1D8] bg-[#FDFCFA]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1C1C1C] text-xs text-[#F8F6F1]">
              B
            </span>
            BUILDWE
          </Link>
          <Link href="/" className="text-sm text-[#737373] hover:text-[#1C1C1C]">
            ← Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[#737373]">Last updated: {updated}</p>
        <article className="prose-legal mt-8 space-y-4 text-[15px] leading-relaxed text-[#333]">
          {children}
        </article>
      </main>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[#333]">{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-[#333]">{children}</ul>;
}
