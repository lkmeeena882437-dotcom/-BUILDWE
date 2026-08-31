import { NextResponse } from "next/server";
import { TOOLS, STUDIOS, toolsByCategory } from "@/lib/tools/registry";
import { publicTool } from "@/lib/tools/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tools
 * The catalogue as data, so `/tools`, the workspace launcher and the mobile
 * menu all render the same list from one source instead of a hand-maintained
 * array that can drift from what actually runs.
 */
export async function GET() {
  const groups = toolsByCategory().map((g) => ({
    category: g.category,
    tools: g.tools.map(publicTool),
  }));
  return NextResponse.json({
    ok: true,
    count: TOOLS.length,
    groups,
    studios: STUDIOS.map((s) => ({
      slug: s.slug,
      name: s.name,
      line: s.line,
      tools: s.tools
        .map((id) => TOOLS.find((t) => t.id === id))
        .filter(Boolean)
        .map((t) => publicTool(t!)),
    })),
  });
}
