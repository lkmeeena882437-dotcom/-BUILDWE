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
[3] estimateComplexity()  (simple | normal | complex)
    ↓
[4] pickModel({ capability, plan, prompt })
       FREE: maximize quality − cost
       PRO:  maximize quality (cost secondary)
    ↓
[5] Provider call (Groq / OpenRouter / Fal / TTS / …)
    ↓
[6] Fallback chain on error
    ↓
[7] Stream or return + usage log
```

Code: `lib/ai/rules.ts`, `lib/ai/models-catalog.ts`, `lib/ai/gateway.ts`.

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

## User BYOK (future UI)

1. User pastes key in Settings  
2. Server encrypts with `BYOK_ENCRYPTION_SECRET`  
3. Gateway prefers BYOK over platform keys for that user  

## Privacy

Prompts may go to third-party model APIs. See `/privacy` and `/terms`.
