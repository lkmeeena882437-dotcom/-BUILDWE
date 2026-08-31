# Per-file findings — all 103 code files

**Legend:** ✅ clean · ⚠️ non-blocking issue · 🔴 blocking/serious · 📖 = file fully read · 🔍 = structural scan (metrics + lint + targeted greps), not line-by-line

Numbers in `[...]` = lines / silent-catch count / lint issues, from `METRICS.csv`.

---

## `app/api/ai/*` — 16 routes

| File | | Findings |
|---|---|---|
| `chat/route.ts` [381/3/1] | 📖🔴 | Compound rate-limit key `ai:chat:${userId}:${ip}` (line 32) → rotating **either** defeats it. 3 silent `catch{}`. Otherwise the best-built route in the repo (input cap, quota, BYOK, quality gate, SSE partial-save on abort). |
| `code/route.ts` [237/2/2] | 📖🔴 | **`qualityGate` imported (line 8) but never called** → code mode gets zero quality checks (scan A1). Same compound key (line 27). `buildProjectContext` wired ✅. |
| `compare/route.ts` [152/1/1] | 📖🔴 | **4 model calls per request, `checkLimit` = 0.** Hardcoded `SEATS` (line 18) includes `gemma2-9b-it` — a **retired Groq model**. `Promise.all` over 3 forced lanes = 4× amplification for 0 quota units (scan A4). Honest `live:false` handling ✅. |
| `transcribe/route.ts` [61/0/0] | 📖🔴 | **No size cap on the audio Blob** (only `size === 0`). No quota. → memory DoS (scan A3). `filename` flows unfiltered into the upstream multipart. |
| `agent/route.ts` [174/1/1] | 📖⚠️ | Quota: **1 code unit per run** while the loop makes up to 8 steps × 6-model chain → ~48 completions per unit. `projectId` not validated as owned (store is owner-scoped so not exploitable; the `createProject` fallback silently litters projects). Unused `rateLimit` import. |
| `image/route.ts` [151/1/1] | 📖✅ | Best guard coverage of the AI routes: prompt cap → **catalog-driven PRO gate** (not a hardcoded id) → quota → mirror to own storage → generation row. `fellBack` surfaced to user ✅. |
| `audio/route.ts` [114/1/1] | 📖⚠️ | Quota ✅, size cap ✅, persist ✅. But `voice` unvalidated and `speed = Number(body?.speed) \|\| 1` → `speed: 0` becomes 1, `speed: -5` is **accepted** (no clamp). |
| `vision/route.ts` [93/1/1] | 📖⚠️ | 5 MB cap ✅, data-URL MIME allowlist ✅. Quota uses `checkLimit(…,"image")` → **vision burns the image budget**, so OCR exhausts art generation. Two different costs, one counter. Unused `rateLimit` import. |
| `verify/route.ts` [138/0/1] | 📖⚠️ | 15/min limiter, **no quota** — each run is up to 4 DDG searches (one per claim). `text` capped 8000 ✅. |
| `file/route.ts` [194/0/1] | 🔍⚠️ | No request-size cap on the posted text. CSV rows capped at 2001 ✅ but `analyzeText` word-frequency runs over the **whole** string. No quota. Local-only (no provider cost) → lower severity. |
| `auto/route.ts` [37/0/0] | 📖⚠️ | **`memory` limiter, not `durable`** (line 19) while 14 routes moved → multi-instance bypass. Public (no session) — fine for a cheap endpoint. |
| `search/route.ts` [47/0/0] | 📖⚠️ | **`memory` limiter** + no quota. Query length **is** capped (`search.ts:124`, 400 chars) — good. |
| `models/route.ts` [67/0/0] | 📖✅ | Public discovery endpoint, clean; `selectable[].available` correctly reflects real reachability. |
| `generations/route.ts` [58/0/0] | 📖✅ | `Number(null)===0` trap handled with an explicit comment. Owner-scoped. |
| `feedback/route.ts` [58/0/1] | 📖⚠️ | **No rate limit at all.** `applyFeedback` imported, never called → the 👍/👎 loop hand-rolls `prefer:`/`avoid:` strings into `skills`, and `note` is **user text later concatenated into the system prompt** (self-only prompt-injection, unvalidated write path). |

## `app/api/auth/*` — 10 routes

