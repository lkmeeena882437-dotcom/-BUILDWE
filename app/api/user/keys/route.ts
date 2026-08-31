import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById, updateUser } from "@/lib/db/store";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A stored key is used for every request that user makes, so a typo must fail
 * HERE — not later, as a mysterious "AI is unavailable" (audit A14: the route
 * used to accept any 20-character string, so `aaaaaaaaaaaaaaaaaaaaaaaa` was a
 * valid "Groq key" and the user only found out when nothing worked).
 *
 * These are the published prefixes for the two BYOK vendors we support. A new
 * vendor shape means a new entry plus a new test case, not a looser regex.
 */
const KEY_SHAPES: Record<string, { re: RegExp; expect: string }> = {
  groq: { re: /^gsk_[A-Za-z0-9_-]{20,120}$/, expect: "gsk_… (Groq console → API Keys)" },
  openrouter: { re: /^sk-or-v1-[A-Za-z0-9]{20,120}$/, expect: "sk-or-v1-… (openrouter.ai/keys)" },
};

const MAX_KEY_CHARS = 160;

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
    const rejected: string[] = [];

    for (const provider of ["groq", "openrouter"] as const) {
      if (body.clear === provider) {
        delete next[provider];
        continue;
      }
      const given = body?.[provider];
      if (typeof given !== "string" || !given.trim()) continue; // not touched
      const value = given.trim();
      if (value.length > MAX_KEY_CHARS || !KEY_SHAPES[provider].re.test(value)) {
        rejected.push(`${provider}: ${KEY_SHAPES[provider].expect}`);
        continue;
      }
      next[provider] = encryptSecret(value);
    }

    if (rejected.length) {
      // Nothing is saved on a bad shape: a half-updated key set is worse than
      // no update, because the user believes the fix took.
      return NextResponse.json(
        {
          error: "That doesn't look like a real API key, so nothing was saved.",
          code: "KEY_FORMAT",
          hint: rejected.join(" · "),
        },
        { status: 422 }
      );
    }

    updateUser(session.userId, { byok: next });
    const updated = findUserById(session.userId);
    return NextResponse.json(view(updated));
  } catch (e) {
    console.error("[bw] byok save", e);
    return NextResponse.json({ error: "Couldn’t save keys." }, { status: 500 });
  }
}
