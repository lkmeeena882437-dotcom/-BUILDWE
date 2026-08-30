/**
 * BUILDWE AI Gateway — one door for every provider call.
 *
 * Boss Update #1 · sections 1 (provider abstraction), 7 (cost control),
 * 9 (reliability). This is ADDITIVE: `lib/ai/providers.ts` keeps its public
 * API and simply calls through here, so nothing that already works changes
 * behaviour — it just gains timeouts, retries and sanitised errors.
 *
 * What the gateway guarantees for every outbound provider request:
 *
 *  1. TIMEOUT   — audit V4: LLM calls had NO AbortController at all. A hanging
 *                 provider could pin a request (and its cost) open indefinitely.
 *  2. RETRY     — transient failures (429 / 5xx / network) retry with backoff;
 *                 deterministic failures (400 / 401 / 403) never retry, because
 *                 retrying a bad key just burns quota.
 *  3. SANITISED — audit section 9.4: raw provider text never reaches a user.
 *                 We map to a friendly message + machine-readable code.
 *  4. OBSERVED  — attempts/failures counted for the internal metrics endpoint.
 */

import { bump } from "@/lib/metrics/metrics";

/* ── Budgets ──────────────────────────────────────────────── */

export const TIMEOUTS = {
  /** first byte of a streaming completion */
  stream: 30_000,
  /** full non-streaming completion */
  complete: 45_000,
  /** vision is heavier — images take longer to encode/inspect */
  vision: 60_000,
  /** text-to-speech */
  audio: 45_000,
  /** web search */
  search: 9_000,
} as const;

/**
 * Input ceilings (audit V2/V3). Rate limiting caps how OFTEN a caller can ask;
 * these cap how EXPENSIVE any single ask can be. Without them one request with
 * a multi-megabyte prompt can cost more than a thousand normal ones.
 */
export const INPUT_LIMITS = {
  /** per message */
  messageChars: 24_000,
  /** whole conversation sent upstream */
  conversationChars: 120_000,
  /** image / audio / code-action prompts */
  promptChars: 8_000,
  /** TTS script */
  audioChars: 5_000,
  /** messages retained per request */
  maxMessages: 40,
} as const;

/* ── Error taxonomy ───────────────────────────────────────── */

export type GatewayErrorCode =
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTH"
  | "BAD_REQUEST"
  | "PROVIDER_DOWN"
  | "NETWORK"
  | "UNKNOWN";

export class GatewayError extends Error {
  code: GatewayErrorCode;
  status?: number;
  hint?: string;
  retryable: boolean;

  constructor(opts: {
    code: GatewayErrorCode;
    message: string;
    status?: number;
    hint?: string;
    retryable?: boolean;
  }) {
    super(opts.message);
    this.name = "GatewayError";
    this.code = opts.code;
    this.status = opts.status;
    this.hint = opts.hint;
    this.retryable = opts.retryable ?? false;
  }
}

/**
 * Turn any thrown value into a user-safe message.
 * Never leaks provider names, URLs, key fragments or stack traces (section 9.4).
 */
export function toUserFacingError(err: unknown): {
  message: string;
  code: GatewayErrorCode;
  hint?: string;
} {
  if (err instanceof GatewayError) {
    return { message: err.message, code: err.code, hint: err.hint };
  }
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/abort|timeout/i.test(raw)) {
    return {
      message: "That took too long to respond. Try again.",
      code: "TIMEOUT",
      hint: "Ek baar phir try karo — model busy tha.",
    };
  }
  if (/fetch|network|econn|enotfound|socket/i.test(raw)) {
    return {
      message: "Connection problem reaching the AI. Try again in a moment.",
      code: "NETWORK",
      hint: "Internet ya provider temporarily down — thodi der me retry.",
    };
  }
  return {
    message: "Something went wrong. Please try again.",
    code: "UNKNOWN",
  };
}

