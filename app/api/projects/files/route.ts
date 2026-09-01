import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { limitAi } from "@/lib/rate-limit/guard";
import {
  deleteProjectFile,
  getProjectFile,
  listProjectFiles,
  saveProjectFile,
} from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Project file API — Coding Agent read/write (Update #1 §3.1, §3.2, §3.6).
 *
 * GET    /api/projects/files?projectId=…        → list (metadata only)
 * GET    /api/projects/files?projectId=…&id=…   → one file with content
 * POST   { projectId, path, content, lang? }    → create/update (upsert)
 * DELETE ?id=…                                  → remove
 *
 * Every operation is scoped to the session owner inside the store layer, so a
 * guessed projectId or fileId belonging to someone else simply resolves to
 * nothing (§5.7 user-data isolation).
 */

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    const fileId = url.searchParams.get("id");

    if (fileId) {
      const file = getProjectFile(fileId, session.userId);
      if (!file) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      const res = NextResponse.json({ file });
      attachGuestCookie(res, session.userId);
      return res;
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    // List stays lightweight — content is fetched per file on demand.
    const files = listProjectFiles(projectId, session.userId).map((f) => ({
      id: f.id,
      path: f.path,
      lang: f.lang,
      size: f.content.length,
      updatedAt: f.updatedAt,
    }));
    const res = NextResponse.json({ files });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] project files GET", e);
    return NextResponse.json({ files: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const rl = await limitAi("proj-files", session.userId, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: rl.error, code: "RATE_LIMIT", hint: rl.hint },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId || "");
    const path = String(body?.path || "");
    if (!projectId || !path) {
      return NextResponse.json(
        { error: "projectId and path are required." },
        { status: 400 }
      );
    }

    const result = saveProjectFile({
      userId: session.userId,
      projectId,
      path,
      content: String(body?.content ?? ""),
      lang: body?.lang ? String(body.lang) : undefined,
    });

    if ("error" in result) {
      // The message is written for a person and the code is for the caller: the chat's
      // "Apply to file" button shows the sentence and branches on the code.
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: 400 }
      );
    }

    const res = NextResponse.json({ ok: true, file: result.file });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] project files POST", e);
    return NextResponse.json({ error: "Couldn't save that file." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const removed = deleteProjectFile(id, session.userId);
    return NextResponse.json({ ok: removed });
  } catch (e) {
    console.error("[bw] project files DELETE", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
