import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";
import { OPS_TOKEN } from "@/lib/config";
import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/store";
import { bump, sampleTtft, snapshot } from "@/lib/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal metrics (Update #2). GET → snapshot JSON. POST → client beat
 * { kind: "ttft" | "done" | "regenerate" | "recovery_use_another_model", ms? }.
 * Not linked in public UI/sitemap — ops only, zero PII.
 */

/** Ops-only: needs BW_OPS_TOKEN, or a session whose email is in ADMIN_EMAILS. */
function authorized(req: NextRequest): boolean {
  const supplied =
    req.headers.get("x-bw-ops-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (OPS_TOKEN && supplied && supplied === OPS_TOKEN) return true;
  return false;
}

async function adminFromSession(req: NextRequest): Promise<boolean> {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return false;
  const session = await getSessionFromRequest(req);
  if (session.kind !== "user") return false;
  const user = findUserById(session.userId);
  return Boolean(user && list.includes(user.email.toLowerCase()));
}

export async function GET(req: NextRequest) {
  // This used to answer anyone. Model/provider/DB internals in one tidy JSON
  // document is a reconnaissance gift, so it is now behind an ops token or an
  // admin session (audit HIGH: /api/metrics public).
  if (!authorized(req) && !(await adminFromSession(req))) {
    return NextResponse.json(
      { error: "Operational metrics are not public." },
      { status: 401 }
    );
  }
  return NextResponse.json(snapshot());
}

/** Only these beat names are counted; `kind` was passed to bump() unchecked. */
const ALLOWED_KINDS = new Set([
  "ttft",
  "done",
  "regenerate",
  "recovery_use_another_model",
  "compare_run",
  "compare_offline",
  "image_gen",
  "audio_gen",
  "agent_run",
  "limit_block",
  "auth_fail",
]);

export async function POST(req: NextRequest) {
  const rl = rateLimit(`metrics:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "").slice(0, 40);
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: "Unknown metric." }, { status: 400 });
  }
  if (kind === "ttft" && Number.isFinite(body?.ms)) {
    sampleTtft(Math.max(0, Math.min(600_000, Number(body.ms))));
  } else {
    bump(kind);
  }
  return NextResponse.json({ ok: true });
}