| File | | Findings |
|---|---|---|
| `login/route.ts` [71/0/1] | 📖⚠️ | zod ✅, IP limiter ✅, timing-safe scrypt ✅, guest-migrate ✅. **No account lockout / per-account attempt budget** (20/min/IP is spoofable → C3). Unused `rateLimit` import. |
| `register/route.ts` [76/0/1] | 📖⚠️ | zod ✅ but `password: min(6)` — **6 chars, no breach-list check**. No per-IP account-creation cap beyond the spoofable limiter → unlimited throwaway accounts, each with a fresh 400-chat + 15-code daily allowance. Error mapping (line ~60) regex-matches on `e.message` strings — brittle. |
| `forgot/route.ts` [45/0/0] | 📖🔴 | **No rate limit.** `SHOW_DEV_LINKS` returns the reset link in the response body with **no `NODE_ENV` guard** (H9). Enumeration-safe shape ✅. |
| `reset/route.ts` [34/0/0] | 📖⚠️ | **No rate limit** on token consumption. `password.length < 6` duplicated here instead of shared with register → two policies that can drift (already differ: zod vs raw string). Token 24-byte ✅, sha256-stored ✅, single-use ✅, 1 h expiry ✅. |
| `verify/route.ts` [22/0/0] | 📖⚠️ | Stateless HMAC, 48 h ✅. **No single-use/`usedAt`** → the same verify link replays forever within 48 h (reset tokens do get `usedAt` — asymmetric). No rate limit. |
| `delete/route.ts` [46/0/0] | 📖🔴 | Password re-confirm for email users ✅. **OAuth users: only `confirm:"DELETE"`** (lines 24-31) — no password, no second factor → with same-origin XSS that's an irreversible account wipe. No rate limit, no undo window, no data export first. |
| `logout/route.ts` [11/0/0] | 🔍✅ | Cookie clear. No server-side revocation (30-day JWT stays valid) — acceptable but worth documenting. |
| `me/route.ts` [62/1/0] | 📖⚠️ | Returns usage + limits — perfect for gating the UI, but nothing uses it for that (see free-limit finding in review §6.7). 1 silent catch. |
| `oauth/[provider]/route.ts` [55/0/0] | 📖⚠️ | `state` random ✅, 10-min cookie ✅, `sameSite=lax` ✅. **No PKCE.** `secure` flag keyed only on `NODE_ENV==="production"` while `session.ts` uses a broader Vercel-aware check → inconsistent. |
| `oauth/[provider]/callback/route.ts` [148/0/0] | 📖🔴 | **Account-takeover path**: `email = primary?.email \|\| user.email` — the fallback is GitHub's **unverified** public email, then `findOrCreateOauthUser` links by email → attacker sets their public GitHub email to a victim's and gets the victim's account (H2). Provider failures all collapse to `?oauth=failed` — no diagnostics. |

## `app/api/*` — 14 more routes

