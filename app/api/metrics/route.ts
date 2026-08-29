import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { bump, sampleTtft, snapshot } from "@/lib/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal metrics (Update #2). GET → snapshot JSON. POST → client beat
 * { kind: "ttft" | "done" | "regenerate" | "recovery_use_another_model", ms? }.
 * Not linked in public UI/sitemap — ops only, zero PII.
 */

export async function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`metrics:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "");
  if (kind === "ttft" && typeof body.ms === "number") sampleTtft(body.ms);
  else if (kind) bump(kind);
  return NextResponse.json({ ok: true });
}
