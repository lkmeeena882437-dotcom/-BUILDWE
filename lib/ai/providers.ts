/**
 * BUILDWE AI runtime — live LLM first, smart offline only if providers fail.
 */

import { AI_KEYS, AI_MODELS, APP } from "@/lib/config";
import { SYSTEM_PROMPTS, publicModelLabel, type Plan } from "@/lib/ai/rules";
import { pickModel } from "@/lib/ai/models-catalog";
import {
  buildMind,
  packMessagesForModel,
  type ChatTurn,
  type MindProfile,
} from "@/lib/ai/mind";
import { mergeImagePrompt } from "@/lib/ai/image-prompt";

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

export type ProviderKeys = { groq?: string; openrouter?: string };

async function groqStream(messages: ChatMessage[], model: string, userKeys?: ProviderKeys) {
  const key = userKeys?.groq || AI_KEYS.groq;
  if (!key) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        stream: true,
        max_tokens: 4096,
      }),
    });
    if (!res.ok || !res.body) {
      console.error("[bw] groq stream fail", model, res.status);
      return null;
    }
    return res.body;
  } catch (e) {
    console.error("[bw] groq stream error", e);
    return null;
  }
}

async function groqComplete(
  messages: ChatMessage[],
  model: string,
  userKeys?: ProviderKeys
): Promise<string | null> {
  const key = userKeys?.groq || AI_KEYS.groq;
  if (!key) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        stream: false,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function openRouterStream(messages: ChatMessage[], model: string, userKeys?: ProviderKeys) {
  const key = userKeys?.openrouter || AI_KEYS.openrouter;
  if (!key) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": APP.url || "https://buildwe.vercel.app",
        "X-Title": APP.name || "BUILDWE",
      },
      body: JSON.stringify({
        model: model.includes("/")
          ? model
          : "meta-llama/llama-3.3-70b-instruct",
        messages,
        temperature: 0.7,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) return null;
    return res.body;
  } catch {
    return null;
  }
}

export function openAIStreamToTextSSE(body: ReadableStream<Uint8Array>) {
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
              const json = JSON.parse(data);
              const token =
                json.choices?.[0]?.delta?.content ||
                json.choices?.[0]?.message?.content ||
                "";
              if (token) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
                );
              }
            } catch {
              /* */
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
  const raw = prompt.trim();
  const p = raw.toLowerCase();
  const isHinglish =
    /kya|hai|ho|haan|nahi|kaise|kese|kyu|mujhe|tum|bhai|yaar|karo|kro|baat|hinglish|samajh|plan|kaam/.test(
      p
    );

  if (
    /^(hi+|h+e+y+|h+e+l+o+|hy+|hii+|hello|namaste)\b/i.test(p) ||
    /kese ho|kaise ho|kya haal|what's up/.test(p)
  ) {
    return isHinglish
      ? `Hey! Main theek hoon 👍\n\nMain **BUILDWE** hoon. Chat, code, image, voice — sab yahin.\n\nBolo aaj kya karna hai?`
      : `Hey — all good.\n\nI'm **BUILDWE**. Chat, code, image, or voice — what do you need?`;
  }

  if (/hinglish|hindi me|hindi mein/.test(p)) {
    return `Theek hai — ab **Hinglish** mein baat karta hoon.\n\nExact bolo kya chahiye.`;
  }

  if (raw.length < 50 && !/code|build|write|plan|help|explain/.test(p)) {
    return isHinglish
      ? `Samajh gaya: “${raw}”\n\nClear bolo — baat, draft, code, image, ya voice?`
      : `Got “${raw}”.\n\nWhat do you need — answer, draft, code, image, or voice?`;
  }

  void history;
  return isHinglish
    ? `Tumne kaha: **“${raw.slice(0, 280)}”**\n\nSeedha bolo result kya chahiye — explanation, plan, draft, ya code — next reply mein wahi dunga.`
    : `You said: **“${raw.slice(0, 280)}”**\n\nTell me the result you want (answer / plan / draft / code) and I’ll deliver that.`;
}

