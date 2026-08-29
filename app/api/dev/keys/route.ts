import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { addApiKey, deleteApiKey, listApiKeys } from "@/lib/db/store";
import { newApiKey, sha256Hex } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (session.kind !== "user") {
    return NextResponse.json({ requireAuth: true, keys: [] });
  }
  const keys = listApiKeys(session.userId).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
  }));
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session.kind !== "user") {
      return NextResponse.json(
        { error: "Log in to create API keys." },
        { status: 401 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 40) || "My key";
    const secret = newApiKey();
    const row = addApiKey({
      userId: session.userId,
      name,
      keyHash: sha256Hex(secret),
      prefix: secret.slice(0, 11),
    });
    // secret is shown exactly once
    return NextResponse.json({
      key: { id: row.id, name: row.name, prefix: row.prefix },
      secret,
    });
  } catch (e) {
    console.error("[bw] dev key create", e);
    return NextResponse.json({ error: "Couldn’t create key." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  deleteApiKey(id, session.userId);
  return NextResponse.json({ ok: true });
}
