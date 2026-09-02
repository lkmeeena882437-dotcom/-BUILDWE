/**
 * BUILDWE AI runtime — live LLM first, smart offline only if providers fail.
 */

import { AI_KEYS, AI_MODELS, APP } from "@/lib/config";
import { SYSTEM_PROMPTS, type Plan } from "@/lib/ai/rules";
import {
  pickModel,
  estimateComplexity,
  modelChain,
  routeModelFor,
  MODEL_CATALOG,
  publicModelLabel,
} from "@/lib/ai/models-catalog";
import {
  streamVia,
  completeVia,
  availableProviders,
  extractDelta,
  providerForModel,
} from "@/lib/ai/provider-registry";
import {
  buildMind,
  packMessagesForModel,
  type ChatTurn,
  type MindProfile,
} from "@/lib/ai/mind";
import { mergeImagePrompt } from "@/lib/ai/image-prompt";
import { generateImageMulti } from "@/lib/ai/image-providers";
import { offlineAnswer } from "@/lib/ai/offline-brain";
import {
  fetchWithTimeout,
  guardMessages,
  errorFromStatus,
  TIMEOUTS,
  withRetry,
} from "@/lib/ai/gateway";
import { availableProvidersFor } from "@/lib/ai/provider-config";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const GROQ_CHAT_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "gemma2-9b-it",
];

const GROQ_CODE_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
];

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




/**
 * Normalise ANY provider's SSE stream into BUILDWE's {token} protocol.
 * Anthropic and Google use different payload shapes from OpenAI-compatible
 * vendors, so the delta extractor is chosen by wire format.
 */
export function anyStreamToTextSSE(
  body: ReadableStream<Uint8Array>,
  wire: "openai" | "anthropic" | "google"
) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const token = extractDelta(wire, JSON.parse(data));
              if (token) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
                );
              }
            } catch {
              /* skip malformed frame */
            }
          }
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
        controller.close();
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Response interrupted. Try again." })}\n\n`
          )
        );
        controller.close();
      }
    },
  });
}


