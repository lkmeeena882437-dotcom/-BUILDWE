import type { Metadata } from "next";
import Link from "next/link";
import { SitePage } from "@/components/SitePage";
import { TOOLS, STUDIOS, toolsByCategory } from "@/lib/tools/registry";

export const metadata: Metadata = {
  title: "AI Tools",
  description: `${TOOLS.length} purpose-built generators — writing, social, marketing, career, documents and code. Each one enforces its own output contract instead of just echoing your prompt back.`,
  alternates: { canonical: "/tools" },
};

/**
 * The tool catalogue, rendered from the registry on the server so the page is
 * in the HTML (crawlers and link previews) rather than a client fetch that
 * paints a spinner. If a tool is listed here, it runs — `tests/tools.mjs`
 * boots the app and executes them.
 */
export default function ToolsPage() {
  const groups = toolsByCategory();
  return (
    <SitePage
      wide
      eyebrow="Tools"
      title={`${TOOLS.length} tools, one runner`}
      lede="Not 31 prompts in a dropdown. Each tool below has its own inputs, its own output contract, and a server that grades the answer against that contract before calling it done. Same quota, same history, same BYOK keys as the workspace."
    >
      {groups.map((g) => (
        <section key={g.category}>
          <h2 className="text-lg font-semibold">
            {g.category}
            <span className="ml-2 text-xs font-normal text-[#9C958C]">{g.tools.length} tools</span>
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {g.tools.map((t) => (
              <Link
                key={t.id}
                href={`/tools/${t.id}`}
                className="group rounded-2xl border border-[#E6E0D6] bg-[#FBFAF7] p-4 transition-colors hover:border-[#C45C26]/50 hover:bg-white"
              >
                <p className="text-[15px] font-semibold text-[#14110F]">{t.name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6B6560]">{t.tagline}</p>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-[#9C958C] group-hover:text-[#C45C26]">
                  Open tool →
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="text-lg font-semibold">Studios</h2>
        <p className="mt-1 text-[13px] text-[#6B6560]">
          A studio is a curated bundle of the tools above plus one shared instruction that the runner
          appends to every prompt. It is not a separate model, and we don&apos;t pretend it is.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {STUDIOS.map((s) => (
            <Link
              key={s.slug}
              href={`/studios/${s.slug}`}
              className="rounded-2xl border border-[#E6E0D6] bg-[#FBFAF7] p-4 hover:border-[#C45C26]/50 hover:bg-white"
            >
              <p className="text-[15px] font-semibold">{s.name}</p>
              <p className="mt-1 text-[13px] text-[#6B6560]">{s.line}</p>
              <p className="mt-2 text-[11px] uppercase tracking-wide text-[#9C958C]">
                {s.tools.length} tools
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">How a tool run works</h2>
        <ol className="mt-2 space-y-1.5 text-[15px] text-[#333]">
          <li>1 · Your inputs are validated on the server against the tool&apos;s field list — required fields, exact character caps, and fixed choices only.</li>
          <li>2 · The prompt is built from the tool&apos;s spec on the server. What the browser sends is data, never instructions.</li>
          <li>3 · Quota is checked before any model call, and usage counts the calls actually made.</li>
          <li>4 · The answer streams to you. When it finishes, the runner grades it against that tool&apos;s contract (headings, length, must-include, character limits).</li>
          <li>5 · A failed check buys exactly one corrective regeneration, and you see whether it helped. Nothing is silently marked as good.</li>
          <li>6 · The result lands in your workspace history with the tool, model and check results attached.</li>
        </ol>
        <p className="mt-3 text-[13px] text-[#6B6560]">
          A generator refuses to run if no live model is reachable — it will not hand you a template dressed up as
          an AI answer. Status: <Link className="underline" href="/status">/status</Link>.
        </p>
      </section>
    </SitePage>
  );
}
