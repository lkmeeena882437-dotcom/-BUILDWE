# BUILDWE — How the AI backend works

## Free vs PRO

| | **Free** | **PRO** |
|---|----------|---------|
| Model pick | **Automatic only** — AI decides from catalog | Auto by default + optional manual pick later |
| Goal | Best output under cost/speed budget | Higher quality / priority queue |
| Chat | Fair-use unlimited feel | Priority + stronger models when hard |
| Code / Image / Audio | Hidden daily limits | Higher / no hard daily image-audio caps |
| BYOK | Optional later | Optional — user API keys |

## Request pipeline

```
User prompt
    ↓
[1] Auth + rate limit + plan check
    ↓
[2] If mode=auto → detectIntent()  (chat | code | image | audio)
    ↓
[2b] If webSearch on → DuckDuckGo top-5 → context block + [n] citations
     (key-free; without LLM keys the sourced summary IS the answer)
    ↓
[3] estimateComplexity()  (simple | normal | complex)
    ↓
[4] pickModel({ capability, plan, prompt })
       FREE: maximize quality − cost
       PRO:  maximize quality (cost secondary)
    ↓
[5] Provider call (Groq / OpenRouter / Pollinations / Vision / TTS / …)
    ↓
[6] Fallback chain on error → smart offline reply
    ↓
[7] Stream or return + usage log (+ partial save on abort)
```

Code: `lib/ai/rules.ts`, `lib/ai/models-catalog.ts`, `lib/ai/providers.ts`, `lib/ai/provider-registry.ts`, `lib/ai/stt.ts`, `lib/ai/search.ts`.

## Phase 10 — Auto-Router model strategy

`routeModelFor()` in `lib/ai/models-catalog.ts` makes the product's *intent → model*
policy explicit on top of the scored pick (remembered only on PRO, since free
stays cost-driven):

- **normal question** → `GPT-4o` (flagship all-rounder)
- **large document / PDF** → `Gemini 1.5 Pro` (2M-token context)
- **React / Python / bug / refactor** → `Claude 3.5 Sonnet` (king of code)
- **generate image / draw** → premium image route (FLUX Pro / Midjourney) via the image studio

The full pipeline is: `USER → FEATURE → BACKEND API → AI ROUTER → RIGHT MODEL →
AI PROVIDER → RESULT → BUILDWE`.

## Capabilities in the catalog

The catalog now registers models under six capabilities plus the internal
`router`: `chat`, `code`, `image`, `audio`, `stt` (speech-to-text) and `vision`
(image understanding). The admin health endpoint reports reachable counts per
capability: `GET /api/health`.

## Models we recommend adding (all optional — keep many)

### Chat
- **Free auto:** Llama 3.1 8B Instant (simple), Llama 3.3 70B / DeepSeek / Gemini Flash (normal)
- **Pro:** GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Llama 3.1 70B/405B, Mistral Large 2

### Code
- **Free auto:** Qwen2.5 Coder 32B, DeepSeek Coder V2
- **Pro:** Claude 3.5 Sonnet (code), Claude 3 Opus, GPT-4o, DeepSeek Coder V2, Qwen2.5 Coder (Together)

### Image
- **Free auto:** FLUX, FLUX Turbo, SDXL fallback
- **Pro:** FLUX Pro, Midjourney v6.1 (GoAPI), DALL·E 3, Stable Diffusion 3

### Vision (image understanding — NOT generation)
- **Pro:** GPT-4o Vision, Claude 3.5 Sonnet Vision (Groq free fallback)

### Audio (TTS)
- **Free auto:** Pollinations openai-audio (keyless, default)
- **Pro:** ElevenLabs Multilingual (Hindi + world voices), OpenAI TTS HD, PlayHT

### Speech-to-Text (STT — Voice: Listen)
- **Free auto:** Whisper v3 (Groq)
- **Pro:** Deepgram Nova-2 (low-latency streaming)

Full list with scores: `lib/ai/models-catalog.ts` → `MODEL_CATALOG`.

## Env (no secrets in git)

```bash
cp .env.example .env.local
```

Set provider keys + optional `AI_CHAT_MODEL`, `AI_CODE_MODEL_PRO`, etc.

## User BYOK (live)

1. User pastes key in Settings → API keys  
2. Server encrypts with `BYOK_ENCRYPTION_SECRET` (AES-256-GCM, `lib/crypto.ts`)  
3. Gateway prefers BYOK over platform keys for that user (chat, code, vision, dev API)  

## Real audio (TTS)

- `POST /api/ai/audio` first tries **Pollinations `openai-audio`** (key-free) → returns `type:"mp3"` + `audioUrl` data URL (native player + MP3 download)
- Falls back to `type:"browser-tts"` (Web Speech) if the network call fails
- Voice map: BUILDWE voice ids → openai timbres (nova/onyx/shimmer/echo/fable/alloy)

## Developer API

- `POST /api/v1/chat` — `Authorization: Bearer bw_sk_…`
- Keys created/revoked at `/developers`; SHA-256 hashed at rest; 30 rpm/key; 10 keys/account
- Uses the owner's plan + BYOK keys; non-streaming JSON `{ok, model, live, reply}`

## Ads

- Free plan only: house-ad slots in chat empty state + sidebar (`components/AdSlot.tsx`)
- Override with real network markup via `NEXT_PUBLIC_AD_HTML`; PRO never sees ads

## Web search (live, key-free)

- `POST /api/ai/search { query }` → top-5 DuckDuckGo results
- Chat with `webSearch: true` (or the 🌐 toggle / `search:` prefix) injects them as grounding context and streams back `meta.sources`
- No LLM key? The composed sourced summary is streamed instead — search still works offline-mode

## Vision

- `POST /api/ai/vision { image: dataURL, prompt }`
- Groq `llama-4-scout-17b` (or `llama-3.2-11b-vision`) when `GROQ_API_KEY` set
- Otherwise honest preview fallback (explains how to enable)

## File analysis

- `POST /api/ai/file { name, text }` — CSV: rows, column types, min/max/avg, uniques; text: lines/words/keywords + excerpt
- Deterministic + free; the summary is injected into the chat prompt

## Privacy

Prompts may go to third-party model APIs. See `/privacy` and `/terms`.
