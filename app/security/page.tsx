import type { Metadata } from "next";
import { SitePage, Section } from "@/components/SitePage";

export const metadata: Metadata = {
  alternates: { canonical: "/security" },
  title: "Security",
  description: "How BUILDWE protects accounts, keys, and data — with claims we can actually demonstrate.",
};

export default function SecurityPage() {
  return (
    <SitePage
      eyebrow="Trust & safety"
      title="Security at BUILDWE"
      lede="Only claims we can technically demonstrate. Everything below maps to real code in the product."
    >
      <Section title="Accounts & sessions">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Passwords hashed with scrypt + per-user salt — never stored or logged in plain text.</li>
          <li>Sessions are signed JWTs in httpOnly cookies (not readable by scripts), SameSite protection, secure in production.</li>
          <li>Google / GitHub sign-in uses standard OAuth 2.0 with CSRF state checks; we request the minimum scopes (profile + email).</li>
          <li>Password reset links are single-use, hashed at rest, and expire after 1 hour. Requests never reveal whether an email exists.</li>
          <li>Account deletion is password/confirmation-gated and removes your profile, chats, projects, teams, payments, shares, and API keys.</li>
        </ul>
      </Section>

      <Section title="Your API keys (BYOK)">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>User-provided provider keys are encrypted before storage and are never returned to the browser — only a short masked preview.</li>
          <li>Keys are used only for your own requests and can be removed anytime in Settings → API keys.</li>
        </ul>
      </Section>

      <Section title="Untrusted content protection">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Web-search excerpts and uploaded-file contents are injected into prompts marked as untrusted data, with explicit instructions to ignore any commands found inside them (prompt-injection defense).</li>
          <li>HTML previews run in sandboxed iframes without same-origin access.</li>
        </ul>
      </Section>

      <Section title="Abuse protection & reliability">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Per-user and per-IP rate limits on every AI, search, auth, and payment route.</li>
          <li>Fair-use daily limits enforced server-side — not just hidden in the UI.</li>
          <li>Provider failures fall back automatically; one unavailable service never blocks the workspace.</li>
          <li>Storage writes are atomic — a crash can&apos;t leave a half-written database.</li>
        </ul>
      </Section>

      <Section title="Data & retention">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Guest data lives in an anonymous cookie-scoped workspace on the server — create an account to own and sync it.</li>
          <li>Chats, projects, teams, files, shares, and keys each have delete controls (per-chat delete, project delete, team leave/dissolve, key revoke, account deletion).</li>
          <li>Optional permanent storage (Supabase mirror) activates only when you configure it with your own credentials.</li>
          <li>Email verification activates automatically once mail delivery is configured on the deployment.</li>
        </ul>
      </Section>

      <Section title="Reporting a vulnerability">
        <p>
          Found something? Email <strong>security@buildwe.online</strong> with details. We credit
          responsible disclosures and fix credible reports quickly.
        </p>
      </Section>
    </SitePage>
  );
}