/** HTTP status → typed gateway error (used for retry decisions). */
export function errorFromStatus(status: number): GatewayError {
  if (status === 429) {
    return new GatewayError({
      code: "RATE_LIMIT",
      status,
      message: "The AI is busy right now. Try again in a few seconds.",
      hint: "Provider limit hit — thoda ruk ke retry karo.",
      retryable: true,
    });
  }
  if (status === 401 || status === 403) {
    return new GatewayError({
      code: "AUTH",
      status,
      message: "AI access isn't configured correctly.",
      hint: "Settings → API keys me apni free key check karo.",
      retryable: false,
    });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new GatewayError({
      code: "BAD_REQUEST",
      status,
      message: "That request couldn't be processed. Try rephrasing.",
      retryable: false,
    });
  }
  if (status >= 500) {
    return new GatewayError({
      code: "PROVIDER_DOWN",
      status,
      message: "The AI service is temporarily unavailable.",
      hint: "BUILDWE apne aap backup model try karega.",
      retryable: true,
    });
  }
  return new GatewayError({
    code: "UNKNOWN",
    status,
    message: "Something went wrong. Please try again.",
    retryable: false,
  });
}

/* ── Core fetch wrapper ───────────────────────────────────── */

/**
 * fetch() with a hard timeout. Always clears its timer, and converts an abort
 * into a typed TIMEOUT error instead of a raw DOMException.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label = "provider"
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const aborted =
      (e as Error)?.name === "AbortError" || /abort/i.test(String(e));
    if (aborted) {
      bump(`gw_timeout_${label}`);
      throw new GatewayError({
        code: "TIMEOUT",
        message: "That took too long to respond. Try again.",
        hint: "Model busy tha — dobara try karo.",
        retryable: true,
      });
    }
    bump(`gw_network_${label}`);
    throw new GatewayError({
      code: "NETWORK",
      message: "Connection problem reaching the AI. Try again in a moment.",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run an operation with bounded retries and exponential backoff + jitter.
 * Only retries when the error says it's transient — retrying a 401 is pure
 * waste, and retrying a 400 will fail identically every time.
 */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const base = opts.baseDelayMs ?? 400;
  const label = opts.label ?? "provider";
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await op(i);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof GatewayError ? e.retryable : true;
      const isLast = i === attempts - 1;
      if (!retryable || isLast) break;
      bump(`gw_retry_${label}`);
      // exponential backoff with jitter so parallel clients don't sync up
      const delay = base * Math.pow(2, i) + Math.random() * 150;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* ── Input guards (cost control) ──────────────────────────── */

export type GuardedMessage = { role: string; content: string };

/**
 * Clamp conversation payloads before they reach a paid tokeniser (audit V2).
 *
 * Trimming keeps the NEWEST messages: the tail is what the model actually needs
 * to answer, and `providers.ts` already compresses older turns separately.
 */
export function guardMessages(messages: GuardedMessage[]): {
  messages: GuardedMessage[];
  trimmed: boolean;
} {
  let trimmed = false;

  let out = messages.map((m) => {
    const content = String(m?.content ?? "");
    if (content.length > INPUT_LIMITS.messageChars) {
      trimmed = true;
      return { role: m.role, content: content.slice(0, INPUT_LIMITS.messageChars) };
    }
    return { role: m.role, content };
  });

  if (out.length > INPUT_LIMITS.maxMessages) {
    trimmed = true;
    out = out.slice(-INPUT_LIMITS.maxMessages);
  }

  // Whole-conversation ceiling — drop oldest until under budget.
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (total > INPUT_LIMITS.conversationChars && out.length > 1) {
    const dropped = out.shift();
    total -= dropped?.content.length ?? 0;
    trimmed = true;
  }

  return { messages: out, trimmed };
}

/** Clamp a single prompt string (image / audio / code-action). */
export function guardPrompt(
  prompt: string,
  max = INPUT_LIMITS.promptChars
): { prompt: string; trimmed: boolean } {
  const p = String(prompt ?? "");
  if (p.length <= max) return { prompt: p, trimmed: false };
  return { prompt: p.slice(0, max), trimmed: true };
}
