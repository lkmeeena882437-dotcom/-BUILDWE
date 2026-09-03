/**
 * What a browser is allowed to see. Technical failures stay in server logs.
 *
 * Importable from client code: this file has no secrets, no env, no store.
 */

export const PUBLIC_ERROR = "Something went wrong. Please try again.";
export const PUBLIC_NETWORK = "Connection problem. Try again in a moment.";
export const PUBLIC_TIMEOUT = "That took too long. Try again.";
export const PUBLIC_STORE = "Couldn’t save that right now. Please try again.";

/**
 * Strings that never belong in a UI: filesystem, SQL, stacks, keys, hostnames
 * of our own infra. A message that matches is replaced, not shown.
 */
const LEAK =
  /ENOENT|EACCES|EPERM|ECONN|ENOTFOUND|ETIMEDOUT|stack(?:trace)?|postgres|supabase|sqlstate|relation ["']|column ["']|\/home\/|\/var\/|\/tmp\/|node_modules|at \w+ \(|passwordHash|service_role|SERVICE_ROLE|RAZORPAY_KEY|SESSION_SECRET|gsk_|sk-or-|sk_live|sk_test|BEGIN [A-Z ]+PRIVATE|api[_-]?key|x-razorpay|authorization:\s*bearer/i;

const ALLOWED =
  /invalid email or password|already registered|not found|log in|sign in|try again|too long|too many|limit reached|not configured|couldn[’']t|could not|please try|enter a valid|min 8|required|unavailable|not a team member|busy|credits|top up|shorten|attach/i;

export function looksLikeInternalError(text: string): boolean {
  const s = String(text || "");
  if (!s) return false;
  if (LEAK.test(s)) return true;
  if (s.length > 220) return true;
  if (/\n\s*at\s+/.test(s)) return true;
  return false;
}

/** Keep a short, human sentence; replace anything that looks like a dump. */
export function publicErrorMessage(raw: unknown, fallback = PUBLIC_ERROR): string {
  if (raw == null) return fallback;
  const s = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  if (looksLikeInternalError(trimmed)) return fallback;
  if (ALLOWED.test(trimmed) && trimmed.length <= 180) return trimmed;
  // Unknown copy: still show it if it is a short sentence without internals.
  if (trimmed.length <= 140 && !/[\\/]/.test(trimmed) && !LEAK.test(trimmed)) return trimmed;
  return fallback;
}

/** Strip leaky fields off a JSON body before the client throws or renders it. */
export function scrubErrorBody(j: unknown): Record<string, unknown> {
  if (!j || typeof j !== "object") return {};
  const o = { ...(j as Record<string, unknown>) };
  delete o.stack;
  delete o.trace;
  delete o.sql;
  delete o.detail;
  delete o.details;
  delete o.hint;
  // `hint` is used as a user-facing Hinglish tip on several routes. Keep it
  // only when it does not look like a dump.
  const src = j as Record<string, unknown>;
  if (typeof src.hint === "string" && !looksLikeInternalError(src.hint) && src.hint.length <= 180) {
    o.hint = src.hint;
  }
  if (typeof o.error === "string") o.error = publicErrorMessage(o.error);
  if (typeof o.message === "string" && looksLikeInternalError(String(o.message))) {
    o.message = PUBLIC_ERROR;
  }
  return o;
}
