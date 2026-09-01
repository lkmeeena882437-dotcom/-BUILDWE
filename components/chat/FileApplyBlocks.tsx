"use client";

import { useState } from "react";
import { AlertTriangle, Check, FileDown } from "lucide-react";
import { extractFileBlocks } from "@/lib/ai/file-blocks";

/**
 * "Apply to file" — the end of the chat ↔ workspace loop.
 *
 * When an answer carries a `buildwe-file` block, the code stops being text to
 * copy-paste: this row writes it into the project through the existing
 * `POST /api/projects/files`, and the page updates the canvas/version history for the
 * file if it happens to be the one you have open.
 *
 * What it will not do:
 *  - offer Apply for a block with no path, or an empty one (a file blanked by a
 *    truncated answer is a data loss, not a shortcut);
 *  - invent success — the row shows the server's own sentence when the write is
 *    refused (invalid path, over the size cap, no such project);
 *  - write anything at all while a reply is still streaming (the caller decides that).
 *
 * The network call is a prop, not an import: `app/page.tsx` already owns saving files,
 * reloading the list and the canvas versions, and a second owner of that would be a
 * second behaviour.
 */
export type ApplyHandler = (block: {
  path: string;
  content: string;
  lang: string | null;
}) => Promise<string | null>;

export function FileApplyBlocks({
  text,
  projectId,
  knownPaths = [],
  onApply,
}: {
  text: string;
  projectId: string | null;
  /** Paths already in the project, so the button can say Replace rather than Create. */
  knownPaths?: string[];
  onApply: ApplyHandler;
}) {
  const blocks = extractFileBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5" data-file-blocks={blocks.length}>
      {blocks.map((b, i) => (
        <FileApplyRow
          // A reply can contain the same path twice; the index keeps the rows distinct.
          key={`${b.path}:${i}`}
          block={b}
          projectId={projectId}
          exists={b.path ? knownPaths.includes(b.path) : false}
          onApply={onApply}
        />
      ))}
    </div>
  );
}

function FileApplyRow({
  block,
  projectId,
  exists,
  onApply,
}: {
  block: ReturnType<typeof extractFileBlocks>[number];
  projectId: string | null;
  exists: boolean;
  onApply: ApplyHandler;
}) {
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);

  const bytes = block.content.length;
  const label = block.path || "unnamed file";

  const run = async () => {
    if (state === "busy") return;
    setState("busy");
    setErr(null);
    const problem = await onApply({
      path: block.path,
      content: block.content,
      lang: block.lang,
    });
    if (problem) {
      setErr(problem);
      setState("idle");
      return;
    }
    setState("saved");
  };

  if (block.problem) {
    return (
      <div className="bw-apply bw-apply--blocked" role="note">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <strong className="font-mono text-[11px]">{label}</strong> — {block.problem}
        </span>
      </div>
    );
  }

  return (
    <div className="bw-apply">
      <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-mono text-[11px]">{label}</strong>
        <span className="bw-apply__meta">
          {bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`}
          {block.lang ? ` · ${block.lang}` : ""}
        </span>
      </span>
      {state === "saved" ? (
        <span className="bw-apply__done" role="status">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {exists ? "Replaced" : "Saved"}
        </span>
      ) : (
        <button
          type="button"
          className="bw-apply__btn"
          onClick={() => void run()}
          disabled={state === "busy" || !projectId}
          title={
            !projectId
              ? "Pick a project first — files are saved inside a project"
              : exists
                ? `Replace ${block.path} in this project`
                : `Create ${block.path} in this project`
          }
          aria-label={`${state === "busy" ? "Writing" : exists ? "Replace" : "Apply"} ${block.path} to the project files`}
        >
          {state === "busy"
            ? "Writing…"
            : !projectId
              ? "No project selected"
              : exists
                ? `Replace ${block.path}`
                : `Apply to ${block.path}`}
        </button>
      )}
      {err ? (
        <p className="bw-apply__err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