| File | | Findings |
|---|---|---|
| `checkout/verify/route.ts` [84/1/0] | 📖🔴 | **The free-PRO entry point** (C1, live-exploited). No rate limit. No idempotency → repeat POST re-writes payment rows. `amount: 0` on the fallback row = **financial record with zero amount**. |
| `checkout/order/route.ts` [55/1/0] | 📖⚠️ | No rate limit → unlimited demo-order creation. `addPayment` in a swallow-catch → an order can exist with **no payment row**. |
| `checkout/webhook/route.ts` [149/0/0] | 📖✅ | **Best-written route in the repo**: raw-body HMAC before parse, timing-safe compare, idempotent, 500-for-retry, handles failed/cancelled. Genuinely production-grade. |
| `history/route.ts` [107/0/0] | 📖🔴 | **No rate limit, no size cap on `body.messages`** in `action:"append"` (count capped at 400, size not). DELETE hits the **cross-user share destruction** bug (`store.ts:684`). Both catch paths return `200` with empty data → **a storage outage looks like "you have no history"**, and the client then happily overwrites. Silent data-loss UX. |
| `projects/route.ts` [79/0/0] | 📖⚠️ | No rate limit. No cap on **projects per user** (only files-per-project is capped). |
| `projects/files/route.ts` [122/0/0] | 📖⚠️ | Path validation ✅✅ thorough; per-project caps ✅. **Uses the `memory` limiter while everything else moved to `durable`** (line 66) → unlimited writes on serverless. GET error returns `{files:[]}`, masking storage failure. |
| `teams/route.ts` [109/0/0] | 📖⚠️ | **Zero rate limit** on join/invite/leave → 32-bit invite codes brute-forceable (H11). `action:"assign"` lets any team member move another user's chat (H12). No team/member caps on free plan. |
| `user/keys/route.ts` [66/0/0] | 📖⚠️ | BYOK save: `length >= 20` is the **only** validation → any 20-char junk is encrypted and stored as a "key", then every provider call fails at request time with a generic error (not at save time). No format check, no live validation, no rate limit. |
| `user/skills/route.ts` [52/0/0] | 🔍⚠️ | Unrate-limited write; entries are later concatenated into the system prompt (same concern as feedback). |
| `dev/keys/route.ts` [60/0/0] | 📖⚠️ | Secret shown once ✅, hashed ✅, 10/user cap ✅. **No expiry, no scopes, no per-key quota** — which is exactly what makes H1 (unmetered public API) possible. No rate limit on creation. |
| `v1/chat/route.ts` [117/1/1] | 📖🔴 | **`checkLimit` 0, `recordUsage` 0** (H1, live-proven). Doesn't use `guardMessages`/`INPUT_LIMITS` — hand-caps `slice(0,8000)`/20 msgs, so its limits *differ* from the platform's (8k here vs 24k chat) for no stated reason. Buffered, no `max_tokens` control from caller. |
| `health/route.ts` [67/0/0] | 📖🔴 | `providers` has `stt` + `agent` but **no `vision`**, while `/status` renders a `vision` row → permanently-false red (see status page). Public + unauthenticated: leaks `demoMode` and `db` mode → **hands an attacker the reconnaissance for C1** ("payments are in demo mode") for free. |
| `metrics/route.ts` [27/0/0] | 📖⚠️ | GET **unauthenticated** (H10). POST accepts **arbitrary `kind`** → `bump(kind)` with any attacker string = unbounded key growth in the counters object + metric pollution. |
| `share/route.ts` [64/0/0] | 📖⚠️ | No rate limit on link creation. `bumpShareViews` writes the whole DB on **every public GET** of a share link → a bot hammering one share URL = a write per request (amplifies C4). Public GET correctly filters to user/assistant roles ✅. |
| `auth/*` catch-all note | — | **Only 2 of 10 auth routes use zod.** |

## `lib/ai/*` — 17 files

