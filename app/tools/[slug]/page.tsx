import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/SitePage";
import { TOOLS, findTool } from "@/lib/tools/registry";
import { publicTool } from "@/lib/tools/types";
import type { ToolChecks } from "@/lib/tools/types";
import { ToolRunner } from "@/components/tools/ToolRunner";

export const dynamicParams = false;

/** Every tool page is static — same promise as the marketing pages: the HTML
 *  exists without JS, so a crawler or a link preview sees the real tool. */
export function generateStaticParams() {
  return TOOLS.map((t) => ({ slug: t.id }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const tool = findTool(params.slug);
  if (!tool) return { title: "Tool not found" };
  return {
    title: `${tool.name}`,
    description: tool.description,
    alternates: { canonical: `/tools/${tool.id}` },
    openGraph: {
      title: `${tool.name} · BUILDWE`,
      description: tool.tagline,
      url: `https://buildwe.online/tools/${tool.id}`,
      type: "article",
    },
  };
}

/** Human-readable rendering of the machine contract the runner enforces. */
function checkLabels(checks?: ToolChecks): string[] {
  if (!checks) return [];
  const out: string[] = [];
  if (checks.minWords) out.push(`at least ${checks.minWords} words`);
  if (checks.maxWords) out.push(`no more than ${checks.maxWords} words`);
  if (checks.maxChars) out.push(`within ${checks.maxChars} characters`);
  if (checks.headings) out.push(`${checks.headings}+ structured headings`);
  if (checks.bullets) out.push(`${checks.bullets}+ list items`);
  if (checks.variants) out.push(`exactly ${checks.variants[0]}–${checks.variants[1]} options`);
  if (checks.mustInclude?.length) out.push(`contains ${checks.mustInclude.map((s) => `“${s}”`).join(", ")}`);
  if (checks.mustNotInclude?.length) out.push(`never contains ${checks.mustNotInclude.map((s) => `“${s}”`).join(", ")}`);
  if (checks.codeBlock) out.push("the code in a fenced block, ready to paste");
  return out;
}

export default function ToolPage({ params }: { params: { slug: string } }) {
  const spec = findTool(params.slug);
  if (!spec) notFound();
  const tool = publicTool(spec);
  const checks = checkLabels(spec.checks);
  const related = TOOLS.filter((t) => t.category === spec.category && t.id !== spec.id).slice(0, 6);

  return (
    <SitePage
      wide
      eyebrow={spec.category}
      title={spec.name}
      lede={spec.tagline}
    >
      <ToolRunner tool={tool} />

      <section>
        <h2 className="text-lg font-semibold">What this tool does</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[#333]">{spec.description}</p>
      </section>

      {checks.length ? (
        <section>
          <h2 className="text-lg font-semibold">What the runner checks before it calls it done</h2>
          <ul className="mt-2 space-y-1 text-[14px] text-[#333]">
            {checks.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-[#C45C26]" aria-hidden>
                  ✓
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-[#6B6560]">
            A failed check triggers one corrective regeneration. If that still fails, the answer is still
            delivered — with the failure named, not hidden.
          </p>
        </section>
      ) : (
        <section>
          <p className="text-[13px] text-[#6B6560]">
            This tool grades its answer with the generic quality gate (on-topic, format, length) instead of a
            bespoke contract, because its output shape varies too much to pre-declare.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">Honest limits</h2>
        <ul className="mt-2 space-y-1.5 text-[14px] leading-relaxed text-[#333]">
          <li>
            Facts you don&apos;t supply come back as <code className="rounded bg-[#F1ECE3] px-1">[ADD: …]</code>. The tool
            won&apos;t invent a statistic to look complete.
          </li>
          <li>
            It runs on {spec.feature === "code" ? "the code model lane" : "the chat model lane"} and counts against that
            daily/monthly allowance — {spec.maxTokens.toLocaleString()} tokens of budget, temperature{" "}
            {spec.temperature}.
          </li>
          <li>No live model, no output: if the provider is unreachable you get an error, not a template.</li>
          <li>
            The result is saved to your workspace history with the tool, model and check results attached —
            so a bad run is visible in the record, not just on screen.
          </li>
        </ul>
      </section>

      {related.length ? (
        <section>
          <h2 className="text-lg font-semibold">More {spec.category.toLowerCase()} tools</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/tools/${r.id}`}
                className="rounded-xl border border-[#E6E0D6] bg-[#FBFAF7] px-3 py-1.5 text-[13px] font-medium text-[#14110F] hover:border-[#C45C26]/50 hover:bg-white"
              >
                {r.name}
              </Link>
            ))}
            <Link
              href="/tools"
              className="rounded-xl px-3 py-1.5 text-[13px] font-medium text-[#C45C26] hover:underline"
            >
              All {TOOLS.length} tools →
            </Link>
          </div>
        </section>
      ) : null}
    </SitePage>
  );
}
