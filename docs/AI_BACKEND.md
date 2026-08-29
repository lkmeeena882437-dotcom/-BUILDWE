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

Code: `lib/ai/rules.ts`, `lib/ai/models-catalog.ts`, `lib/ai/providers.ts`, `lib/ai/search.ts`.

## Models we recommend adding (all optional — keep many)

### Chat
- **Free auto:** Llama 3.1 8B Instant (simple), Llama 3.3 70B / DeepSeek / Gemini Flash (normal)
- **Pro:** Claude Sonnet, GPT-4o mini, Llama 3.3 70B

### Code
- **Free auto:** Qwen2.5 Coder 32B, DeepSeek Coder
- **Pro:** Claude Sonnet (code), GPT-4.1 mini, Qwen2.5 Coder

### Image
- **Free auto:** FLUX Schnell, SDXL Turbo fallback
- **Pro:** FLUX Dev / FLUX Pro

### Audio (TTS)
- **Free auto:** OpenAI TTS / Cartesia / Deepgram Aura
- **Pro:** ElevenLabs Multilingual (Hindi + world voices)

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
