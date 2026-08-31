"use client";

import { useState } from "react";
import type { PublicTool } from "@/lib/tools/types";
import { ToolRunner } from "./ToolRunner";

/**
 * A studio is a tab strip over real tools with one shared instruction attached
 * to every run. Deliberately not a second product: the tools, the runner, the
 * quota and the checks are the same objects the /tools pages use, so a studio
 * cannot quietly be a demo while the tool page is real.
 */
export function StudioRunner({
  studio,
  tools,
}: {
  studio: { slug: string; name: string; line: string };
  tools: PublicTool[];
}) {
  const [active, setActive] = useState(tools[0]?.id || "");
  const tool = tools.find((t) => t.id === active) || tools[0];
  if (!tool) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={
              "rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors " +
              (t.id === tool.id
                ? "bg-[#14110F] text-[#F7F4EE]"
                : "border border-[#E6E0D6] bg-[#FBFAF7] text-[#333] hover:bg-white")
            }
          >
            {t.name}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-[#6B6560]">
        <span className="font-semibold text-[#C45C26]">{studio.name} context</span> — {studio.line} This is
        appended to the prompt for every run on this page; the tool&apos;s own contract still has to pass.
      </p>
      <ToolRunner tool={tool} studio={studio} />
    </div>
  );
}
