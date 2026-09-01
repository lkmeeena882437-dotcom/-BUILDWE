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
| Chat / Code | Groq free tier → OpenRouter → offline brain (computes math/conversions, gives structure, and says what it cannot do — it never pretends to be a model) |
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
| Billing | Razorpay checkout — real only: 503 `CHECKOUT_UNAVAILABLE` until keys are set, verified from the gateway's own signature |
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
- **Chat/Code** answer from the **offline brain** (`lib/ai/offline-brain.ts`) until you add `GROQ_API_KEY` or `OPENROUTER_API_KEY`: arithmetic and unit conversions computed exactly, real structure for writing and code asks, and a plain "I can't verify that offline" for factual ones. It is labelled as offline in the answer — there is no fake-model mode, and no switch that turns one on.  

Anything that cannot exist without a key says so instead of faking success: checkout answers `503 CHECKOUT_UNAVAILABLE` until Razorpay keys are set, transcription `503 TRANSCRIPTION_UNAVAILABLE` until a STT key is set.

Set in `.env.local`:

```
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
| `POST /api/ai/file` | CSV/text analysis (stats + summary, key-free) |
| `POST /api/ai/agent` | Coding Agent — plan, then real file edits in a project folder |
| `POST /api/ai/code-action` | Apply a fenced code block to the canvas or a project file |
| `POST /api/ai/compare` | One prompt across every live model, one credit per lane that answers |
| `POST /api/ai/verify` | Score a draft for factual risk (claims, hedging, sources) |
| `POST /api/ai/feedback` | Thumbs up/down on an answer, stored with the generation |
| `GET /api/ai/models` | The model catalogue the UI reads (never a second list in the client) |
| `GET /api/credits` | Balance, price list, and the limits the UI must not copy (`messageChars` …) |
| `GET/POST/DELETE /api/projects` | Project folders |
| `GET/POST /api/teams` | Team workspaces (create/join/invite/leave/assign) |
| `GET/PATCH/DELETE /api/ai/generations` | Your creations — studios' history (`?type=`), the curated list (`?view=artifacts`), one whole row (`?id=`), rename/pin, delete |
| `POST /api/share` · `GET /api/share?id=` | Public share links — for a whole chat or one creation; `action:"view"` counts an open |
| `GET  /api/checkout/order` | What checkout is actually configured to charge (the pricing page reads it rather than restating a price) |
| `POST /api/checkout/order` | Razorpay order (real only — 503 `CHECKOUT_UNAVAILABLE` without keys) |
| `POST /api/checkout/verify` | Signature check → plan=pro, credits topped up from the ledger |
| `POST /api/checkout/webhook` | Razorpay's own copy of the same event, HMAC-verified; idempotent |
| `POST /api/auth/forgot` · `POST /api/auth/reset` | Password reset: request a link, finish with the token |
| `GET  /api/auth/verify` | Email verification link |
| `GET /api/auth/oauth/[provider]` | OAuth sign-in start — state + PKCE, `google` and `github` |
| `GET /api/auth/oauth/[provider]/callback` | the redirect: state check, code exchange, session cookie |
| `POST /api/auth/delete` | Account + all its data. Password accounts confirm with the password, OAuth-only ones with the word `DELETE` |
| `GET/POST /api/user/keys` | BYOK — save/mask own Groq/OpenRouter keys |
| `GET/POST /api/user/skills` | Saved instructions a prompt may carry |
| `GET/POST/DELETE /api/projects/files` | Files inside a project folder (read, write, delete) |
| `GET /api/tools` · `GET/POST /api/tools/[id]` | The tool catalogue (`?brief=1` = the 31 names and costs ⌘K needs, no field schemas), and one tool |
| `GET /api/preview` | Link preview metadata (SSRF-guarded, cached, `NO_METADATA` when a page has none) |
| `GET/POST /api/metrics` | Prometheus text for `/metrics`, and the ingest the routes report into |
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

## Keyboard

In the workspace only (the landing page is a document, not a console):

- `⌘K` / `Ctrl+K` — Quick find: recent chats, the five modes, every sheet, all 31 tools and the studios. One search field, ranked by title prefix first; it fetches the tool list once, on first open, and says so if that fetch failed.
- `/` — put the caret in the composer (ignored while you are already typing somewhere).
- `Esc` — closes the topmost layer if one is open; otherwise stops the answer or the agent run that is in flight. Popovers, sheets and this shortcut each mark the key handled, so one press never does two things.

## Scripts

- `npm run dev` — 0.0.0.0:3000  
- `npm run build`  
- `npm start`  
- `npm run lint`

## Tests

`npm test` runs the chain below. Each suite boots its own app on its own port against a
throwaway data dir, so they can also be run one at a time — the port is in the file.

| Command | Checks |
|---------|--------|
| `npm run test:security` | the public-repo audit: no secrets, no dev-only surface in production, injection-safe HTML |
| `npm run test:markdown` | the renderer's XSS rules (the only HTML the app emits) |
| `npm run test:ui` | `lib/ui` primitives, placement maths, and the invariants every refactor has to keep |
| `npm run test:auth` | sessions, scrypt, cookie flags, OAuth state, rate limits |
| `npm run test:tools` | tool catalogue and tool runs |
| `npm run test:pricing` | `/pricing` reads the server's checkout config; seats are refused, never clamped |
| `npm run test:preview` | link previews and the SSRF guard |
| `npm run test:workspace` | the one-file chat context: budget order, refusals, Apply rows |
| `npm run test:artifacts` | creations: rename/pin/share/delete, and the public `/s/[id]` |
| `npm run test:throttle` | credit refunds under 25 concurrent requests |
| `npm run test:docs` | the API map in this file against the routes that actually exist |
| `npm run test:durability` | store writes: atomic replace, concurrent writers, recovery from a torn file |
| `npm run test:credits` | the credit ledger — what each feature costs, what a failure gives back |

`test:durability` and `test:credits` are deliberately outside the `npm test` chain: both take a
few minutes on their own, and CI runs them on every push anyway.  
