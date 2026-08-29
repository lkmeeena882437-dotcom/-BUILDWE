/**
 * BUILDWE AI runtime — live LLM first, smart offline only if providers fail.
 * Always answers the user's actual message (no generic template spam).
 */

import { AI_KEYS, AI_MODELS, APP, hasProviderKey } from "@/lib/config";
import { SYSTEM_PROMPTS, publicModelLabel, type Plan } from "@/lib/ai/rules";
import { pickModel } from "@/lib/ai/models-catalog";
import {
  buildMind,
  packMessagesForModel,
  type ChatTurn,
  type MindProfile,
} from "@/lib/ai/mind";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Groq-valid models (keep this list current) */
const GROQ_CHAT_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "gemma2-9b-it",
  "mixtral-8x7b-32768",
];

const GROQ_CODE_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
];

async function groqStream(messages: ChatMessage[], model: string) {
  if (!hasProviderKey("groq")) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_KEYS.groq}`,
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
      const errText = await res.text().catch(() => "");
      console.error("[bw] groq stream fail", model, res.status, errText.slice(0, 200));
      return null;
    }
    return res.body;
  } catch (e) {
    console.error("[bw] groq stream error", model, e);
    return null;
  }
}

/** Non-stream fallback when streaming fails */
async function groqComplete(messages: ChatMessage[], model: string): Promise<string | null> {
  if (!hasProviderKey("groq")) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_KEYS.groq}`,
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
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[bw] groq complete fail", model, res.status, errText.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch (e) {
    console.error("[bw] groq complete error", model, e);
    return null;
  }
}

async function openRouterStream(messages: ChatMessage[], model: string) {
  if (!hasProviderKey("openrouter")) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_KEYS.openrouter}`,
        "Content-Type": "application/json",
        "HTTP-Referer": APP.url || "https://buildwe.vercel.app",
        "X-Title": APP.name || "BUILDWE",
      },
      body: JSON.stringify({
        model: model.includes("/") ? model : `meta-llama/llama-3.3-70b-instruct`,
        messages,
        temperature: 0.7,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      console.error("[bw] openrouter fail", res.status);
      return null;
    }
    return res.body;
  } catch (e) {
    console.error("[bw] openrouter error", e);
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
              /* skip */
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

/**
 * Offline replies that ACTUALLY address the user message.
 * Used only when no live provider works.
 */
function smartOfflineChat(
  prompt: string,
  history: { role: string; content: string }[]
): string {
  const raw = prompt.trim();
  const p = raw.toLowerCase();
  const isHinglish =
    /kya|hai|ho|haan|nahi|kaise|kese|kyu|kyun|mujhe|tum|apka|aap|bhai|yaar|karo|kro|baat|hinglish|samajh|plan|kaam/.test(
      p
    );

  // Greetings
  if (
    /^(hi+|h+e+y+|h+e+l+o+|hy+|hii+|hello|namaste|namaskar|salam)\b/i.test(p) ||
    /^(hi|hey|hy|hii|hello)\s+(kese|kaise|kya)/i.test(p) ||
    /kese ho|kaise ho|kya haal|what's up|whats up|wassup/.test(p)
  ) {
    return isHinglish
      ? `Hey! Main theek hoon 👍

Main **BUILDWE** hoon — yahan tum:
• baat cheet / ideas  
• code  
• image  
• voice  

sab ek jagah kar sakte ho.

Bolo, aaj kya karna hai?`
      : `Hey — I'm good.

I'm **BUILDWE**. I can help you chat, write, code, make images, or turn text into voice.

What do you want to do?`;
  }

  if (/hinglish|hindi me|hindi mein|urdu/.test(p)) {
    return `Theek hai — ab **Hinglish** mein baat karta hoon.

Tum jo bhi poochoge (plan, code, writing, idea), seedha usi pe jawab dunga.

Ab bolo: exactly kya chahiye?`;
  }

  if (/kya kr rhe ho|kya kar rahe|what are you doing/.test(p)) {
    return isHinglish
      ? `Abhi tumhare saath chat pe hoon — tumhara message padh ke jawab de raha hoon.

Main BUILDWE AI workspace hoon. Tum mujhse sawal, writing, code, image ya voice maang sakte ho.

Bolo next kya chahiye?`
      : `Right now I'm here in this chat, reading your messages and helping you.