function smartOfflineCode(prompt: string): string {
  return `Request: ${prompt.slice(0, 240)}\n\nBolo exact deliverable (HTML quiz / React todo / landing page) — next message mein complete code block dunga.`;
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
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  model: string;
  live: boolean;
  mind: MindProfile;
}> {
  const turns: ChatTurn[] = opts.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content || ""),
    }));

  const mind = buildMind(turns, opts.skills || [], {
    prefer: opts.prefer,
    avoid: opts.avoid,
  });

  const baseSystem =
    opts.mode === "code" ? SYSTEM_PROMPTS.code : SYSTEM_PROMPTS.chat;

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

  const envModel =
    opts.plan === "pro"
      ? opts.mode === "code"
        ? AI_MODELS.pro.code
        : AI_MODELS.pro.chat
      : opts.mode === "code"
        ? AI_MODELS.free.code
        : AI_MODELS.free.chat;

  const catalog = pickModel({
    capability: opts.mode,
    plan: opts.plan,
    prompt: opts.promptForRouting || lastUser,
  });

  const preferred =
    opts.mode === "code"
      ? [envModel, catalog.id, ...GROQ_CODE_MODELS]
      : [envModel, catalog.id, ...GROQ_CHAT_MODELS];

  const tryModels = Array.from(new Set(preferred.filter(Boolean)));

  for (const model of tryModels) {
    const body = await groqStream(messages, model, opts.userKeys);
    if (body) {
      return {
        stream: openAIStreamToTextSSE(body),
        model: publicModelLabel(model, opts.mode),
        live: true,
        mind,
      };
    }
  }

  for (const model of tryModels.slice(0, 3)) {
    const body = await openRouterStream(messages, model, opts.userKeys);
    if (body) {
      return {
        stream: openAIStreamToTextSSE(body),
        model: publicModelLabel(model, opts.mode),
        live: true,
        mind,
      };
    }
  }

  for (const model of tryModels.slice(0, 4)) {
    const text = await groqComplete(messages, model, opts.userKeys);
    if (text) {
      return {
        stream: textToSSE(text),
        model: publicModelLabel(model, opts.mode),
        live: true,
        mind,
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
    live: false,
    mind,
  };
}

/* ── Vision (image understanding) ─────────────────────────── */

const VISION_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.2-11b-vision-preview",
];

export async function visionComplete(opts: {
  prompt: string;
  imageDataUrl: string;
  userKeys?: ProviderKeys;
}): Promise<{ text: string; model: string; live: boolean }> {
  const question =
    opts.prompt.trim() || "Describe this image in detail. What's in it?";
  const groqKey = opts.userKeys?.groq || AI_KEYS.groq;

  for (const model of VISION_MODELS) {
    if (!groqKey) break;
    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 900,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: question },
                  {
                    type: "image_url",
                    image_url: { url: opts.imageDataUrl },
                  },
                ],
              },
            ],
          }),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text: string | undefined =
        data?.choices?.[0]?.message?.content || undefined;
      if (text) return { text, model: "BUILDWE Vision AI", live: true };
    } catch (e) {
      console.error("[bw] vision fail", model, e);
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
      "Full AI vision needs a `GROQ_API_KEY` (free at console.groq.com) set in `.env.local` — drop it in and image understanding goes live instantly.",
      "",
      "Till then: images are attached to this chat and will be sent with your question the moment a key is added.",
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

  const url = buildImageUrl(
    merged.prompt,
    opts.aspect === "yt" ? "16:9" : opts.aspect,
    opts.modelId || "flux"
  );

  return {
    url,
    promptUsed: merged.prompt,
    editMode: merged.mode,
    model:
      opts.modelId === "turbo"
        ? "BUILDWE Vision Fast"
        : opts.modelId === "pro"
          ? "BUILDWE Vision Pro"
          : "BUILDWE Vision",
    modelId: opts.modelId || "flux",
    provider: "buildwe",
    live: true,
    comingSoon: opts.modelId === "pro",
  };
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
      provider: "pollinations",
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
    live: true,
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

/**
 * Key-free TTS via Pollinations `openai-audio`.
 * GET when the script is short; POST /openai for longer scripts.
 * Returns a data URL the browser can play/download directly.
 */
export async function synthesizeSpeech(opts: {
  text: string;
  voice: string;
  speed: number;
}): Promise<{ dataUrl: string; estMs: number } | null> {
  const script = opts.text.trim().slice(0, 3500);
  if (!script) return null;
  const voice = TTS_VOICE_MAP[opts.voice] || "alloy";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);

  try {
    // 1) POST /openai — handles long scripts cleanly
    try {
      const res = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai-audio",
          voice,
          speed: opts.speed,
          messages: [
            {
              role: "user",
              content: `Read this script aloud exactly, nothing else:\n\n${script}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const raw = await res.text();
        const m = raw.match(DATA_AUDIO_RE);
        if (m) {
          const b64 = m[1];
          return {
            dataUrl: `data:audio/mpeg;base64,${b64}`,
            estMs: Math.round((b64.length * 3) / 4 / 24), // ~24KB/s mp3
          };
        }
      }
    } catch {
      /* fall through to GET */
    }

    // 2) GET path — short scripts
    if (encodeURIComponent(script).length < 1400) {
      const res = await fetch(
        `https://text.pollinations.ai/${encodeURIComponent(
          `Read this script aloud exactly, nothing else:\n\n${script}`
        )}?model=openai-audio&voice=${voice}`,
        { signal: ctrl.signal }
      );
      if (res.ok) {
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
        // JSON body with embedded data URL
        const m = (await res.text()).match(DATA_AUDIO_RE);
        if (m) {
          return {
            dataUrl: `data:audio/mpeg;base64,${m[1]}`,
            estMs: Math.round((m[1].length * 3) / 4 / 24),
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
