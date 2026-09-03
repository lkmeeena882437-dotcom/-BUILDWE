import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms of Use — BUILDWE.ONLINE",
  description: "Terms governing use of BUILDWE.ONLINE AI services.",
};

export default function TermsPage() {
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
        <h1 className="text-3xl font-semibold tracking-tight">
          Terms of Use &amp; AI Acceptable Use
        </h1>
        <p className="mt-2 text-sm text-[#737373]">Last updated: August 25, 2026</p>

        <article className="mt-8 space-y-4 text-[15px] leading-relaxed text-[#333]">
          <p>
            By using BUILDWE.ONLINE you agree to these Terms. If you do not
            agree, do not use the service.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            1. The service
          </h2>
          <p>
            BUILDWE provides AI-assisted chat, code, image, and audio tools.
            Features may change. “Unlimited” chat is subject to fair-use and
            abuse protection. Free and PRO plans differ in limits, speed, and
            model access as described on the pricing page.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            2. Accounts
          </h2>
          <p>
            You are responsible for activity under your account. Keep credentials
            secure. You must provide accurate information when registering or
            paying.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            3. Plans &amp; billing (PRO / VIP)
          </h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>New users start on the Free plan.</li>
            <li>
              PRO unlocks after successful payment verification (e.g. Razorpay).
            </li>
            <li>
              Prices may be shown in USD marketing copy and charged in local
              currency (e.g. INR) as stated at checkout.
            </li>
            <li>
              You authorize recurring charges if you choose a subscription.
              Cancel anytime; access continues until period end unless stated
              otherwise.
            </li>
            <li>Refunds follow applicable law and our support policy.</li>
          </ul>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            4. AI outputs — no warranty
          </h2>
          <p>
            AI can be wrong, incomplete, or biased. Outputs are provided “as
            is”. You must review code, legal, medical, financial, or safety-
            critical content before relying on it. BUILDWE is not liable for
            decisions made solely on AI output.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            5. Acceptable use (AI)
          </h2>
          <p>You agree not to use BUILDWE to:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Violate law or third-party rights.</li>
            <li>Create malware, phishing, or scams.</li>
            <li>Generate CSAM or sexual content involving minors.</li>
            <li>Harass, dox, or incite violence.</li>
            <li>Bypass rate limits, scrape, or reverse engineer abusively.</li>
            <li>Upload others’ personal data without a lawful basis.</li>
            <li>
              Attempt to extract system prompts or other users’ data.
            </li>
          </ul>
          <p>
            We may suspend or terminate accounts that break these rules.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            6. Your content &amp; license
          </h2>
          <p>
            You retain rights to prompts and materials you own. You grant
            BUILDWE a limited license to process them to provide the service.
            Generated content may be used by you subject to model-provider
            terms and third-party rights.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            7. Bring your own key (BYOK)
          </h2>
          <p>
            If you connect your own API keys, you are responsible for provider
            billing, quotas, and compliance with that provider’s terms. BUILDWE
            is not liable for charges on your external accounts.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            8. Intellectual property
          </h2>
          <p>
            BUILDWE branding, UI, and software are owned by us or licensors.
            You may not copy the product or remove notices.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            9. Limitation of liability
          </h2>
          <p>
            To the maximum extent permitted by law, BUILDWE is not liable for
            indirect, incidental, or consequential damages, or loss of data,
            profits, or goodwill. Our aggregate liability is limited to the
            greater of fees you paid us in the prior 3 months or USD $50.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            10. Privacy
          </h2>
          <p>
            Our <Link href="/privacy" className="text-[#C45C26] underline">Privacy Policy</Link>{" "}
            is part of these Terms.
          </p>

          <h2 className="!mt-8 text-lg font-semibold text-[#1C1C1C]">
            11. Changes &amp; contact
          </h2>
          <p>
            We may update Terms by posting a new version. Continued use means
            acceptance. Contact: legal@buildwe.online
          </p>
        </article>
      </main>
    </div>
  );
}
