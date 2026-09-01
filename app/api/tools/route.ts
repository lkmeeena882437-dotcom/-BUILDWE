import { NextResponse, type NextRequest } from "next/server";
import { CREDITS } from "@/lib/config";
import { TOOLS, STUDIOS, toolsByCategory } from "@/lib/tools/registry";
import { publicTool, type ToolSpec } from "@/lib/tools/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tools
 * The catalogue as data, so `/tools`, the workspace launcher and the mobile
 * menu all render the same list from one source instead of a hand-maintained
 * array that can drift from what actually runs.
 *
 * `?brief=1` is the same list without the parts a menu cannot use: no field
 * schemas, no examples, no prompt-shaped descriptions — id, name, category,
 * tagline, cost. The full answer is 104 kB, which is fine for a page that is
 * about to render a form and absurd for one that is drawing 31 names. The
 * projection lives here rather than in a client filter because the client
 * still has to download what it filters.
 */
export async function GET(req: NextRequest) {
  const brief = req.nextUrl.searchParams.get("brief") === "1";
  const row = (t: ToolSpec) =>
    brief
      ? { id: t.id, name: t.name, category: t.category, tagline: t.tagline, creditCost: t.creditCost ?? CREDITS.cost.tool }
      : publicTool(t);

  const groups = toolsByCategory().map((g) => ({
    category: g.category,
    tools: g.tools.map(row),
  }));
  const body = {
    ok: true,
    count: TOOLS.length,
    brief,
    groups,
    studios: STUDIOS.map((s) => ({
      slug: s.slug,
      name: s.name,
      line: s.line,
      // A studio's tools are only listed so a page can link them; a launcher links the
      // studio itself, so in brief mode the array is left out whole.
      ...(brief ? {} : {
        tools: s.tools
          .map((id) => TOOLS.find((t) => t.id === id))
          .filter(Boolean)
          .map((t) => publicTool(t!)),
      }),
    })),
  };
  return NextResponse.json(body, {
    // Nothing in here is per-user, and the registry only changes on a deploy.
    headers: { "Cache-Control": brief ? "public, max-age=300, stale-while-revalidate=3600" : "public, max-age=60" },
  });
}
