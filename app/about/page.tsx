import Link from "next/link";
import type { Metadata } from "next";
import { modelsByCapability } from "@/lib/ai/models-catalog";

export const metadata: Metadata = {
  title: "About — BUILDWE.ONLINE",
  description:
    "About BUILDWE.ONLINE — AI workspace for chat, code, image, and audio. Rules, models, and policies.",
};

export default function AboutPage() {
  const matrix = modelsByCapability();

  return (
    <div className="min-h-[100dvh] bg-[#F8F6F1] text-[#1C1C1C]">
      <header className="border-b border-[#E5E1D8] bg-[#FDFCFA]/95 backdrop-blur">
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

      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">
          About
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          BUILDWE.ONLINE
        </h1>
        <p className="mt-2 text-lg text-[#737373]">
          Build anything. Create everything.
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-[#333]">
          BUILDWE is one cream-clean AI workspace for{" "}
          <strong>Chat</strong>, <strong>Code</strong>, <strong>Image</strong>, and{" "}
          <strong>Audio</strong> — plus <strong>Auto</strong> mode that reads your
          prompt and routes to the right tool. Everyone starts on{" "}
          <strong>Free</strong>. <strong>PRO</strong> unlocks only after payment is
          verified (Razorpay).
        </p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">What you can do</h2>
          <ul className="mt-3 space-y-2 text-[15px] text-[#333]">
            <li>
              <strong>Chat</strong> — think, write, learn; fair-use unlimited feel on Free.
            </li>
            <li>
              <strong>Code</strong> — describe a project; multi-file canvas + slides.
            </li>
            <li>
              <strong>Image</strong> — text → visuals (Free has quiet daily limits).
            </li>
            <li>
              <strong>Audio</strong> — text → natural voices (EN, Hindi, Indian, world).
            </li>
            <li>
              <strong>Auto</strong> — one box; AI chooses the mode and a model.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">How AI works (backend)</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] text-[#333]">
            <li>Check plan, rate limits, and abuse protection.</li>
            <li>
              If <em>Auto</em>, detect intent: chat / code / image / audio.
            </li>
            <li>Estimate task complexity (simple → complex).</li>
            <li>
              <strong>Free:</strong> automatically pick the best model for quality
              under cost. <strong>PRO:</strong> prefer higher-quality models and
              priority routing.
            </li>
            <li>Call the provider (Groq, OpenRouter, Fal, TTS, …) or BYOK.</li>
            <li>Fallback to the next healthy model if one fails.</li>
          </ol>
          <p className="mt-3 text-sm text-[#737373]">
            Engineers: see <code className="rounded bg-[#E8E4DB] px-1">docs/AI_BACKEND.md</code> and{" "}
            <code className="rounded bg-[#E8E4DB] px-1">lib/ai/models-catalog.ts</code>.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Models we run (catalog)</h2>
          <p className="mt-2 text-sm text-[#737373]">
            We can register many models. Free users never have to choose — the
            router decides. PRO gets stronger defaults.
          </p>
          <div className="mt-4 space-y-4">
            {matrix.map((row) => (
              <div
                key={row.capability}
                className="rounded-2xl border border-[#E5E1D8] bg-white p-4"
              >
                <div className="text-sm font-semibold capitalize">
                  {row.capability}
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#A3A3A3]">
                      Free pool
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-[#444]">
                      {row.free.map((m) => (
                        <li key={m.id}>
                          {m.label}{" "}
                          <span className="text-[#A3A3A3]">({m.provider})</span>
                        </li>
                      ))}
                      {!row.free.length && <li>—</li>}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#C45C26]">
                      PRO pool
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-[#444]">
                      {row.pro.map((m) => (
                        <li key={m.id}>
                          {m.label}{" "}
                          <span className="text-[#A3A3A3]">({m.provider})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Plans</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#E5E1D8] bg-white p-4">
              <div className="text-xs font-semibold text-[#A3A3A3]">FREE</div>
              <div className="text-2xl font-semibold">$0</div>
              <p className="mt-2 text-sm text-[#737373]">
                Default for every user. Chat for normal use. Limited code / image /
                audio. Models auto-selected.
              </p>
            </div>
            <div className="rounded-2xl border-2 border-[#C45C26] bg-white p-4">
              <div className="text-xs font-semibold text-[#C45C26]">PRO</div>
              <div className="text-2xl font-semibold">
                $5<span className="text-sm font-normal text-[#737373]">/mo</span>
              </div>
              <p className="mt-2 text-sm text-[#737373]">
                Priority models, higher limits, faster generation. Unlocks only after
                checkout payment is verified.
              </p>
            </div>
          </div>
          <Link
            href="/pricing"
            className="mt-3 inline-block text-sm font-medium text-[#C45C26] underline"
          >
            Full pricing comparison →
          </Link>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Rules &amp; policies</h2>
          <p className="mt-2 text-[15px] text-[#333]">
            Using BUILDWE means you accept our product rules and legal policies.
            AI can be wrong — verify important output. No illegal, abusive, or
            harmful use. Details:
          </p>
          <ul className="mt-4 space-y-2">
            <li>
              <Link
                href="/terms"
                className="font-medium text-[#C45C26] underline"
              >
                Terms of Use &amp; AI Acceptable Use
              </Link>
              <span className="text-sm text-[#737373]">
                {" "}
                — accounts, PRO billing, AI warranty, banned uses
              </span>
            </li>
            <li>
              <Link
                href="/privacy"
                className="font-medium text-[#C45C26] underline"
              >
                Privacy Policy
              </Link>
              <span className="text-sm text-[#737373]">
                {" "}
                — data we collect, providers, retention, your rights
              </span>
            </li>
            <li>
              <Link
                href="/pricing"
                className="font-medium text-[#C45C26] underline"
              >
                Pricing
              </Link>
              <span className="text-sm text-[#737373]">
                {" "}
                — Free vs PRO feature matrix
              </span>
            </li>
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-[#E5E1D8] bg-white p-5">
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-2 text-sm text-[#737373]">
            Product: support@buildwe.online
            <br />
            Privacy: privacy@buildwe.online
            <br />
            Legal: legal@buildwe.online
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#C45C26] px-4 text-sm font-semibold text-white"
          >
            Open workspace
          </Link>
        </section>
      </main>
    </div>
  );
}
