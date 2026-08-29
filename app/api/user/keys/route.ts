import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById, updateUser } from "@/lib/db/store";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function view(u: ReturnType<typeof findUserById>) {
  const groq = u?.byok?.groq ? decryptSecret(u.byok.groq) : "";
  const openrouter = u?.byok?.openrouter ? decryptSecret(u.byok.openrouter) : "";
  return {
    keys: {
      groq: groq ? maskSecret(groq) : null,
      openrouter: openrouter ? maskSecret(openrouter) : null,
    },
    active: Boolean(groq || openrouter),
  };
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (session.kind !== "user") {
    return NextResponse.json({ requireAuth: true, keys: { groq: null, openrouter: null }, active: false });
  }
  const u = findUserById(session.userId);
  return NextResponse.json(view(u));
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        { error: "Log in to save your own API keys." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const u = findUserById(session.userId);
    if (!u) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const next: { groq?: string; openrouter?: string } = { ...u.byok };

    if (body.clear === "groq") delete next.groq;
    else if (typeof body.groq === "string" && body.groq.trim().length >= 20) {
      next.groq = encryptSecret(body.groq.trim());
    }

    if (body.clear === "openrouter") delete next.openrouter;
    else if (typeof body.openrouter === "string" && body.openrouter.trim().length >= 20) {
      next.openrouter = encryptSecret(body.openrouter.trim());
    }

    updateUser(session.userId, { byok: next });
    const updated = findUserById(session.userId);
    return NextResponse.json(view(updated));
  } catch (e) {
    console.error("[bw] byok save", e);
    return NextResponse.json({ error: "Couldn’t save keys." }, { status: 500 });
  }
}
