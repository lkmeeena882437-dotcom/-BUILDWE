/**
 * BUILDWE AI runtime — providers stay server-side only.
 * User-facing copy never names vendors, keys, or "demo".
 */

import { AI_KEYS, AI_MODELS, APP, hasProviderKey } from "@/lib/config";
import { SYSTEM_PROMPTS, publicModelLabel, type Plan } from "@/lib/ai/rules";
import { pickModel, estimateComplexity } from "@/lib/ai/models-catalog";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function skillPrefix(skills?: string[]) {
  if (!skills?.length) return "";
  return `\nUser context/skills: ${skills.slice(0, 6).join(", ")}. Tune tone and examples.`;
}

async function groqChat(messages: ChatMessage[], model: string) {
  if (!hasProviderKey("groq")) return null;
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
    console.error("[bw] llm primary", res.status);
    return null;
  }
  return res.body;
}

async function openRouterChat(messages: ChatMessage[], model: string) {
  if (!hasProviderKey("openrouter")) return null;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_KEYS.openrouter}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP.url,
      "X-Title": APP.name,
    },
    body: JSON.stringify({
      model: model.includes("/") ? model : `meta-llama/${model}`,
      messages,
      temperature: 0.7,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    console.error("[bw] llm secondary", res.status);
    return null;
  }
  return res.body;
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
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const token = json.choices?.[0]?.delta?.content || "";
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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Something interrupted the response. Try again." })}\n\n`
          )
        );
        controller.close();
      }
    },
  });
}

function offlineStream(text: string) {
  const encoder = new TextEncoder();
  const parts = text.split(/(\s+)/);
  return new ReadableStream({
    async start(controller) {
      for (const p of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: p })}\n\n`));
        await new Promise((r) => setTimeout(r, p.length > 8 ? 10 : 4));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });
}

/** High-quality offline assistant — never mentions keys/vendors */
function offlineChat(prompt: string) {
  const p = prompt.toLowerCase();

  if (/hello|hi\b|hey|namaste|hii/.test(p) && prompt.length < 40) {
    return `Hey — you're on **BUILDWE**.

I can help you think things through, write, plan, or create.

What's the actual goal right now?`;
  }

  if (/who are you|what are you|what is buildwe/.test(p)) {
    return `I'm **BUILDWE** — your all-in-one AI workspace.

In one place you can:
- **Chat** — think, write, learn  
- **Code** — turn ideas into working projects  
- **Image** — describe → visual  
- **Audio** — text → natural voice  

Everything starts free. PRO unlocks higher limits and a quieter, ad-light experience.

What do you want to make first?`;
  }

  if (/startup|business|idea|brainstorm/.test(p)) {
    return `Here are **five sharp angles** you can pressure-test this week:

1. **One painful weekly task** your audience already hates — automate it  
2. **Template pack** from work you've already done well  
3. **Niche brief generator** (scripts, posts, outreach)  
4. **Local-first tool** that works offline and feels premium  
5. **Service → product**: productize your most repeated client request  

**Pick one audience + one job-to-be-done.** That's the wedge.

Tell me who you serve and I'll narrow this to a 7-day MVP.`;
  }

  if (/email|copy|write|draft|rewrite/.test(p)) {
    return `Here's a clean draft you can ship:

---

**Subject:** A simpler way to build with AI  

Hi {{name}},

Most people bounce between five AI tabs.

**BUILDWE** keeps chat, code, image, and voice in one calm workspace — free to start.

Open it → do the work → move on.

Try free: buildwe.online

—  

---

Want it shorter, warmer, or more founder-voice? Say the tone.`;
  }

  return `**Got it.**

Here's a tight way to move:

1. **Outcome** — one sentence for what “done” looks like  
2. **Constraints** — time, tools, audience, must-haves  
3. **First cut** — smallest version that still helps  

You said: *“${prompt.slice(0, 180)}${prompt.length > 180 ? "…" : ""}”*

Reply with constraints (or paste more context) and I'll go concrete — plan, draft, or structure.`;
}