I can think with you, write, code, generate images, or speak text.

What should we do next?`;
  }

  if (/who are you|tum kaun|what is buildwe|tu kaun/.test(p)) {
    return isHinglish
      ? `Main **BUILDWE** hoon — ek AI platform.

Ek jagah pe:
1. **Chat** — sochna, likhna, plan  
2. **Code** — idea se working code  
3. **Image** — text se picture  
4. **Audio** — script se awaaz  

Free shuru hota hai. Bolo kahan se start karein?`
      : `I'm **BUILDWE** — your AI workspace for chat, code, image, and voice in one place.

What do you want to make?`;
  }

  // Short casual — don't dump framework
  if (raw.length < 50 && !/code|build|write|plan|help|explain/.test(p)) {
    return isHinglish
      ? `Samajh gaya: “${raw}”

Thoda clear bolo kya chahiye —  
• baat / advice  
• kuch likhna  
• code  
• image  
• voice  

Main seedha usi pe kaam karta hoon.`
      : `Got “${raw}”.

Tell me what you need — answer, draft, code, image, or voice — and I’ll do that directly.`;
  }

  // Default: reflect + answer shape tied to their words
  const recent = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 120)}`)
    .join("\n");

  if (isHinglish) {
    return `Tumne kaha: **“${raw.slice(0, 300)}”**

Main isko aise handle karta hoon:

1. Pehle tumhara exact point pakadta hoon  
2. Phir seedha useful jawab / steps deta hoon  

**Abhi ka short take:**  
Batao yeh message se tumhe *kya result* chahiye — explanation, plan, message draft, ya code?  

Jo bhi bolo, next reply mein main wahi deliver karunga — generic lecture nahi.`;
  }

  return `You said: **“${raw.slice(0, 300)}”**

I'll answer that directly.

**What I need for a sharper reply (pick one):**
- a yes/no or factual answer  
- a short plan  
- a written draft  
- code  

Reply with which one — or just continue the thought and I’ll stay on this topic.

${recent ? `(Context noted from recent messages.)` : ""}`;
}

function smartOfflineCode(prompt: string): string {
  const raw = prompt.trim();
  return `Samajh gaya — tum code/project side pe ho.

**Tumhara request:** ${raw.slice(0, 240)}

### Quick path
1. Goal clear karo (web page / game / API / fix)  
2. Main uske hisaab se working code dunga  
3. Copy → run → next improve  

Agar yeh ek **naya mini project** hai, ek line mein bolo:
- “HTML quiz bana do”  
- “todo app react”  
- “landing page cream theme”  

Main next message mein **complete code block** dunga.`;
}

export async function streamChatOrCode(opts: {
  mode: "chat" | "code";
  messages: { role: string; content: string }[];
  plan: Plan;
  skills?: string[];
  /** thumbs feedback memory */
  prefer?: string[];
  avoid?: string[];
  promptForRouting: string;
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
    const body = await groqStream(messages, model);
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
    const body = await openRouterStream(messages, model);
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
    const text = await groqComplete(messages, model);
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
    stream: textToSSE(offline),
    model: publicModelLabel(undefined, opts.mode),
    live: false,
    mind,
  };
}

/* Image */
export function buildImageUrl(prompt: string, aspect: string) {
  const map: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [768, 1344],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
  };
  const [w, h] = map[aspect] || map["1:1"];
  const seed = Math.floor(Math.random() * 1_000_000);
  const clean = prompt.replace(/\s+/g, " ").trim().slice(0, 450);
  const enhanced = `${clean}, photorealistic, highly detailed, natural lighting`;
  const q = encodeURIComponent(enhanced);
  return `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=true&model=flux`;
}

export async function generateImage(opts: {
  prompt: string;
  aspect: string;
  plan: Plan;
}) {
  const url = buildImageUrl(opts.prompt, opts.aspect);
  // quick HEAD/GET probe optional — don't block
  return {
    url,
    model: "BUILDWE Vision",
    provider: "buildwe",
    live: true,
  };
}

export async function generateAudioPlan(opts: {
  text: string;
  voice: string;
  speed: number;
  plan: Plan;
}) {
  return {
    type: "browser-tts" as const,
    text: opts.text.slice(0, 4000),
    voice: opts.voice,
    speed: opts.speed,
    model: "BUILDWE Voice",
    provider: "buildwe",
    live: true,
  };
}
