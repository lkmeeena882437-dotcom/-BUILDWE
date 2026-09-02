/**
 * BUILDWE Provider Registry — one adapter per vendor, routed by model id.
 *
 * WHY THIS EXISTS
 * ---------------
 * `lib/ai/models-catalog.ts` advertised 20 models across Groq, OpenRouter,
 * OpenAI, Anthropic, fal, HuggingFace, ElevenLabs, Deepgram and Cartesia.
 * But `providers.ts` only ever built ONE request shape — Groq's — and sent
 * every chosen model id to `api.groq.com`. So picking "Claude Sonnet" or
 * "GPT-4o mini" sent the string "claude-sonnet-4" to Groq, which rejected it,
 * and the chain silently fell through to a Groq model. The catalog was a menu
 * with one dish behind it.
 *
 * This registry gives every provider a real adapter: its own base URL, auth
 * header, request body shape and stream format. `chatVia()` looks up the
 * model's provider from the catalog and dispatches accordingly.
 *
 * DESIGN RULES
 * ------------
 * - Additive. `groqStream`/`groqComplete` in providers.ts still work; they now
 *   have company.
 * - A provider with no configured key is skipped, never attempted. This is
 *   what makes a fallback chain across vendors safe: unavailable links are
 *   dropped before any network call.
 * - OpenAI-compatible providers share one adapter, because Groq, OpenRouter,
 *   OpenAI, DeepSeek, Together and Mistral all speak the same wire format.
 *   Anthropic and Google do not, so they get their own.
 * - Every call goes through the gateway's timeout/retry/sanitise layer.
 */

import { AI_KEYS, APP } from "@/lib/config";
import {
  fetchWithTimeout,
  errorFromStatus,
  TIMEOUTS,
  withRetry,
} from "@/lib/ai/gateway";
import { MODEL_CATALOG, type ProviderId } from "@/lib/ai/models-catalog";

export type ChatMessage = { role: string; content: unknown };
export type Budget = { maxTokens: number; temperature: number };

/** User-supplied keys (BYOK). Extend as new BYOK providers are offered. */
export type ProviderKeys = {
  groq?: string;
  openrouter?: string;
  openai?: string;
  anthropic?: string;
  google?: string;
  mistral?: string;
  deepseek?: string;
  together?: string;
  stability?: string;
  replicate?: string;
  goapi?: string;
  playht?: string;
  elevenlabs?: string;
  deepgram?: string;
};

/* ── Provider descriptors ─────────────────────────────────── */

type Wire = "openai" | "anthropic" | "google";

type ProviderSpec = {
  id: ProviderId;
  label: string;
  wire: Wire;
  /** default endpoint; override per deployment with AI_BASE_URL_<PROVIDER> */
  baseUrl: string;
  /** platform key from env, if configured */
  envKey: () => string | undefined;
  /** matching BYOK field, if the user can bring their own */
  byokField?: keyof ProviderKeys;
  /** extra headers some providers require */
  headers?: Record<string, string>;
};

const SPECS: Record<string, ProviderSpec> = {
  groq: {
    id: "groq",
    label: "Groq",
    wire: "openai",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    envKey: () => AI_KEYS.groq,
    byokField: "groq",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    wire: "openai",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    envKey: () => AI_KEYS.openrouter,
    byokField: "openrouter",
    headers: {
      "HTTP-Referer": APP.url || "https://buildwe.online",
      "X-Title": APP.name || "BUILDWE",
    },
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    wire: "openai",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    envKey: () => AI_KEYS.openai,
    byokField: "openai",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    wire: "anthropic",
    baseUrl: "https://api.anthropic.com/v1/messages",
    envKey: () => AI_KEYS.anthropic,
    byokField: "anthropic",
  },
  google: {
    id: "google",
    label: "Google",
    wire: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    envKey: () => AI_KEYS.google,
    byokField: "google",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    wire: "openai",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    envKey: () => AI_KEYS.mistral,
    byokField: "mistral",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    wire: "openai",
    baseUrl: "https://api.deepseek.com/chat/completions",
    envKey: () => AI_KEYS.deepseek,
    byokField: "deepseek",
  },
  together: {
    id: "together",
    label: "Together",
    wire: "openai",
    baseUrl: "https://api.together.xyz/v1/chat/completions",
    envKey: () => AI_KEYS.together,
    byokField: "together",
  },
};

