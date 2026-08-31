/**
 * Tool input validation — the server decides what a tool accepts.
 *
 * The client renders its form from the same spec, but nothing about trust
 * depends on that: every value is required-checked, type-coerced, length
 * clamped, and select-validated against the spec's own option list here. A
 * client that posts `tone: "<script src=…>"` to a select field gets rejected,
 * because free text isn't one of the option values. That also stops someone
 * from smuggling an instruction into a fixed-choice field.
 */

import type { ToolField, ToolSpec, ToolResolution, Values } from "./types";

/** Whole-request ceiling; the per-field caps do the real work. */
const TOTAL_CHARS = 60_000;

/** control chars except \n and \t — they must not reach a prompt */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(value: unknown, max: number): { text: string; trimmed: boolean } {
  let s = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  s = s.replace(CONTROL_CHARS, "").replace(/\r\n/g, "\n");
  // collapse absurd runs of blank lines (prompt padding)
  s = s.replace(/\n{4,}/g, "\n\n\n");
  const trimmed = s.length > max;
  if (trimmed) s = s.slice(0, max);
  return { text: s.trim(), trimmed };
}

export function resolveInputs(spec: ToolSpec, raw: unknown): ToolResolution {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!src) return { ok: false, error: "Send the tool inputs as a JSON object under `inputs`." };

  const values: Values = {};
  const notes: string[] = [];
  const bad: string[] = [];
  let total = 0;

  for (const f of spec.fields) {
    const field = f as ToolField;
    const given = src[field.key];

    if (field.kind === "checkbox") {
      values[field.key] = given === true || given === "true" || given === 1 || given === "1";
      continue;
    }

    if (field.kind === "number") {
      const n = Number(given);
      if (given === undefined || given === null || given === "" || !Number.isFinite(n)) {
        if (field.default !== undefined) {
          values[field.key] = Number(field.default);
          continue;
        }
        if (field.required) {
          bad.push(field.key);
          notes.push(`${field.label}: a number is required`);
        }
        continue;
      }
      const min = Number(field.min ?? -1e9);
      const max = Number(field.max_value ?? 1e9);
      const clamped = Math.min(max, Math.max(min, Math.round(n)));
      if (clamped !== n) notes.push(`${field.label}: clamped to ${clamped} (allowed ${min}–${max})`);
      values[field.key] = clamped;
      continue;
    }

    if (field.kind === "select") {
      const allowed = (field.options || []).map((o) => String(o.value));
      const v = String(given ?? "").trim();
      if (!v) {
        if (field.default && allowed.includes(String(field.default))) {
          values[field.key] = String(field.default);
          continue;
        }
        if (field.required) {
          bad.push(field.key);
          notes.push(`${field.label}: choose one of ${allowed.join(", ")}`);
        }
        continue;
      }
      if (!allowed.includes(v)) {
        bad.push(field.key);
        notes.push(
          `${field.label}: "${v.slice(0, 40)}" is not an option (allowed: ${allowed.join(", ")})`
        );
        continue;
      }
      values[field.key] = v;
      continue;
    }

    // text / textarea
    const cap = Number(field.max) || (field.kind === "textarea" ? 6000 : 300);
    const { text, trimmed } = clean(given, cap);
    if (trimmed) notes.push(`${field.label}: trimmed to ${cap} characters`);
    if (!text) {
      if (field.required) {
        bad.push(field.key);
        notes.push(`${field.label} is required`);
      }
      continue;
    }
    total += text.length;
    values[field.key] = text;
  }

  if (bad.length) {
    return {
      ok: false,
      error: notes.join(" · ") || "Some required inputs are missing.",
      fields: bad,
    };
  }
  if (total > TOTAL_CHARS) {
    return {
      ok: false,
      error: `That's too much text for one run (${total} characters, limit ${TOTAL_CHARS}). Split it or use the workspace chat.`,
    };
  }
  if (!Object.keys(values).length) {
    return { ok: false, error: "Nothing to do — this tool needs at least one filled field." };
  }
  return { ok: true, values, notes };
}

/** Compose the two prompts for a run. Kept here so tests can assert on them. */
export function buildPrompts(spec: ToolSpec, values: Values): { system: string; user: string } {
  const system = String(spec.buildSystem(values) || "").trim();
  const user = String(spec.buildUser(values) || "").trim();
  if (!user) throw new Error(`tool ${spec.id} produced an empty prompt`);
  return { system, user };
}
