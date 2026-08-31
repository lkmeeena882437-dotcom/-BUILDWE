# BUILDWE.ONLINE

**Build anything. Create everything.**

100% free-stack AI workspace: **Auto · Chat · Code · Image · Audio · Web Search · Vision · Projects · Share**

Cream Gen-Z UI (not dark) + real backend APIs + PWA installable.

## Why it exists

Creators juggle ChatGPT + coding tools + image + TTS apps. BUILDWE is one workspace so students, founders, and builders can think, ship code, make visuals, and speak text — without tab chaos.

## Free stack (A→Z)

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, Tailwind, cream design system, PWA |
| Auth | Guest mode + email/password (scrypt) + OAuth (Google/GitHub) · JWT httpOnly · reset links · account deletion |
| Database | Local JSON file DB (`/data`, atomic writes) — optional Supabase mirror for multi-instance |
| Chat / Code | Groq free tier → OpenRouter → smart demo fallback |
| Web search | **DuckDuckGo HTML** (no API key) — grounded answers with sources |
| Vision | Groq `llama-4-scout` (add key) · honest preview fallback |
| File analysis | CSV stats + text summary (free, no key) |
| Images | **Pollinations.ai** (no API key) |
| Audio | **Pollinations openai-audio** (key-free real MP3) → browser TTS fallback |
| BYOK | Users' own Groq/OpenRouter keys, AES-256-GCM encrypted |
| Dev API | `POST /api/v1/chat` + keys at `/developers` |
| Ads | Free-plan house-ad slots (PRO ad-free) |
| Projects | Group chats into projects (folders) |
| Teams | Shared team workspaces with invite links |
| Share | Public read-only links `/s/{id}` |
| Billing | Razorpay real checkout (demo until keys set) |
| Limits | Server-side daily counters |
| Docs & trust | `/how-it-works` `/security` `/acceptable-use` `/changelog` `/status` `/help` `/contact` + JSON-LD/sitemap |

## Quick start

```bash
cp .env.example .env.local
# optional: GROQ_API_KEY=...  OPENROUTER_API_KEY=...
npm install
npm run dev
```

Open http://localhost:3000

- Landing → **Start free** → workspace  
- Guest works immediately (history via cookie)  
- Register free for named account  

## Live AI without keys

- **Image** works out of the box (Pollinations)  
- **Audio** uses browser voices  
- **Chat/Code** stream demo text until you add `GROQ_API_KEY` or `OPENROUTER_API_KEY`  

Set in `.env.local`:

```
# (no demo/mock switch exists: checkout answers 503 until Razorpay keys are set) NEXT_PUBLIC_REMOVED=false
GROQ_API_KEY=gsk_...
```

## API map

| Route | Role |
|-------|------|
| `POST /api/auth/register` | Free signup |
| `POST /api/auth/login` | Login |
| `POST /api/auth/logout` | Logout |
| `GET  /api/auth/me` | Session + usage |
| `GET/POST/DELETE /api/history` | Conversations |
| `POST /api/ai/chat` | SSE chat stream (`webSearch: true` → grounded + sources) |
| `POST /api/ai/code` | SSE code stream |
| `POST /api/ai/image` | Image URL |
| `POST /api/ai/audio` | TTS plan |
| `POST /api/ai/auto` | Intent detect |
| `POST /api/ai/search` | Web search (DDG, key-free) |
| `POST /api/ai/vision` | Image understanding (GPT-4o / Claude / Groq) |
| `POST /api/ai/transcribe` | Speech-to-text (Deepgram Nova-2 / Whisper) |
| `POST /api/ai/file` | CSV/text analysis |
| `GET/POST/DELETE /api/projects` | Project folders |
| `GET/POST /api/teams` | Team workspaces (create/join/invite/leave/assign) |
| `POST /api/share` · `GET /api/share?id=` | Public share links |
| `POST /api/checkout/order` | Razorpay order (real + demo) |
| `POST /api/checkout/verify` | HMAC verify → plan=pro |
| `GET/POST /api/user/keys` | BYOK — save/mask own Groq/OpenRouter keys |
| `GET/POST/DELETE /api/dev/keys` | Developer API key management |
| `POST /api/v1/chat` | **Public developer API** (Bearer bw_sk_…) |
| `GET  /api/health` | Provider status |

## Brain / architecture

See `docs/PROJECT_BRAIN.md` and `docs/AI_BACKEND.md`.

```
Prompt → auth → rate limit → auto intent → pickModel → provider → save history
```

## Model capability headlines (UI)

- **Auto** — One prompt. The right tool.  
- **Chat** — Think deeper. Write clearer.  
- **Code** — Idea → working files.  
- **Image** — Text becomes visual.  
- **Audio** — Words become voice.  

## Scripts

- `npm run dev` — 0.0.0.0:3000  
- `npm run build`  
- `npm start`  