/**
 * Endpoint for a provider, allowing a per-deployment override.
 *
 * Set AI_BASE_URL_GROQ, AI_BASE_URL_OPENAI, etc. to route through a corporate
 * proxy, a self-hosted gateway, or a compatible drop-in vendor. Unset in
 * normal deployments, where the vendor default applies.
 */
function endpointFor(spec: ProviderSpec): string {
  const override = process.env[`AI_BASE_URL_${spec.id.toUpperCase()}`];
  return override && /^https?:\/\//.test(override) ? override.replace(/\/$/, "") : spec.baseUrl;
}

/** Resolve the usable key for a provider: user's own first, then platform. */
function keyFor(spec: ProviderSpec, userKeys?: ProviderKeys): string | undefined {
  const own = spec.byokField ? userKeys?.[spec.byokField] : undefined;
  const platform = spec.envKey();
  const key = own || platform;
  if (!key) return undefined;
  // Guard against placeholder values left in .env files
  if (key.startsWith("your_") || key.includes("REPLACE")) return undefined;
  return key;
}

/** True when this provider can actually be called right now. */
export function providerAvailable(
  providerId: string,
  userKeys?: ProviderKeys
): boolean {
  const spec = SPECS[providerId];
  if (!spec) return false;
  return Boolean(keyFor(spec, userKeys));
}

/** Which providers are live — used by health and by the model picker. */
export function availableProviders(userKeys?: ProviderKeys): ProviderId[] {
  return (Object.keys(SPECS) as string[])
    .filter((p) => providerAvailable(p, userKeys))
    .map((p) => SPECS[p].id);
}

/** Look up which vendor owns a model id. Unknown ids default to Groq. */
export function providerForModel(modelId: string): ProviderId {
  const hit = MODEL_CATALOG.find((m) => m.id === modelId);
  if (hit) return hit.provider;
  // Heuristics for ids that arrive from env overrides rather than the catalog
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1")) return "openai";
  if (modelId.startsWith("gemini")) return "google";
  if (modelId.includes("/")) return "openrouter";
  return "groq";
}

/* ── Request builders per wire format ─────────────────────── */

function buildOpenAIBody(
  model: string,
  messages: ChatMessage[],
  budget: Budget,
  stream: boolean
) {
  return JSON.stringify({
    model,
    messages,
    temperature: budget.temperature,
    max_tokens: budget.maxTokens,
    stream,
  });
}

/**
 * Anthropic differs in three ways: the system prompt is a top-level field
 * rather than a message, the auth header is x-api-key, and it requires an
 * explicit version header.
 */
function buildAnthropicBody(
  model: string,
  messages: ChatMessage[],
  budget: Budget,
  stream: boolean
) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));
  return JSON.stringify({
    model,
    ...(system ? { system } : {}),
    messages: rest,
    max_tokens: budget.maxTokens,
    temperature: budget.temperature,
    stream,
  });
}

function buildGoogleBody(
  messages: ChatMessage[],
  budget: Budget
) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : String(m.content) }],
    }));
  return JSON.stringify({
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: budget.temperature,
      maxOutputTokens: budget.maxTokens,
    },
  });
}

function headersFor(spec: ProviderSpec, key: string): Record<string, string> {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    ...(spec.headers || {}),
  };
  if (spec.wire === "anthropic") {
    base["x-api-key"] = key;
    base["anthropic-version"] = "2023-06-01";
  } else if (spec.wire === "google") {
    base["x-goog-api-key"] = key;
  } else {
    base.Authorization = `Bearer ${key}`;
  }
  return base;
}

