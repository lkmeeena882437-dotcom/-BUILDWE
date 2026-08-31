import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/SitePage";
import { STUDIOS, TOOLS, findStudio } from "@/lib/tools/registry";
import { publicTool } from "@/lib/tools/types";
import { StudioRunner } from "@/components/tools/StudioRunner";

export const metadata: Metadata = {
  title: "AI Studios",
  description: "Persona-bundled tool sets — the same engines as /tools, with one shared instruction applied to every run.",
  alternates: { canonical: "/studios" },
};

export default function StudiosIndex() {
  return (
    <SitePage
      wide
      eyebrow="Studios"
      title="One workspace per kind of work"
      lede="A studio is not a new model. It's a curated set of the real tools, in the order that job needs them, with a shared instruction that gets appended to every prompt the studio runs. Nothing here is a landing page for a feature that doesn't exist: every tool listed below runs through /api/tools."
    >
      {STUDIOS.map((s) => {
        const tools = s.tools
          .map((id) => TOOLS.find((t) => t.id === id))
          .filter((t): t is (typeof TOOLS)[number] => Boolean(t));
        return (
          <section key={s.slug}>
            <h2 className="text-lg font-semibold">{s.name}</h2>
            <p className="mt-1 text-[13px] text-[#6B6560]">{s.line}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tools.map((t) => (
                <span
                  key={t.id}
                  className="rounded-lg bg-[#F1ECE3] px-2 py-1 text-[12px] font-medium text-[#333]"
                >
                  {t.name}
                </span>
              ))}
              <Link
                href={`/studios/${s.slug}`}
                className="rounded-lg bg-[#14110F] px-2.5 py-1 text-[12px] font-semibold text-[#F7F4EE]"
              >
                Open studio →
              </Link>
            </div>
          </section>
        );
      })}
      <section>
        <p className="text-[13px] text-[#6B6560]">
          Prefer one tool at a time? Everything a studio can do is also available directly:{" "}
          <Link href="/tools" className="font-medium text-[#C45C26] hover:underline">
            all {TOOLS.length} tools
          </Link>
          .
        </p>
      </section>
    </SitePage>
  );
}