function textToSSE(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parts = text.split(/(\s+)/);
  return new ReadableStream({
    async start(controller) {
      for (const p of parts) {
        if (!p) continue;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ token: p })}\n\n`)
        );
        await new Promise((r) => setTimeout(r, p.length > 10 ? 8 : 3));
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
      );
      controller.close();
    },
  });
}

function smartOfflineChat(
  prompt: string,
  history: { role: string; content: string }[]
): string {
  void history;
  // Delegated to the offline brain: computes real answers (math, conversions),
  // returns usable structure for writing/code asks, and is honest — never
  // echoes the user's prompt back as a question. See lib/ai/offline-brain.ts.
  return offlineAnswer(prompt, "chat").text;
}

function smartOfflineCode(prompt: string): string {
  // Offline code mode always hands back runnable starter code, never a
  // "tell me more" bounce. See lib/ai/offline-brain.ts.
  return offlineAnswer(prompt, "code").text;
}

export async function streamChatOrCode(opts: {
  mode: "chat" | "code";
  messages: { role: string; content: string }[];
  plan: Plan;
  skills?: string[];
  prefer?: string[];
  avoid?: string[];
  promptForRouting: string;
  /** When set AND no provider is reachable, stream this text instead of the generic offline reply */
  offlineOverrideText?: string;
  /** user-supplied keys (BYOK) take precedence over platform keys */
  userKeys?: ProviderKeys;
  /** force ONE model id (multi-model comparison) — falls back to offline if it fails */
  forceModel?: string;
  /** skip the first N preferred models (manual "use another model") */
  preferOffset?: number;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  model: string;
  /** catalog id the answer came from — the only id a retry may be sent to */
  modelId?: string;
  live: boolean;
  mind: MindProfile;
  fallbackNote?: string;
}> {
  // Cost guard (audit V2): clamp oversized payloads BEFORE tokenising.
  // Rate limits cap how often someone can ask; this caps how expensive a
  // single ask can be. Keeps the newest turns — those drive the answer.
  const guarded = guardMessages(opts.messages);
  const inputMessages = guarded.messages;

  const turnsAll: ChatTurn[] = inputMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content || ""),
    }));

  // Long-conversation optimization (Update #2 P1): compress older turns into
  // a summary instead of sending the entire history every request
  const RECENT_TURNS = 14;
  let turns = turnsAll;
  let compressed = "";
  if (turnsAll.length > RECENT_TURNS + 4) {
    const older = turnsAll.slice(0, turnsAll.length - RECENT_TURNS);
    turns = turnsAll.slice(-RECENT_TURNS);
    const asks = older
      .filter((t) => t.role === "user")
      .map((t) => t.content.replace(/\s+/g, " ").slice(0, 90))
      .slice(-6);
    compressed = `EARLIER CONVERSATION (compressed for focus — ${older.length} older messages, first ask: "${asks[0] || "—"}"): ${asks.join(" → ")}. Use this as background; the user's latest messages below are authoritative.`;
  }

  // system messages (search grounding, style controls) are appended to the
  // base system prompt — previously they were dropped in live mode
  const extraSystem = [
    compressed,
    inputMessages
      .filter((m) => m.role === "system")
      .map((m) => String(m.content || ""))
      .filter(Boolean)
      .join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const mind = buildMind(turns, opts.skills || [], {
    prefer: opts.prefer,
    avoid: opts.avoid,
  });

  const baseSystem = [
    opts.mode === "code" ? SYSTEM_PROMPTS.code : SYSTEM_PROMPTS.chat,
    extraSystem,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const packed = packMessagesForModel({
    baseSystem,
    mind,
    turns,
    maxTurns: 22,
  });

  const messages: ChatMessage[] = packed.map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  const lastUser =
    [...turns].reverse().find((m) => m.role === "user")?.content ||
    opts.promptForRouting ||
    "";

  // ── Cost budgets (Update #2 P0): complexity decides compute ──
  const complexity = estimateComplexity(opts.promptForRouting || lastUser);
  const maxTokens =
    complexity === "simple" ? 1024 : complexity === "complex" ? 4096 : 2048;
  const temperature = opts.mode === "code" ? 0.45 : 0.7;
  const budget = { maxTokens, temperature };

  const envModel =
    opts.plan === "pro"
      ? opts.mode === "code"
        ? AI_MODELS.pro.code
        : AI_MODELS.pro.chat
      : opts.mode === "code"
        ? AI_MODELS.free.code
        : AI_MODELS.free.chat;

  // Which vendors can actually be called on this deployment right now.
  // Models from unconfigured vendors are dropped before scoring, so the
  // router never "picks" a model it cannot reach.
  const live = availableProviders(opts.userKeys);

  const catalog = pickModel({
    capability: opts.mode,
    plan: opts.plan,
    prompt: opts.promptForRouting || lastUser,
    availableProviders: live,
  });

  // Phase 10 routing policy: on strong signals (large doc / code / normal) per
  // the product spec, bias the chain towards the flagship id when that model is
  // actually a valid catalog entry for this capability and is reachable on this
  // deployment. `preferred` below is ordered so the routed id leads.
  const routedId = routeModelFor({
    capability: opts.mode,
    plan: opts.plan,
    prompt: opts.promptForRouting || lastUser,
    contextSize: lastUser.length,
  });
  const routedModel = routedId
    ? MODEL_CATALOG.find((m) => m.id === routedId && m.capability === opts.mode) ?? null
    : null;
  const routedUsable =
    routedModel &&
    live.includes(routedModel.provider) &&
    (opts.plan === "pro" ? routedModel.tiers.includes("pro") || routedModel.tiers.includes("free") : routedModel.tiers.includes("free"));

  /**
   * Build the model chain. Order matters:
   *   1. explicit env override (operator's deliberate choice)
   *   2. the router's scored pick
   *   3. cross-vendor alternates, so one provider outage != capability down
   *   4. the legacy hardcoded Groq list as a last resort
   */
  const chain = modelChain({
    capability: opts.mode,
    plan: opts.plan,
    prompt: opts.promptForRouting || lastUser,
    availableProviders: live,
    max: 5,
  }).map((m) => m.id);

  const legacy = opts.mode === "code" ? GROQ_CODE_MODELS : GROQ_CHAT_MODELS;
  // Routed flagship leads when usable; otherwise the scored pick leads.
  const preferred = [
    ...(routedUsable && routedModel ? [routedModel.id] : []),
    envModel,
    catalog.id,
    ...chain,
    ...legacy,
  ];

  let tryModels = Array.from(new Set(preferred.filter(Boolean)));
  if (opts.forceModel) tryModels = [opts.forceModel];
  if (opts.preferOffset && !opts.forceModel && tryModels.length > 1) {
    tryModels = tryModels.slice(Math.min(opts.preferOffset, tryModels.length - 1));
  }

  let fallbackNote: string | undefined;
  let attempts = 0;

  // ── Pass 1: stream, walking the chain across vendors ──────
  for (const model of tryModels.slice(0, 6)) {
    const hit = await streamVia(model, messages, budget, opts.userKeys);
    if (hit) {
      return {
        stream: anyStreamToTextSSE(hit.body, hit.wire),
        model: publicModelLabel(model, opts.mode),
        // The public label is what the UI shows; `modelId` is what a follow-up
        // call has to be made with. They are NOT interchangeable — sending
        // "BUILDWE AI" to a vendor was the bug that made every tool correction
        // pass die silently (found by tests/tools.mjs).
        modelId: model,
        live: true,
        mind,
        ...(fallbackNote ? { fallbackNote } : {}),
      };
    }
    attempts++;
    if (attempts === 1) {
      fallbackNote =
        "The primary model was unavailable — BUILDWE switched to a backup automatically.";
    }
  }

  // ── Pass 2: non-streaming, same chain ─────────────────────
  // Some providers reject streaming under load but still answer one-shot.
  for (const model of tryModels.slice(0, 4)) {
    const text = await completeVia(model, messages, budget, opts.userKeys);
    if (text) {
      return {
        stream: textToSSE(text),
        model: publicModelLabel(model, opts.mode),
        modelId: model,
        live: true,
        mind,
        fallbackNote:
          fallbackNote ||
          "Streaming was unavailable — the complete answer was prepared in one piece.",
      };
    }
  }

  const offline =
    opts.mode === "code"
      ? smartOfflineCode(lastUser)
      : smartOfflineChat(lastUser, turns);

  return {
    stream: textToSSE(opts.offlineOverrideText || offline),
    model: publicModelLabel(undefined, opts.mode),
    modelId: undefined,
    live: false,
    mind,
    fallbackNote: opts.offlineOverrideText
      ? undefined
      : "Offline mode — no live model is reachable right now. Maths, conversions, starter code, image, voice and web search all still work. Connect your own key in Settings → API keys for full-quality answers.",
  };
}

/* ── Vision (image understanding) ─────────────────────────── */

/**
 * Ordered vision-understanding candidates. Each maps to the vendor that owns
 * it so the premium GPT-4o / Claude vision routes correctly when a key exists,
 * and falls back to Groq's free vision model, then to the honest offline reply.
 */
const VISION_MODELS: { id: string; provider: "openai" | "anthropic" | "groq" }[] = [
  { id: "gpt-4o", provider: "openai" },
  { id: "claude-3-5-sonnet-20241022", provider: "anthropic" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", provider: "groq" },
  { id: "llama-3.2-11b-vision-preview", provider: "groq" },
];

/** Convert a data URL + text question into the right vendor's body shape. */
function buildVisionBody(
  question: string,
  imageDataUrl: string,
  model: string,
  wire: "openai" | "anthropic" | "groq"
) {
  if (wire === "anthropic") {
    return JSON.stringify({
      model,
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageDataUrl.split(",")[1] },
            },
          ],
        },
      ],
    });
  }
  // OpenAI-compatible (OpenAI + Groq share the same image_url body)
  return JSON.stringify({
    model,
    max_tokens: 900,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
}

function visionUrl(wire: "openai" | "anthropic" | "groq"): string {
  if (wire === "anthropic") return "https://api.anthropic.com/v1/messages";
  if (wire === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  return "https://api.openai.com/v1/chat/completions";
}

function visionHeaders(
  wire: "openai" | "anthropic" | "groq",
  key: string
): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (wire === "anthropic") {
    base["x-api-key"] = key;
    base["anthropic-version"] = "2023-06-01";
  } else {
    base.Authorization = `Bearer ${key}`;
  }
  return base;
}

function visionLabel(model: string, wire: "openai" | "anthropic" | "groq") {
  if (wire === "openai") return "GPT-4o Vision";
  if (wire === "anthropic") return "Claude Vision";
  return "BUILDWE Vision AI";
}

export async function visionComplete(opts: {
  prompt: string;
  imageDataUrl: string;
  userKeys?: ProviderKeys;
}): Promise<{ text: string; model: string; live: boolean }> {
  const question =
    opts.prompt.trim() || "Describe this image in detail. What's in it?";

  const keyFor = (p: "openai" | "anthropic" | "groq") =>
    p === "openai"
      ? opts.userKeys?.openai || AI_KEYS.openai
      : p === "anthropic"
        ? opts.userKeys?.anthropic || AI_KEYS.anthropic
        : opts.userKeys?.groq || AI_KEYS.groq;

  for (const { id, provider } of VISION_MODELS) {
    const key = keyFor(provider);
    if (!key) continue;
    const wire: "openai" | "anthropic" | "groq" =
      provider === "anthropic" ? "anthropic" : provider === "groq" ? "groq" : "openai";
    try {
      // Vision gets the longest budget (large image payload) but is still
      // bounded — audit V4: no provider call may hang forever.
      const res = await fetchWithTimeout(
        visionUrl(wire),
        {
          method: "POST",
          headers: visionHeaders(wire, key),
          body: buildVisionBody(question, opts.imageDataUrl, id, wire),
        },
        TIMEOUTS.vision,
        "vision"
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text: string | undefined =
        wire === "anthropic"
          ? (data?.content?.[0]?.text as string | undefined)
          : (data?.choices?.[0]?.message?.content as string | undefined);
      if (text) return { text, model: visionLabel(id, wire), live: true };
    } catch (e) {
      console.error("[bw] vision fail", id, e);
    }
  }

  // Offline fallback — honest, still useful
  const approxBytes = Math.round((opts.imageDataUrl.length * 3) / 4);
  return {
    text: [
      `**Image received** (~${(approxBytes / 1024).toFixed(0)} KB).`,
      "",
      question
        ? `You asked: _${question.slice(0, 200)}_`
        : "",
      "",
      "Image understanding needs the vision model, which isn't connected right now. An administrator can enable it from the server configuration.",
      "",
      "Your image stays attached to this chat and will be analysed automatically the moment vision comes online.",
    ]
      .filter(Boolean)
      .join("\n"),
    model: "BUILDWE Vision (preview)",
    live: false,
  };
}

/* ── Image studio ─────────────────────────────────────────── */

export function buildImageUrl(
  prompt: string,
  aspect: string,
  modelId: string = "flux"
) {
  const map: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [768, 1344],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
  };
  // YouTube thumb classic
  if (aspect === "yt") {
    map["yt"] = [1280, 720];
  }
  const key = aspect === "yt" ? "16:9" : aspect;
  const [w, h] = map[key] || map["1:1"];
  const seed = Math.floor(Math.random() * 1_000_000);
  const clean = prompt.replace(/\s+/g, " ").trim().slice(0, 850);
  const q = encodeURIComponent(clean);
  const model = modelId === "turbo" ? "turbo" : "flux";
  return `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=true&model=${model}`;
}

export async function generateImage(opts: {
  prompt: string;
  aspect: string;
  plan: Plan;
  basePrompt?: string;
  modelId?: string;
}) {
  const merged = mergeImagePrompt({
    basePrompt: opts.basePrompt,
    userText: opts.prompt,
    aspect: opts.aspect === "yt" ? "16:9" : opts.aspect,
  });

  // Real cross-vendor generation: fal and HuggingFace are used when their
  // keys exist, Pollinations otherwise. Previously every model id produced
  // the same Pollinations image, which made the model picker a lie.
  const result = await generateImageMulti({
    prompt: merged.prompt,
    aspect: opts.aspect === "yt" ? "16:9" : opts.aspect,
    plan: opts.plan === "pro" ? "pro" : "free",
    ...(opts.modelId ? { modelId: opts.modelId } : {}),
  });

  return {
    url: result.url,
    promptUsed: merged.prompt,
    editMode: merged.mode,
    model:
      result.modelId === "turbo"
        ? "BUILDWE Vision Fast"
        : /pro|dev/.test(result.modelId)
          ? "BUILDWE Vision Pro"
          : "BUILDWE Vision",
    modelId: result.modelId,
    provider: result.provider,
    live: true,
    // Surfaced so the UI can tell the user their pick was unavailable
    // instead of silently handing them a different model's output.
    fellBack: result.fellBack,
  };
}

/** Audio vendors that can actually be called right now. Pollinations is keyless. */
export function availableAudioProviders(userKeys?: ProviderKeys): string[] {
  return availableProvidersFor("audio", userKeys);
}

export async function generateAudioPlan(opts: {
  text: string;
  voice: string;
  speed: number;
  plan: Plan;
}) {
  // Strip stage directions for cleaner speech when user pastes long briefs
  let speak = opts.text.slice(0, 4000);
  // If it looks like a voice profile doc, try to extract quoted dialogue
  const quotes = Array.from(speak.matchAll(/"([^"]{8,})"/g)).map((m) => m[1]);
  if (quotes.length >= 1 && /voice profile|pacing|delivery style/i.test(speak)) {
    speak = quotes.join(". ");
  }

  // ── Real MP3 via Pollinations openai-audio (key-free) ────
  const mp3 = await synthesizeSpeech({
    text: speak,
    voice: opts.voice,
    speed: opts.speed,
    plan: opts.plan,
  });
  if (mp3) {
    return {
      type: "mp3" as const,
      audioUrl: mp3.dataUrl,
      audioMs: mp3.estMs,
      text: speak,
      displayText: opts.text.slice(0, 4000),
      voice: opts.voice,
      speed: opts.speed,
      model: "BUILDWE Voice Studio",
      provider: "buildwe",
      live: true,
      charCount: speak.length,
    };
  }

  return {
    type: "browser-tts" as const,
    text: speak,
    displayText: opts.text.slice(0, 4000),
    voice: opts.voice,
    speed: opts.speed,
    model: "BUILDWE Voice",
    provider: "buildwe",
    live: false,
    charCount: speak.length,
  };
}

/* ── Real speech synthesis (MP3) ──────────────────────────── */

/** BUILDWE voice ids → openai-audio timbres */
const TTS_VOICE_MAP: Record<string, string> = {
  nova: "nova",
  atlas: "onyx",
  luna: "shimmer",
  ember: "echo",
  river: "fable",
  aanya: "shimmer",
  arjun: "onyx",
  kiara: "nova",
  vihaan: "echo",
  meera: "alloy",
  kabir: "fable",
  saanvi: "shimmer",
  ananya: "nova",
  dev: "onyx",
  isha: "alloy",
  sofia: "shimmer",
  luca: "echo",
  amira: "nova",
  yuki: "alloy",
  chen: "onyx",
};

const DATA_AUDIO_RE = /data:audio\/[a-z0-9]+;base64,([A-Za-z0-9+/=]+)/;

/** BUILDWE voice ids → ElevenLabs premade voice ids. OpenAI names are not valid here. */
const ELEVENLABS_VOICE_IDS: Record<string, string> = {
  nova: "EXAVITQu4vr4xnSDxMaL",
  atlas: "pNInz6obpgDQGcFmaJgB",
  luna: "MF3mGyEYCl7XYWbV9V6O",
  ember: "TxGEqnHWrfWFTfGW9XjX",
  river: "yoZ06a0pjB7iEbrgsRBS",
  aanya: "EXAVITQu4vr4xnSDxMaL",
  arjun: "pNInz6obpgDQGcFmaJgB",
  kiara: "MF3mGyEYCl7XYWbV9V6O",
  vihaan: "VR6AewLTigWG4xSOukaG",
  meera: "EXAVITQu4vr4xnSDxMaL",
  kabir: "TxGEqnHWrfWFTfGW9XjX",
  saanvi: "MF3mGyEYCl7XYWbV9V6O",
  ananya: "EXAVITQu4vr4xnSDxMaL",
  dev: "pNInz6obpgDQGcFmaJgB",
  isha: "EXAVITQu4vr4xnSDxMaL",
  sofia: "MF3mGyEYCl7XYWbV9V6O",
  luca: "ErXwobaYiN019PkySvjV",
  amira: "21m00Tcm4TlvDq8ikWAM",
  yuki: "MF3mGyEYCl7XYWbV9V6O",
  chen: "VR6AewLTigWG4xSOukaG",
};

/**
 * ElevenLabs TTS — POST /v1/text-to-speech/{voice}. Returns MP3 bytes as a
 * data URL. Voice ids are BUILDWE's own mapped to ElevenLabs preset ids.
 */
async function elevenLabsTTS(
  script: string,
  voice: string,
  speed: number
): Promise<{ dataUrl: string; estMs: number } | null> {
  const key = AI_KEYS.elevenlabs;
  if (!key || key.startsWith("your_") || key.includes("REPLACE")) return null;
  const voiceId = ELEVENLABS_VOICE_IDS[voice] || "21m00Tcm4TlvDq8ikWAM";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: script,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, speed },
        }),
      },
      TIMEOUTS.audio,
      "elevenlabs"
    );
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return { dataUrl: `data:audio/mpeg;base64,${buf.toString("base64")}`, estMs: Math.round(buf.length / 24) };
  } catch (e) {
    console.error("[bw] elevenlabs tts", (e as Error)?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI TTS — POST /v1/audio/speech. Returns MP3 data URL.
 * Uses the catalog's tts-1 / tts-1-hd model ids.
 */
async function openAITTS(
  script: string,
  voice: string,
  speed: number
): Promise<{ dataUrl: string; estMs: number } | null> {
  const key = AI_KEYS.openai;
  if (!key || key.startsWith("your_") || key.includes("REPLACE")) return null;
  const voiceId = TTS_VOICE_MAP[voice] || "alloy";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1-hd",
        voice: voiceId,
        input: script,
        speed,
        response_format: "mp3",
      }),
    }, TIMEOUTS.audio, "openai-tts");
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return { dataUrl: `data:audio/mpeg;base64,${buf.toString("base64")}`, estMs: Math.round(buf.length / 24) };
  } catch (e) {
    console.error("[bw] openai tts", (e as Error)?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pollinationsTTS(
  script: string,
  voice: string,
  speed: number
): Promise<{ dataUrl: string; estMs: number } | null> {
  const mapped = TTS_VOICE_MAP[voice] || "alloy";
  try {
    const res = await fetchWithTimeout(
      "https://text.pollinations.ai/openai",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai-audio",
          voice: mapped,
          speed,
          messages: [
            {
              role: "user",
              content: `Read this script aloud exactly, nothing else:\n\n${script}`,
            },
          ],
        }),
      },
      TIMEOUTS.audio,
      "pollinations-tts"
    );
    if (res.ok) {
      const raw = await res.text();
      const m = raw.match(DATA_AUDIO_RE);
      if (m) {
        const b64 = m[1];
        return {
          dataUrl: `data:audio/mpeg;base64,${b64}`,
          estMs: Math.round((b64.length * 3) / 4 / 24),
        };
      }
    }
  } catch {
    /* try the short GET path */
  }

  if (encodeURIComponent(script).length >= 1400) return null;
  try {
    const res = await fetchWithTimeout(
      `https://text.pollinations.ai/${encodeURIComponent(
        `Read this script aloud exactly, nothing else:\n\n${script}`
      )}?model=openai-audio&voice=${mapped}`,
      { method: "GET" },
      TIMEOUTS.audio,
      "pollinations-tts"
    );
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("audio")) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) {
        return {
          dataUrl: `data:audio/mpeg;base64,${buf.toString("base64")}`,
          estMs: Math.round(buf.length / 24),
        };
      }
    }
    const m = (await res.text()).match(DATA_AUDIO_RE);
    if (m) {
      return {
        dataUrl: `data:audio/mpeg;base64,${m[1]}`,
        estMs: Math.round((m[1].length * 3) / 4 / 24),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Catalog-driven TTS. Walks the audio chain (ElevenLabs → OpenAI → Pollinations
 * when those vendors are actually configured) so a new catalog row is enough
 * to change order — feature routes do not hard-code vendors.
 */
export async function synthesizeSpeech(opts: {
  text: string;
  voice: string;
  speed: number;
  plan?: Plan;
}): Promise<{ dataUrl: string; estMs: number } | null> {
  const script = opts.text.trim().slice(0, 3500);
  if (!script) return null;

  const chain = modelChain({
    capability: "audio",
    plan: opts.plan === "pro" ? "pro" : "free",
    prompt: script,
    availableProviders: availableAudioProviders(),
    max: 5,
  });

  for (const model of chain) {
    try {
      if (model.provider === "elevenlabs") {
        const hit = await elevenLabsTTS(script, opts.voice, opts.speed);
        if (hit) return hit;
      } else if (model.provider === "openai") {
        const hit = await openAITTS(script, opts.voice, opts.speed);
        if (hit) return hit;
      } else if (model.provider === "pollinations") {
        const hit = await pollinationsTTS(script, opts.voice, opts.speed);
        if (hit) return hit;
      }
    } catch (e) {
      console.error("[bw] tts fail", model.provider, (e as Error)?.message);
    }
  }
  return null;
}