function urlFor(spec: ProviderSpec, model: string, stream: boolean): string {
  const base = endpointFor(spec);
  if (spec.wire === "google") {
    const verb = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${base}/${model}:${verb}`;
  }
  return base;
}

/* ── Public: streaming ────────────────────────────────────── */

/**
 * Stream a completion from whichever vendor owns `model`.
 * Returns the raw body stream, or null when the provider is unusable —
 * matching the existing groqStream contract so callers keep their fallback
 * chains unchanged.
 */
export async function streamVia(
  model: string,
  messages: ChatMessage[],
  budget: Budget,
  userKeys?: ProviderKeys
): Promise<{ body: ReadableStream<Uint8Array>; wire: Wire; provider: ProviderId } | null> {
  const providerId = providerForModel(model);
  const spec = SPECS[providerId];
  if (!spec) return null;

  const key = keyFor(spec, userKeys);
  if (!key) return null; // no key → skip silently, caller tries the next model

  try {
    const body = await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          urlFor(spec, model, true),
          {
            method: "POST",
            headers: headersFor(spec, key),
            body:
              spec.wire === "anthropic"
                ? buildAnthropicBody(model, messages, budget, true)
                : spec.wire === "google"
                  ? buildGoogleBody(messages, budget)
                  : buildOpenAIBody(model, messages, budget, true),
          },
          TIMEOUTS.stream,
          spec.id
        );
        if (!res.ok || !res.body) {
          console.error("[bw] stream fail", spec.id, model, res.status);
          throw errorFromStatus(res.status);
        }
        return res.body;
      },
      { attempts: 2, label: spec.id }
    );
    return { body, wire: spec.wire, provider: spec.id };
  } catch (e) {
    console.error("[bw] stream error", spec.id, model, (e as Error)?.message);
    return null;
  }
}

/* ── Public: non-streaming ────────────────────────────────── */

/** One-shot completion from whichever vendor owns `model`. */
export async function completeVia(
  model: string,
  messages: ChatMessage[],
  budget: Budget,
  userKeys?: ProviderKeys
): Promise<string | null> {
  const providerId = providerForModel(model);
  const spec = SPECS[providerId];
  if (!spec) return null;

  const key = keyFor(spec, userKeys);
  if (!key) return null;

  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          urlFor(spec, model, false),
          {
            method: "POST",
            headers: headersFor(spec, key),
            body:
              spec.wire === "anthropic"
                ? buildAnthropicBody(model, messages, budget, false)
                : spec.wire === "google"
                  ? buildGoogleBody(messages, budget)
                  : buildOpenAIBody(model, messages, budget, false),
          },
          TIMEOUTS.complete,
          spec.id
        );
        if (!res.ok) throw errorFromStatus(res.status);
        const data = await res.json();

        const text =
          spec.wire === "anthropic"
            ? (data?.content?.[0]?.text as string | undefined)
            : spec.wire === "google"
              ? (data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)
              : (data?.choices?.[0]?.message?.content as string | undefined);

        return typeof text === "string" && text.trim() ? text : null;
      },
      { attempts: 2, label: spec.id }
    );
  } catch {
    return null;
  }
}

/* ── Stream normalisation ─────────────────────────────────── */

/**
 * Every vendor streams a different JSON shape. Extract the text delta from
 * one SSE data payload so callers can treat all providers identically.
 */
export function extractDelta(wire: Wire, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  try {
    if (wire === "anthropic") {
      // {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
      const delta = p?.delta as { text?: string } | undefined;
      return delta?.text || "";
    }
    if (wire === "google") {
      const cands = p?.candidates as
        | { content?: { parts?: { text?: string }[] } }[]
        | undefined;
      return cands?.[0]?.content?.parts?.[0]?.text || "";
    }
    const choices = p?.choices as
      | { delta?: { content?: string }; message?: { content?: string } }[]
      | undefined;
    return choices?.[0]?.delta?.content || "";
  } catch {
    return "";
  }
}

/** Provider label for logs and internal diagnostics (never user-facing). */
export function providerLabel(providerId: string): string {
  return SPECS[providerId]?.label || providerId;
}
