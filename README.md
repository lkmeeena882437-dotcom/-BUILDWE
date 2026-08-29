# BUILDWE.ONLINE

**Build anything. Create everything.**

100% free-stack AI workspace: **Auto · Chat · Code · Image · Audio**

Cream Gen-Z UI (not dark) + real backend APIs.

## Why it exists

Creators juggle ChatGPT + coding tools + image + TTS apps. BUILDWE is one workspace so students, founders, and builders can think, ship code, make visuals, and speak text — without tab chaos.

## Free stack (A→Z)

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, Tailwind, cream design system |
| Auth | Guest cookie + email/password (scrypt), JWT httpOnly |
| Database | Local JSON file DB (`/data`) — zero paid SaaS |
| Chat / Code | Groq free tier → OpenRouter → smart demo fallback |
| Images | **Pollinations.ai** (no API key) |
| Audio | **Web Speech API** (browser TTS) |
| Limits | Server-side daily counters |
| Docs | `/about` model matrix, `/privacy`, `/terms`, `/pricing` |

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
NEXT_PUBLIC_DEMO_MODE=false
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
| `POST /api/ai/chat` | SSE chat stream |
| `POST /api/ai/code` | SSE code stream |
| `POST /api/ai/image` | Image URL |
| `POST /api/ai/audio` | TTS plan |
| `POST /api/ai/auto` | Intent detect |
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
