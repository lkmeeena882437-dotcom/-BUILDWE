import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";
import {
  ARTIFACT_TITLE_MAX,
  deleteArtifact,
  findShareByArtifact,
  getArtifact,
  listArtifacts,
  listGenerations,
  updateArtifact,
  type Generation,
} from "@/lib/db/store";

/** What the creations list needs — never more, because a list is drawn 60 times a session. */
function shape(g: Generation, opts: { full?: boolean } = {}) {
  return {
    id: g.id,
    type: g.type,
    prompt: g.prompt,
    title: g.title ?? null,
    pinned: Boolean(g.pinned),
    outputUrl: g.outputUrl ?? null,
    // Text outputs can be long (a whole file, a vision description) — trim for the list.
    outputText: opts.full
      ? g.outputText
      : g.outputText
        ? g.outputText.slice(0, 2000)
        : undefined,
    meta: g.meta,
    shareId: null as string | null,
    createdAt: g.createdAt,
  };
}

/** True when there is an output a reader could actually open. */
function shareable(g: Generation) {
  return g.type === "code" ? Boolean(g.outputText?.trim()) : Boolean(g.outputUrl);
}

function json400(code: string, error: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/generations?type=image|audio|code&limit=n
 *
 * Generation history (Update #1 §4.5) and the artifacts list (UI step 10). Image and
 * audio outputs were already being persisted via addGeneration(), but nothing ever read
 * them back — the user's past creations existed in the database and were unreachable from
 * the product. This exposes them, owner-scoped; `?view=artifacts` adds the curated
 * ordering (pinned first) and the curation fields, and every read here is by `userId`, so
 * a guessed id from another account is a 404 rather than a leak.
 *
 * The `prompt` is returned so a result can be re-run (§4.3 retry).
 * PATCH renames/pins, DELETE removes the row and the public link made from it.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const url = new URL(req.url);

    // One artifact, untruncated — what "open in canvas" reads. Owner-scoped by id+userId,
    // so a guessed id from another account is a 404 rather than a leak.
    const onlyId = url.searchParams.get("id");
    if (onlyId !== null) {
      const g = getArtifact(onlyId, session.userId);
      if (!g) {
        return NextResponse.json(
          { error: "That creation is not yours or no longer exists.", code: "ARTIFACT_NOT_FOUND" },
          { status: 404 }
        );
      }
      const share = findShareByArtifact(g.id);
      const res = NextResponse.json({ artifact: { ...shape(g, { full: true }), shareId: share?.id ?? null } });
      attachGuestCookie(res, session.userId);
      return res;
    }

    const view = url.searchParams.get("view") === "artifacts" ? "artifacts" : "raw";
    const typeParam = url.searchParams.get("type");
    const type =
      typeParam === "image" || typeParam === "audio" || typeParam === "code"
        ? typeParam
        : undefined;

    // NOTE: a missing param yields null, and Number(null) === 0 (finite), so
    // read the raw string first — otherwise the default silently becomes 1.
    const limitParam = url.searchParams.get("limit");
    const limitRaw = limitParam === null ? NaN : Number(limitParam);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100)
      : 50;

    // Two views of the same rows on purpose: `raw` is the log the studios restore behind
    // their session items (order and contents as they were before the creations panel
    // existed), `artifacts` is the curated list — pinned first, no vision analyses, and
    // each row carrying whether it already has a public link so the menu can say "Shared".
    const items =
      view === "artifacts"
        ? listArtifacts(session.userId, type)
            .slice(0, limit)
            .map((g) => {
              const share = findShareByArtifact(g.id);
              return {
                ...shape(g),
                shareId: share?.id ?? null,
                shareable: shareable(g),
              };
            })
        : listGenerations(session.userId, type)
            .slice(0, limit)
            .map((g) => shape(g));

    const res = NextResponse.json(
      view === "artifacts"
        ? { artifacts: items, count: items.length, titleMax: ARTIFACT_TITLE_MAX }
        : { generations: items, count: items.length }
    );
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] generations GET", e);
    // An empty list is a lie when the read failed — the panel would say "nothing here yet"
    // while the rows still exist. Say it failed.
    return NextResponse.json(
      { error: "Could not load your creations right now.", code: "GENERATIONS_UNAVAILABLE" },
      { status: 503 }
    );
  }
}

/**
 * PATCH {id, title?, pinned?} — rename and pin. Both are a whole-document write, so the
 * bucket is here rather than only on the client button.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("artifacts-write", session.userId, 60, 60_000);
    if (!rl.ok) return NextResponse.json({ error: rl.error, hint: rl.hint }, { status: 429 });

    const body = await req.json().catch(() => ({}));
    const id = String((body as { id?: unknown }).id ?? "");
    if (!id) return json400("BAD_REQUEST", "No creation was named in that request.");

    const rawTitle = (body as { title?: unknown }).title;
    const rawPin = (body as { pinned?: unknown }).pinned;
    if (rawTitle === undefined && rawPin === undefined) {
      return json400("NOTHING_TO_CHANGE", "Nothing to change was sent.");
    }
    if (rawTitle !== undefined && rawTitle !== null && typeof rawTitle !== "string") {
      return json400("BAD_TITLE", "A title has to be text.");
    }
    if (rawPin !== undefined && typeof rawPin !== "boolean") {
      return json400("BAD_PIN", "Pinned has to be true or false.");
    }

    const out = updateArtifact(id, session.userId, {
      ...(rawTitle === undefined ? {} : { title: rawTitle as string | null }),
      ...(rawPin === undefined ? {} : { pinned: rawPin as boolean }),
    });
    if (!out.ok) {
      const msg =
        out.code === "TITLE_TOO_LONG"
          ? `A title can be up to ${ARTIFACT_TITLE_MAX} characters.`
          : out.code === "ARTIFACT_NOT_FOUND"
            ? "That creation is not yours or no longer exists."
            : "Nothing to change was sent.";
      return NextResponse.json({ error: msg, code: out.code }, { status: out.code === "ARTIFACT_NOT_FOUND" ? 404 : 400 });
    }
    const share = findShareByArtifact(out.artifact.id);
    const res = NextResponse.json({
      artifact: { ...shape(out.artifact), shareId: share?.id ?? null, shareable: shareable(out.artifact) },
    });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] generations PATCH", e);
    return NextResponse.json(
      { error: "Could not save that change.", code: "ARTIFACT_WRITE_FAILED" },
      { status: 500 }
    );
  }
}

/**
 * DELETE ?id=… — the row and any public link made from it, in one write (see
 * deleteArtifact). Refuses with a code so the panel can say why instead of vanishing a
 * row optimistically and putting it back.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("artifacts-write", session.userId, 60, 60_000);
    if (!rl.ok) return NextResponse.json({ error: rl.error, hint: rl.hint }, { status: 429 });

    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return json400("BAD_REQUEST", "No creation was named in that request.");
    // The store answers "not yours" itself, so there is no read before the write: one
    // whole-document parse either way, and no window where the row vanishes between them.
    const out = deleteArtifact(id, session.userId);
    if (!out.ok) {
      return NextResponse.json(
        { error: "That creation is not yours or no longer exists.", code: "ARTIFACT_NOT_FOUND" },
        { status: 404 }
      );
    }
    const res = NextResponse.json({ ok: true });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] generations DELETE", e);
    return NextResponse.json(
      { error: "Could not delete that creation.", code: "ARTIFACT_WRITE_FAILED" },
      { status: 500 }
    );
  }
}
