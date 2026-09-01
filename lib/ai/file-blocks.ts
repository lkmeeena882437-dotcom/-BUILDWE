/**
 * The file block a model can hand back, and the only thing allowed to write a project
 * file from a chat answer.
 *
 * Split out of `lib/ai/workspace-context.ts` on purpose: the *formatter* and the prompt
 * instruction are server-side text that no browser should ever download, while this
 * parser has to run in the client to draw the Apply button. One module each, one
 * definition of the format, and `fileEditInstruction()` builds its example from
 * `fileBlockExample()` here — so the rules we show the model describe exactly the block
 * this parser accepts, and a test fails if those ever drift.
 *
 * The format is a fenced block whose first line names the file:
 *
 *   ` ````buildwe-file` / `path: src/index.html` / the complete new file / ` ```` `
 *
 * Why a first line instead of `path="…"` on the info string: the shared markdown
 * renderer (`lib/safe-md.ts`) allows only short, boring, attribute-safe fence labels —
 * widening that for one feature would change how code renders on 63 pages. The parser
 * still accepts the attribute form, because models write it.
 */

/** The fence label. Written by the instruction, matched here, one owner. */
export const FILE_FENCE_LANG = "buildwe-file";

/** The exact example the model is shown. Also the parser's favourite fixture. */
export function fileBlockExample(): string {
  return [
    "```" + FILE_FENCE_LANG,
    "path: src/index.html",
    "<!doctype html><html>…the complete new contents of that file…</html>",
    "```",
  ].join("\n");
}

export type FileBlock = {
  path: string;
  lang: string | null;
  content: string;
  /** Why this block cannot be applied, in the words the row shows. */
  problem: string | null;
};

/** `name="value"` or `name=value` in a fence info string, quoted form first. */
function attrValue(name: string, info: string): string | null {
  const quoted = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(info);
  if (quoted) return quoted[1].trim();
  const bare = new RegExp(name + "\\s*=\\s*([^\\s\"]+)", "i").exec(info);
  return bare ? unquote(bare[1]) : null;
}

function unquote(v: string): string {
  return v.replace(/^["'`]|["'`]$/g, "").trim();
}

/**
 * Pull the applicable file blocks out of an answer.
 *
 * Tolerant on form, strict on the one thing that matters. The info string may be
 * `buildwe-file`, `buildwe-file path="x"` or `buildwe-file lang=ts`; the fence may use
 * three or more backticks (a file containing ``` must not end its own block early);
 * `path` may live on the info string or as the first body line. A block **without a path
 * is never applied to a guess** — it comes back with a `problem`, and the row says why.
 */
export function extractFileBlocks(text: string): FileBlock[] {
  const src = String(text || "");
  const out: FileBlock[] = [];
  // CommonMark's own rule, because it is the only one that survives a file
  // containing three backticks: the closer is a line of *nothing but* backticks, at
  // least as long as the opener. Without that, a fenced block inside the file ends the
  // block early and the "apply" writes half a file.
  const re = /(`{3,})[ \t]*buildwe-file([^\n]*)\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    const info = String(m[2] || "");
    const body = m[3] || "";
    const lines = body.split("\n");

    let path = attrValue("path", info) || "";
    let lang: string | null = attrValue("lang", info);

    // Canonical form: `path:` and an optional `lang:` as the leading body lines.
    let contentFrom = 0;
    for (let i = 0; i < Math.min(lines.length, 2); i++) {
      const pm = /^\s*path\s*:\s*(.+?)\s*$/i.exec(lines[i]);
      if (pm && !path) {
        path = unquote(pm[1]);
        contentFrom = i + 1;
        continue;
      }
      const lm = /^\s*lang\s*:\s*(.+?)\s*$/i.exec(lines[i]);
      if (lm) {
        lang = unquote(lm[1]);
        contentFrom = i + 1;
        continue;
      }
      break;
    }

    const content = lines.slice(contentFrom).join("\n").replace(/\n+$/, "");
    const trimmed = path.trim();
    out.push({
      path: trimmed,
      lang,
      content,
      problem: !trimmed
        ? "The reply did not name a file for this block, so there is nothing to write."
        : !content.trim()
          ? "The block is empty — applying it would blank the file."
          : null,
    });
  }
  return out;
}