function offlineCode(prompt: string) {
  return `Here's a clean starter for that ask.

### Approach
- Minimal files, runs in the browser  
- Clear structure you can extend  

### Code

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BUILDWE App</title>
  <style>
    :root { --bg:#F7F4EE; --ink:#14110F; --accent:#C45C26; --line:#E6E0D6; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--ink); }
    main { max-width: 720px; margin: 0 auto; padding: 48px 20px; }
    h1 { letter-spacing: -0.03em; font-size: clamp(1.8rem, 4vw, 2.6rem); }
    p { color:#6B6560; line-height:1.55; }
    .btn { display:inline-flex; margin-top:16px; padding:12px 18px; border-radius:14px;
      background:var(--accent); color:#fff; text-decoration:none; font-weight:600; }
    .card { margin-top:24px; padding:18px; border:1px solid var(--line); border-radius:16px; background:#fff; }
  </style>
</head>
<body>
  <main>
    <h1>Ship the first version.</h1>
    <p>Built on BUILDWE from: ${prompt.slice(0, 100).replace(/</g, "")}</p>
    <a class="btn" href="#">Continue</a>
    <div class="card">Replace this card with your real feature.</div>
  </main>
</body>
</html>
\`\`\`

### Run
Save as \`index.html\` and open in a browser.

Tell me the stack you want next (React, Next.js, API, auth) and I'll extend it.`;
}

export async function streamChatOrCode(opts: {
  mode: "chat" | "code";
  messages: { role: string; content: string }[];
  plan: Plan;
  skills?: string[];
  promptForRouting: string;
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string; live: boolean }> {
  const catalogModel = pickModel({
    capability: opts.mode,
    plan: opts.plan,
    prompt: opts.promptForRouting,
  });

  const system =
    (opts.mode === "code" ? SYSTEM_PROMPTS.code : SYSTEM_PROMPTS.chat) +
    skillPrefix(opts.skills);

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...opts.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  ];

  const envModel =
    opts.plan === "pro"
      ? opts.mode === "code"
        ? AI_MODELS.pro.code
        : AI_MODELS.pro.chat
      : opts.mode === "code"
        ? AI_MODELS.free.code
        : AI_MODELS.free.chat;

  const tryModels = [
    envModel,
    catalogModel.id,
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];

  // Always try live providers first when keys exist (ignore demo flag for quality)
  for (const model of tryModels) {
    let body = await groqChat(messages, model);
    if (body) {
      return {
        stream: openAIStreamToTextSSE(body),
        model: publicModelLabel(model, opts.mode),
        live: true,
      };
    }
    body = await openRouterChat(messages, model);
    if (body) {
      return {
        stream: openAIStreamToTextSSE(body),
        model: publicModelLabel(model, opts.mode),
        live: true,
      };
    }
  }

  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const text =
    opts.mode === "code" ? offlineCode(lastUser) : offlineChat(lastUser);

  return {
    stream: offlineStream(text),
    model: publicModelLabel(undefined, opts.mode),
    live: false,
  };
}

/* Image — free endpoint, branded as BUILDWE Vision in UI */
export function buildImageUrl(prompt: string, aspect: string) {
  const map: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
  };
  const [w, h] = map[aspect] || map["1:1"];
  const seed = Math.floor(Math.random() * 1_000_000);
  const enhanced = `${prompt.slice(0, 400)}, high quality, sharp detail, premium composition`;
  const q = encodeURIComponent(enhanced);
  return `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=true`;
}

export async function generateImage(opts: {
  prompt: string;
  aspect: string;
  plan: Plan;
}) {
  void pickModel({
    capability: "image",
    plan: opts.plan,
    prompt: opts.prompt,
  });
  const complexity = estimateComplexity(opts.prompt);
  const url = buildImageUrl(opts.prompt, opts.aspect);
  return {
    url,
    model: "BUILDWE Vision",
    provider: "buildwe",
    complexity,
    live: true,
  };
}

export async function generateAudioPlan(opts: {
  text: string;
  voice: string;
  speed: number;
  plan: Plan;
}) {
  void pickModel({
    capability: "audio",
    plan: opts.plan,
    prompt: opts.text,
  });
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