| File | | Findings |
|---|---|---|
| `providers.ts` [867/3/4] | 📖⚠️ | Logic sound. **4 unused imports** (`APP`, `providerForModel`, `withRetry`, `errorFromStatus`) → this file hand-rolls its own fallback instead of the gateway's retry helper. `generateAudioPlan` calls **only Pollinations** — the ElevenLabs/OpenAI TTS adapters (lines ~692-760) sit on a path it never reaches → **PRO audio silently = free audio**, while `.env.example`'s `AI_AUDIO_MODEL_PRO` promises otherwise. `TTS_VOICE_MAP` folds **16 UI voices onto 6 upstream timbres** ("aanya"/"kiara"/"ananya" are the same voice) → choice theatre. `speed` never clamped. |
| `provider-registry.ts` [438/0/0] | 📖⚠️ | 8 real adapters ✅, wire dispatch ✅. `providerForModel()` **falls back to `"groq"`** for unknown ids (line 199) → the exact wrong-vendor bug this file's own doc-comment says it fixed, still alive on the env-override path. `GOOGLE_API_KEY` read straight from `process.env` (line 121) instead of `AI_KEYS.google` — the one place `config.ts` is bypassed. |
| `gateway.ts` [286/0/0] | 📖✅ | Strongest file in the repo. Timeouts, non-retryable error classes, input clamps, sanitised mapping. No findings. |
| `models-catalog.ts` [888/0/0] | 📖🔴 | **46 entries / 17 provider tags**, of which **9 tags have no adapter in `SPECS`** → permanently unreachable. `cartesia` (~line 557) has **no key field in `AI_KEYS` at all** = a dead row the UI can show. Stale/retired ids: `qwen-2.5-coder-32b` (never a Groq id — and it's the `.env.example` **default**), `llama-3.1-70b-versatile`, `llama-3.1-405b-reasoning`, `gemma2-9b-it`, `gemini-1.5-pro`, `claude-3-opus-20240229`. **No test asserts a single id exists.** `estimateComplexity` drives `maxTokens` (1024/2048/4096) → word-count heuristics silently truncate long complex answers. |
| `image-providers.ts` [419/0/0] | 🔍⚠️ | 6 image providers with their own submit+poll loops and timeouts ✅ — but a **dispatch path entirely separate from `provider-registry`** → two sources of truth for "what's available", which is why `/api/health` has to hand-merge `[...imageLive, ...keyless]`. |
| `stt.ts` [141/0/0] | 📖🔴 | **User-facing fallback text contains `DEEPGRAM_API_KEY` / `GROQ_API_KEY`** (line 136) → violates gateway §9.4 (A5), and reaches the screen via `AudioStudio.tsx:115→340`. Both adapters `return null` on `!res.ok` → a **401 (bad key) is indistinguishable from "no key configured"**, for the user and for ops. |
| `search.ts` [227/0/0] | 📖⚠️ | Query cap 400 ✅, max 8 ✅, status/reason taxonomy ✅ (genuinely good honest-failure design). But **HTML scraped via regex** (`result__a`/`result__snippet`) → breaks silently on DDG markup change; hardcoded Chrome UA = bot-evasion (ToS exposure); no robots.txt respect. Untrusted-marking ✅. |
| `agent.ts` [626/0/0] | 📖⚠️ | Budgeted on 5 axes ✅, tools owner-scoped ✅, premature-finish refusal ✅ — good design. But `run_check` is **static only** while the stream emits `{type:"done", verified:true}` and the UI shows a **"verified" banner** → label overclaims. `maxFileChars: 60_000` vs `store.MAX_FILE_CHARS: 120_000` — two limits, different numbers, silently disagreeing. |
| `offline-brain.ts` [706/0/0] | 🔍⚠️ | Genuinely impressive key-free fallback. But its generated starter HTML **uses `innerHTML =` with mapped user data** (lines 330, 438, 515, 546) — handed to users as example code by a product whose own `code-action` prompt says *"fix security holes like innerHTML with user input"*. Low severity, real credibility hit. |
| `mind.ts` [206/0/0] | 📖⚠️ | `applyFeedback` **exported + imported + never called** → dead function, loop hand-rolled at the call site. `uniq(max=8)` silently truncates a user's own skills. Language/style detection is regex-only (fine for zero-cost). |
| `understanding.ts` [178/0/0] | 🔍⚠️ | Has its **own `detectIntent`** — a second intent classifier alongside `router.ts`'s `routeIntent`, first-match style, i.e. exactly the design `router.ts`'s doc-comment says it replaced. They can disagree, and `chat/route.ts` calls **both** in one request. |
| `router.ts` [181/0/0] | 📖✅ | Scoring + disambiguation + explainable `reasons`/`confidence`. No findings. |
| `quality.ts` [88/0/0] | 📖✅ | Honest labels, no fake confidence. `onTopic` (≥2 overlapping content words) is weak but harmless. |
| `rules.ts` [88/1/0] | 📖⚠️ | `isComplexCodePrompt` — **dead export, 0 importers**. `publicModelLabel` collapses all vendors to 4 branded strings by substring match → user **cannot tell which model answered** even though the API returns it. SYSTEM_PROMPT rule 7 ("never mention vendors/keys/demo") is contradicted by `stt.ts`. |
| `model-tiers.ts` [132/0/0] | 📖⚠️ | `PUBLIC_MODELS` carries **6 `coming_soon` placeholder rows** ("GPT-class seat", "Claude-class seat", "BUILDWE Pro Reason"…) with **no link to `MODEL_CATALOG`** (no `catalogId`). `liveModels()` filters them; `models/route.ts` returns `all: PUBLIC_MODELS` **unfiltered**; `app/page.tsx:722` consumes `m.all` → placeholders reach the UI (A7). |
| `limits.ts` [97/0/0] | 📖⚠️ | Free-daily / PRO-monthly split ✅ (the monthly fix is real). But `CHAT_DAILY = {free:400, pro:2000}` is **hardcoded in the module** while every other limit is env-tunable. `getMonthlyUsage` = O(rows) scan of `usage` per request, on the JSON store. |

## `lib/*` — 12 files

| File | | Findings |
|---|---|---|
| `db/store.ts` [1371/1/0] | 📖🔴 | **Root cause of the durability class.** `deleteConversation:684` = cross-user share destruction (live-proven). No write lock (multi-process loss proven: 3 procs → 1 user gone). `read()` full-file parse on **every call in every request path**. Retention caps per-owner ✅ (correctly fixed). Password/OAuth/reset logic ✅ solid. 1371 lines for what should be 11 small repositories. |
| `db/remote.ts` [73/0/0] | 📖🔴 | Whole DB in one jsonb, `pushRemoteDb` last-write-wins, **no CAS/etag/transaction**, 1500 ms debounce (write lost if the instance dies inside it), `pullRemoteDb` once at boot. **Both pull and push swallow every error to `null`/`false`** → a totally broken mirror still reports success and `/health` still says `db: "supabase"`. |
| `auth/session.ts` [227/0/0] | 📖✅ | Prod secret guard ✅ (live-verified), plan always from DB ✅, httpOnly/lax ✅. Two nits: `cookieSecure()`'s 3-term Vercel check vs the OAuth route's `NODE_ENV`-only check (inconsistent → insecure cookie on a non-Vercel prod); 30-day JWT with **no rotation or revocation**. |
| `auth/guest.ts` [72/0/0] | 📖✅ | HMAC-signed ids, timing-safe, legacy opt-in documented. Good. |
| `crypto.ts` [100/0/0] | 📖⚠️ | AES-256-GCM + prod guard ✅. API keys hashed with **unsalted single-round SHA-256** (no pepper) — impractical to brute at 160 bits, but peppered HMAC is the correct construction. `verifyVerifyToken` splits on `"."` without `lastIndexOf` (fine for current ids; fragile). |
| `config.ts` [97/0/0] | 📖🔴 | `demoMode` default `"true"` (C1). `AI_KEYS.replicate` exists with **zero catalog models**; no `cartesia` key despite a `cartesia` provider tag. `hasProviderKey` uses a **string blacklist** (`"your_"`, one specific placeholder) for "is this a real key". No env schema → a typo'd var name silently means a dead feature. |
| `client/api.ts` [752/2/0] | 🔍⚠️ | 752 lines of hand-rolled wrappers, **no shared error type**, and the `data:`-line SSE loop is duplicated here 3× **plus** server-side in `compare`/`code-action`/`v1` = **4 copies of the same parser**. `streamAI` has no timeout and no retry. |
| `metrics/metrics.ts` [56/0/0] | 📖⚠️ | In-memory, resets on restart — honestly documented ✅. `ttftSamples` capped 200 ✅. Counter **keys are unbounded** (see metrics route). |
| `payments/razorpay.ts` [130/0/0] | 📖🔴 | Live HMAC path correct ✅. **Demo path = free PRO** (C1). `expected !== payload.razorpay_signature` is a **non-constant-time compare**, while the webhook uses `timingSafeEqualHex` — same product, two standards. `getCheckoutPublicConfig()` exposes `demoMode` to the browser, so the client knows it's in the exploitable state. No subscription/renewal path at all. |
| `rate-limit/memory.ts` [30/0/0] | 📖🔴 | `clientIp()` trusts `X-Forwarded-For` unconditionally (line 27) → **all 18 limiter call sites bypassable** (live-proven, C3). **No pruning of expired buckets** → the `Map` grows forever on a long-lived server. |
| `rate-limit/durable.ts` [97/0/0] | 📖✅ | Atomic RPC, 2 s ceiling, fail-open to local, well-argued. Only gap: the fail-open isn't surfaced to operators in-band (mitigated ✅ because `/health` reports `rateLimits: "per-instance"`). |
| `storage/media.ts` [126/0/0] | 📖⚠️ | Size cap, path sanitize, non-fatal by design ✅. Gaps: `replace(/\.\./g,"")` runs **before** the char filter (order-dependent sanitizer); **`x-upsert: true` on a user-influenced path** lets anyone overwrite an object whose key they can guess (`uid()` = 48 bits — thin for a public bucket); `mirrorRemoteImage` fetches provider URLs with no host allowlist (safe today only because the URL isn't user-supplied). |

## `app/` pages, `components/` — 23 files

| File | | Findings |
|---|---|---|
| `app/page.tsx` [3934/9/5] | 📖🔴 | **3,934 lines; `Dashboard()` = lines 440→3757, one 3,317-line component; 92 `useState`; 9 silent `catch{}`; 4 unused state vars** (`ASPECTS`, `showVoices`, `speakBrowser`, `history`). Consumes `m.all` (marketing ladder with `coming_soon` fakes) instead of `selectable`. Its own `md()` (line 286) is **safe** — the good half of the split-markdown problem. `<iframe sandbox="allow-scripts" srcDoc>` ✅ correct isolation. `PlansSheet` says **$5/mo** (line 3898) vs `/pricing`'s ₹500 (A6). |
| `app/layout.tsx` [105/0/1] | 📖⚠️ | `maximumScale: 1` (WCAG 1.4.4 fail) · raw `<link>` Google Fonts → `@next/next/no-page-custom-font` **error** + render-blocking (should be `next/font`) · `suppressHydrationWarning` on `<html>` masks the theme flash instead of fixing it · metadata description says `$5/mo`. |
| `app/s/[id]/page.tsx` [183/0/0] | 📖🔴 | **Stored XSS** (C2): `esc()` misses quotes (line 29) + raw `$2` interpolated into `href="…"` (line 41). Unused `Bot` import. `views` increments on every public GET (bots inflate it; each one is also a full DB write). |
| `app/status/page.tsx` [92/0/0] | 📖🔴 | **The "Honest by design" status page cannot report honesty.** It renders `Object.entries(health.providers)` and derives each ● Live / ● Fallback badge from `up(v) = !String(v).includes("offline") && !String(v).includes("fallback")` (line 38) — i.e. a **substring test on a static human-readable description**, not on any measured state. Verified against live `/api/health`: of the **9 rows rendered, 7 can never change** (`image`, `webSearch`, `devApi`, `byok`, `stt`, `agent`, `configured` → permanently "● Live"); `audio` is **permanently "Fallback active"** because its config string literally contains the word "fallback", even when server TTS is working; only `llm` is state-dependent. Worse: the internal `providers.configured` **array** (`[]` on this deploy) renders as a user-facing row labelled "configured", `stt`/`agent` render with **raw untranslated keys** because `LABELS` lacks them, and `LABELS.vision` is **dead code** (health never returns `vision`). Fix = make health return `{ok:boolean, detail:string}` per service and have the page read `ok`. |
| `app/acceptable-use/page.tsx` [53/0/2] | 🔍🔴 | 2 **lint errors** (`no-unescaped-entities`, :30 and :44) → first red CI build. |
| `app/security/page.tsx` [66/0/1] | 🔍⚠️ | 1 lint error (:45). Content-wise: a "Security" page that never mentions that billing self-upgrades in demo mode, or that `/api/health` and `/api/metrics` are public. Trust-page ↔ reality gap. |
| `app/developers/page.tsx` [199/0/4] | 🔍🔴 | **4 lint errors** on :180. Documents the public API but not the 30/min key+IP limit, and not that there is no quota (A4/H1 — the thing a developer most needs to know). Heaviest static page in the app: 3.65 kB / **99.7 kB** first-load. |
| `app/pricing/page.tsx` [192/0/0] | 🔍⚠️ | `₹500 / month` (line 110) vs `$5/mo` elsewhere. No refund/terms link adjacent to the CTA. |
| `app/reset/page.tsx` [107/0/1] | 🔍⚠️ | Unused `useEffect` import (:3) → token-from-URL init looks abandoned/incomplete. |
| `app/print/page.tsx` [69/1/0] | 🔍⚠️ | 1 silent catch; page is **statically prerendered**, so it can't actually print a live chat — verify it isn't dead weight. |
| `about`, `contact`, `help`, `how-it-works`, `privacy`, `terms`, `verify` [36-162/0/0] | 🔍✅ | Mostly clean (194 B pages via `SitePage`). Two content risks: `privacy` doesn't disclose that generated images are hosted by **third-party Pollinations** (a data-processor relationship); `terms` states a **USD $50** liability cap against ₹500 INR pricing. |
| `app/manifest.ts` [27/0/0] | 📖✅ | Correct. `theme_color #C45C26` matches the accent ✅, but `background_color #F8F6F1` ≠ `SitePage`'s `#F7F4EE` — **two different creams** in the product identity. |
| `app/robots.ts`, `app/sitemap.ts` | 🔍⚠️ | Fine, except: `/changelog` is advertised in README but **doesn't exist**, and isn't in the sitemap → guaranteed internal 404. |
| `components/AdSlot.tsx` [113/0/1] | 📖⚠️ | 4 issues (A8): `useMemo` dep `'slot'` unused → **lint error**; comment says "rotates hourly-ish", code is `Date.now()/60_000` = **per-minute**, and `useMemo` never recomputes → **never rotates**; env read twice (`custom` then `process.env.NEXT_PUBLIC_AD_HTML!`); `href="#byok"` target unverified; the `plan==="pro"` ad gate is **client-side only**. |
| `components/SitePage.tsx` [71/0/0] | 📖⚠️ | **12 hardcoded hex values** (`#F7F4EE`, `#14110F`, `#6B6560`, `#E6E0D6`, `#FBFAF7`) instead of the app's CSS vars → **10 of 16 public pages ignore dark mode** while `layout` advertises a dark `themeColor`. |
| `components/CookieConsent.tsx` [61/2/0] | 📖⚠️ | Copy asserts "no third-party ad trackers" while `NEXT_PUBLIC_AD_HTML` exists **specifically to embed an ad network** → the consent statement becomes false the moment that var is set. Dismiss-only, no reject path. |
| `components/PwaRegister.tsx` [20/0/0] | 📖✅ | Clean; registration best-effort with a catch. |
| `components/billing/UpgradeButton.tsx` [154/0/0] | 📖⚠️ | On `demo:true` it **skips Razorpay and POSTs synthetic ids to `/api/checkout/verify`** (lines 41-52) — i.e. this is the *UI* of the C1 hole, so an ordinary user clicking "Upgrade" gets PRO and is never told it was a demo. `setTimeout(() => router.push("/"), 900)` not cleaned on unmount. |
| `components/workspace/ImageStudio.tsx` [466/1/0] | 📖⚠️ | **Only** consumer of `selectable` ✅ (so image picker is real — correcting my earlier claim). Progress bar is a **fake `setInterval`** (line 113) driving a `role="progressbar"` + `aria-valuenow` → an accessibility lie, not just a cosmetic fudge. Falls back to `FALLBACK_MODELS` when `/api/ai/models` fails → can offer models this deployment can't reach. |
| `components/workspace/AudioStudio.tsx` [572/0/0] | 📖⚠️ | Best-a11y studio (`role="status"`/`"alert"` + `aria-live` ✅✅). Renders `sttError = res.text` straight from the API → this is where the **`DEEPGRAM_API_KEY`/`GROQ_API_KEY` leak becomes visible** (A5). `setText(…).slice(0,5000)` truncates silently mid-sentence. Mic error handling present ✅. |

## Config / infra — 8 files

| File | | Findings |
|---|---|---|
| `next.config.js` [40/0/0] | 📖🔴 | CSP `script-src 'unsafe-inline' 'unsafe-eval'` → **the /s/[id] XSS needs no CSP bypass at all**; `connect-src 'self' https:` → exfil to any host allowed. `images.remotePatterns: hostname "**"` **and `next/image` is imported 0 times** → both dangerously wide and dead config. No `report-uri` → CSP violations invisible. `X-Frame-Options SAMEORIGIN` + `frame-ancestors 'self'` ✅. |
| `package.json` [30/0/0] | 📖🔴 | **No `test` script.** `lint` **hangs** (no config). `uuid` unused, `nanoid` unused, `@types/uuid` unused+redundant. `zod` used in 2/40 routes. `next ^14.2.35` carries **GHSA-955p (HIGH)**. No `engines`, no `packageManager` pin → non-reproducible installs. |
| `tsconfig.json` [20/0/0] | 📖✅ | `strict: true` ✅. Would genuinely pay off here: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns` are all off — and `store.ts` (`db.conversations[i]`, `rows[0]`) is exactly the code that needs them. |
| `tailwind.config.js` [60/0/0] | 📖⚠️ | **`theme.extend.colors` is 100% unused** — `cream-*`, `ink`, `accent-*`: **0 occurrences** in the codebase. `darkMode: "class"` is set and `.dark` **does** work (via `globals.css`, so the toggle is fine) but `dark:` variants: **0 uses** → vestigial config. Net: 3 parallel design systems — Tailwind tokens (dead) / 53 CSS vars (real) / **~160 hardcoded hexes across tsx** (29× `#C45C26`, 28× `#14110F`, 19× `#6B6560`, 18× `#1C1C1C`, and `#14110F` vs `#1C1C1C` are two different inks). |
| `postcss.config.js` [7/0/0] | ✅ | Trivial, correct. |
| `public/sw.js` [50/0/0] | 📖⚠️ | API + cross-origin passthrough ✅ (correct call). Caches `/` — dynamic, auth-bearing HTML — network-first; `skipWaiting()` + `clients.claim()` can swap the shell mid-request; `CACHE` name never bumped on deploy; **no offline affordance in the UI** despite the "PWA installable" claim. |
| `supabase/schema.sql` [153/0/0] | 📖🔴 | **Only 2 tables** + a media bucket. The "11 collections" exist **only as a TS type**. Genuinely good parts: the rate-limit RPC is atomic (`ON CONFLICT … RETURNING`), RLS deny-all policies are correct, script is idempotent. But `buildwe_kv` is why "durable database" is a misnomer; no `users` table, no indexes on real data, no optimistic-lock column usage. |
| `.env.example` [175/0/0] | 📖⚠️ | Actually better than most repos': every var explained. Gaps: `NEXT_PUBLIC_DEMO_MODE=true` ships C1 as the default; `AI_CODE_MODEL=qwen-2.5-coder-32b` is an id that doesn't exist at Groq; `REPLICATE_API_TOKEN` documented for a provider with **no models**; `BUILDWE_DATA_DIR` (used at `store.ts:188`) is **undocumented**; SESSION_SECRET's prod-required note is buried at line ~110 instead of the top. |
| `.gitignore` [36/0/0] | ✅ | Adequate. (Minor: Next recommends committing `next-env.d.ts`; it's ignored.) |

## `docs/` — 14 files

Full claim-by-claim audit is in `docs/REVIEW_FULL_2026-08-31.md` §7. Short form:

`PLATFORM_STATUS.md` [319] 🔴 stale + wrong: "38/38 tests" that don't exist, 3 already-fixed items still listed as open, **all 4 criticals omitted** · `UPDATE_TRACKER.md` [392] 🔴 same unverifiable numbers · `SETUP_GUIDE.md` [247] ⚠️ repeats "38/38" · `AUDIT_UPDATE1.md` [265] ⚠️ good reasoning, stale state · `REMAINING_WORK.md` [152] ⚠️ partly done since written · `COMPETITOR_GAP_ANALYSIS.md` [136] ⚠️ competitor facts need a date · `STATUS_REVIEW.md` [93] ⚠️ superseded · `AI_BACKEND.md` [138] ⚠️ says Groq-only for chat (now 8 vendors) · `ROADMAP.md` [143] ⚠️ no dates/owners · `USER_EXPERIENCE_AUDIT.md` [296] ✅ most accurate doc in the folder · `ENV_VARIABLES.md` [175] ✅ · `PROJECT_BRAIN.md` [117] ✅ · `KEYS_SETUP.md` [34] ✅ · `README.md` [112] 🔴 advertises `/changelog` (404) and mixes $5/₹500.

---

## Coverage honesty

- 📖 **fully read**: ~60 files — every one of the 40 API routes, all 16 `lib/ai` files (some in sections), `lib/db/*`, `lib/auth/*`, `lib/crypto.ts`, `lib/config.ts`, `lib/payments/*`, `lib/rate-limit/*`, `lib/storage/*`, `layout.tsx`, `page.tsx` (structurally + key regions), both studios, `AdSlot`, `SitePage`, `UpgradeButton`, `sw.js`, `next.config.js`, `schema.sql`, `.env.example`.
- 🔍 **structural only** (metrics + lint + targeted greps, not line-by-line): the ~14 static content pages, `offline-brain.ts`, `image-providers.ts`, `client/api.ts`, `understanding.ts`, `search.ts` tail, `robots/sitemap/manifest`, `globals.css`, `postcss/tailwind` bodies.
- **Not testable from this sandbox:** every provider's real behaviour (all outbound TLS blocked). The model-id staleness finding is therefore argued from id→vendor mapping, not from a live 404 — `GET https://api.groq.com/openai/v1/models` diffed against `MODEL_CATALOG` closes that in 10 minutes and belongs in CI.
