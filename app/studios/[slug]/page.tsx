import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/SitePage";
import { TOOLS, findStudio } from "@/lib/tools/registry";
import { publicTool } from "@/lib/tools/types";
import { StudioRunner } from "@/components/tools/StudioRunner";

export const dynamicParams = false;

export function generateStaticParams() {
  return ["founder", "marketer", "student", "teacher", "developer", "agency", "executive"].map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const s = findStudio(params.slug);
  if (!s) return { title: "Studio not found" };
  return {
    title: s.name,
    description: `${s.line} A BUILDWE studio bundles ${s.tools.length} of the ${TOOLS.length} real tools with one shared instruction applied to every run.`,
    alternates: { canonical: `/studios/${s.slug}` },
  };
}

export default function StudioPage({ params }: { params: { slug: string } }) {
  const studio = findStudio(params.slug);
  if (!studio) notFound();
  const tools = studio.tools
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter((t): t is (typeof TOOLS)[number] => Boolean(t))
    .map(publicTool);

  return (
    <SitePage
      wide
      eyebrow="Studio"
      title={studio.name}
      lede={studio.line}
    >
      <StudioRunner studio={{ slug: studio.slug, name: studio.name, line: studio.line }} tools={tools} />
      <section>
        <p className="text-[13px] leading-relaxed text-[#6B6560]">
          Every run here is validated, metered and graded exactly like the standalone tool page — the studio
          only adds a prompt context.{" "}
          {tools.map((t, i) => (
            <span key={t.id}>
              {i > 0 ? " · " : ""}
              <Link href={`/tools/${t.id}`} className="font-medium text-[#C45C26] hover:underline">
                {t.name}
              </Link>
            </span>
          ))}
        </p>
      </section>
    </SitePage>
  );
}
