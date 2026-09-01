/**
 * Tool-call parser for the coding agent.
 *
 * Models trained on Cursor / Claude Code / OpenAI tools emit `create_file`
 * (and `contents` / `file_path`) more often than our own `write_file`.
 * Before this module those turns parsed as a valid JSON object with an
 * unknown tool, so the loop burned its budget without writing a file.
 *
 * Kept free of the store and of providers so tests can compile it alone.
 */

export type AgentToolName =
  | "list_files"
  | "read_file"
  | "write_file"
  | "delete_file"
  | "run_check"
  | "finish";

export const AGENT_TOOL_NAMES: readonly AgentToolName[] = [
  "list_files",
  "read_file",
  "write_file",
  "delete_file",
  "run_check",
  "finish",
];

export type AgentToolCall = {
  tool: AgentToolName;
  path?: string;
  content?: string;
  lang?: string;
  summary?: string;
};

const TOOL_ALIASES: Record<string, AgentToolName> = {
  create_file: "write_file",
  createfile: "write_file",
  writefile: "write_file",
  save_file: "write_file",
  update_file: "write_file",
  edit_file: "write_file",
  readfile: "read_file",
  listfiles: "list_files",
  deletefile: "delete_file",
  removefile: "delete_file",
  runcheck: "run_check",
  lint: "run_check",
  done: "finish",
};

function keyOf(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export function canonicalToolName(raw: string): AgentToolName | null {
  const key = keyOf(raw);
  if (!key) return null;
  const mapped = TOOL_ALIASES[key] || (AGENT_TOOL_NAMES as readonly string[]).find((n) => n === key);
  return (mapped as AgentToolName) || null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

/**
 * Flatten `{ tool, ... }`, `{ name, arguments }`, and `{ tool, args }` into
 * one bag of fields so the rest of the agent only has to read `path`/`content`.
 */
export function normalizeToolCall(raw: unknown): AgentToolCall | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const nested =
    asRecord(obj.arguments) ||
    asRecord(obj.args) ||
    asRecord(obj.input) ||
    asRecord(obj.parameters) ||
    null;
  // OpenAI tool calls sometimes JSON-encode the arguments object.
  let args: Record<string, unknown> = nested || {};
  if (!nested && typeof obj.arguments === "string") {
    try {
      args = asRecord(JSON.parse(obj.arguments)) || {};
    } catch {
      args = {};
    }
  }
  const bag: Record<string, unknown> = { ...args, ...obj };

  const tool = canonicalToolName(
    String(bag.tool || bag.name || bag.action || bag.function || "")
  );
  if (!tool) return null;

  const path = pickString(bag, ["path", "file_path", "filename", "file", "target"]);
  const content = pickString(bag, ["content", "contents", "file_content", "body", "code", "text"]);
  const lang = pickString(bag, ["lang", "language"]);
  const summary = pickString(bag, ["summary", "message", "reason"]);

  const call: AgentToolCall = { tool };
  if (path) call.path = path;
  if (content) call.content = content;
  if (lang) call.lang = lang;
  if (summary) call.summary = summary;
  return call;
}

/** Extract the first JSON object from a model reply, tolerating stray prose. */
export function parseToolCall(raw: string): AgentToolCall | null {
  if (!raw) return null;
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    return normalizeToolCall(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}
