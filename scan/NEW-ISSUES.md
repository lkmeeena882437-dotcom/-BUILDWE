# Naye issues is deep pass me + pichhle review ki corrections

Ye file `docs/REVIEW_FULL_2026-08-31.md` ka **supplement** hai. Neeche jo hai wo us review me **nahi** tha (ya usme galat tha).

---

## PART A — Naye findings (is pass me mile)

### A1. 🟠 `qualityGate` code mode pe **kabhi lagta hi nahi** — orphaned import

`app/api/ai/code/route.ts:8` me `qualityGate` **import hota hai par use nahi hota** (eslint confirm: `'qualityGate' is defined but never used`). Chat route use karta hai (`chat/route.ts`, `quality: qualityGate({mode:"chat"})`).

**Matlab:** "answer-first / on-topic / format" quality checks sirf chat pe chalti hain. **Code mode — jo sabse zyada breakable hai — par koi quality gate nahi.** Feature adhoora wired hai, aur import ka exist karna ye bhram deta hai ki laga hua hai.

Fix: code route me `qualityGate({prompt, answer, mode:"code"})` call karo (`formatOk` check me `wantsCode` already code-aware hai) — **30 minute**.

### A2. 🟠 15 routes `rateLimit` import karte hain par use nahi karte

```
ai/agent  ai/audio  ai/chat  ai/code  ai/code-action  ai/compare
ai/file   ai/image  ai/verify ai/vision  auth/login  auth/register
v1/chat   ai/search(uses memory)   ...  → 15 unused `rateLimit` imports
```
Ye **migration ka residue** hai (memory → durable switch). 2 tarfa nuksaan:
1. Dead imports = reader ko lagta hai limit lagi hai.
2. `ai/auto`, `ai/search`, `metrics`, `projects/files` **abhi bhi `memory` limiter** use karte hain jabki baaki 14 `durable` pe migrate ho chuke — yani wahi 4 routes multi-instance pe bypassable. Inconsistency hi bug hai.

Fix: `withGuards({key, limit, window, quota})` helper — ek jagah limiter choose ho, koi route accidentally memory pe na rahe.

### A3. 🟠 `/api/ai/transcribe` — audio blob ka **koi size cap nahi**

`app/api/ai/transcribe/route.ts` check karta hai `file instanceof Blob && file.size === 0` — bas. **Maximum size kahi nahi.** Vision route 5 MB cap karta hai, transcribe **kuch nahi**. `lib/ai/stt.ts` poora Blob `fetch` body me daal deta hai (undici buffer karta hai).

→ Ek authenticated user 500 MB ka blob POST karke server memory uda sakta hai. Aur is route pe `checkLimit` bhi nahi (see A4), aur IP spoofable (review C3) → free.
Fix: `if (file.size > 25 * 1024 * 1024) return 413` — **15 minute**.

### A4. 🟠 Provider-calling routes par quota nahi — 5 routes, compare sabse bura

`checkLimit` sirf **7/40** routes me hai. Jin routes me **nahi** hai par wo upstream network kharch karte hain:

| Route | Per-request upstream cost | Quota? |
|---|---|---|
| `ai/compare` | **4 model calls** (3 forced seats + 1 synthesis) | ❌ sirf 10/min rate-limit |
| `ai/transcribe` | 1–2 provider calls + unlimited bytes | ❌ |
| `ai/verify` | **claim per 1 DDG search** (max 4 claims) | ❌ 15/min |
| `ai/search` | 1–2 DDG fetches | ❌ 30/min, memory-only limiter |
| `v1/chat` | 1 model call | ❌ (review H1) |
| `agent` | **1 unit, par ~48 model calls** (8 steps × 6 chain) | ⚠️ metered galat |

`ai/compare` specifically: ek request me 4 full completions, `max` 5 seats × `Promise.all` — free user `10/min × 60 = 600 compare runs/hour` bana sakta hai identity rotate karke (C3) = **~2,400 completions/hour, 0 quota units**. Review H1 se bhi bada hole, kyunki H1 1 call tha ye 4.

### A5. 🟠 User-facing text me **internal env var names leak** — gateway ke apne rule ke against

`lib/ai/stt.ts:136` ka fallback string:
> "…An administrator can enable it by adding a `DEEPGRAM_API_KEY` or `GROQ_API_KEY` to the server configuration…"

Ye `text` field me aata hai → `AudioStudio.tsx:115` `setSttError(res.text)` → line 340 pe **user ko dikh jaata hai**.

`lib/ai/gateway.ts` apni doc-comment me clearly kehta hai *"Never leaks provider names, URLs, key fragments"* — aur poora `toUserFacingError` isi liye bana tha. **STT is contract ko tor deta hai.** Koi bhi visitor ab jaan gaya ki ye deployment kaunsi env vars pe depend karti hai. Fix: vendor-neutral copy — **10 minute**.

### A6. 🟠 In-app pricing khud se contradict karti hai: **$5/mo vs ₹500/mo**

| Jagah | Kya dikhta hai |
|---|---|
| `app/page.tsx:3898` (workspace ka PlansSheet) | **`$5/mo`** |
| `app/layout.tsx:52` (metadata/SEO description) | **`PRO $5/mo`** |
| `app/pricing/page.tsx:110` | **`₹500 / month`** |
| `app/help/page.tsx:11` | **`PRO (₹500/mo)`** |
| JSON-LD structured data | `price:"500" priceCurrency:"INR"` |
| Actual Razorpay charge | `RAZORPAY_PRO_AMOUNT_PAISE=50000` = **₹500** |

Matlab user workspace me "**$5/mo**" dekh ke upgrade kholta hai, pricing page "**₹500/month**" kehti hai. `$5` ≈ ₹440 ≠ ₹500. Pichhle review me maine ise "three different prices" bola tha — **correction: do hi hain, par product ke andar side-by-side visible hain**, jo SEO/GSC "structured data mismatch" aur India me **consumer-price representation** ka legal issue dono hai. Fix: ek `PRICING` const, 1 ghanta.

### A7. 🟡 `/api/ai/models` ka `selectable[]` **sirf ImageStudio** use karta hai

Correction setup: API genuinely 46-entry catalog ko `available` flag ke saath expose karta hai (ye maine pichhli baar miss kiya tha). Lekin:
- `components/workspace/ImageStudio.tsx:132` → `data.selectable.image` ✅ **image model picker real hai**
- `app/page.tsx:722` → `setModelsCatalog(m.all)` ❌ — workspace **`PUBLIC_MODELS` marketing ladder** render karta hai, `selectable` ko kabhi padhta hi nahi

**Aur `PUBLIC_MODELS` me `coming_soon` placeholder rows hain** (`model-tiers.ts`: "GPT-class seat", "Claude-class seat", "BUILDWE Pro Reason", "BUILDWE Pro Code", "BUILDWE Vision Pro"). Ye **Settings/model UI me real seats ki tarah dikhte hain** par inke peeche koi model nahi. `liveModels()` filter karta hai, par `all: PUBLIC_MODELS` filter nahi karta — aur page `m.all` le raha hai. = **user-facing vaporware**.

### A8. 🟡 `AdSlot` — 3 chhoti par real galtiyan (`components/AdSlot.tsx`)

1. Line 39: `const ad = useMemo(() => …, [slot])` — `slot` **body me use hi nahi hota** → eslint `react-hooks/exhaustive-deps` error.
2. Line 40 comment: `// rotates hourly-ish` — code `Math.floor(Date.now()/60_000)` hai = **har minute** rotate. Aur `useMemo` mount ke baad recompute nahi karta, to **practically kabhi rotate nahi hota** (jitni der component zinda, same ad). Comment, code aur behaviour — teeno alag.
3. Line 45/59: `custom` variable me env padh liya, phir JSX me **dubara** `process.env.NEXT_PUBLIC_AD_HTML!` padha — non-null assertion se doosra read; agar ek render me value badal jaye (it can't, but the pattern is) → `undefined` innerHTML.
4. `href: "#byok"` ek fragment link hai — us id ka target existence check nahi hota.

### A9. 🟡 `lib/ai/model-tiers.ts` aur `lib/ai/models-catalog.ts` = **do independent model systems**

`model-tiers.ts` me hardcoded branded ladder (`bw-*`, 11 rows) hai, `models-catalog.ts` me real 46-entry catalog. Koi link nahi — `PUBLIC_MODELS` ke rows ka koi `catalogId` field nahi. Iska matlab **UI ka model naam se actual model ka koi mapping hi nahi**; `publicModelLabel()` string-matching se guess karta hai (`s.includes("code") → "BUILDWE Code"`). Naya model add karo to UI chup-chap "BUILDWE AI" label dega.

### A10. 🟡 Dead code / silent-failure inventory (objective)

| Metric | Count | Worst |
|---|---|---|
| `catch {}` / `catch { /* comment */ }` — **silently swallowed** | **36 blocks in 20 files** | `app/page.tsx` **9**, `lib/ai/providers.ts` 3, `ai/chat/route.ts` 3 |
| Unused imports (real, lint-confirmed) | **25** | 15× `rateLimit`, `qualityGate`, `applyFeedback`, `providerForModel`, `withRetry`, `errorFromStatus`, `APP` |
| Dead exports (defined, 0 importers) | — | `isComplexCodePrompt` (rules.ts) **0 refs** |
| Effectively-dead | — | `applyFeedback` (mind.ts) — import hota hai, **call nahi** → user feedback → model preference loop adhoora hai |
| Unused state | — | `ASPECTS` (page.tsx:253), `showVoices` (:488), `speakBrowser` (:1186), `history` (:1584) — 4 orphaned `useState`/consts in the monolith |

`app/page.tsx` me 9 silent-swallow + 4 unused state = **92 useState wale file me failures dikhayi nahi deti**. Ye monolith refactor ka sabse strong business case hai, size nahi.

### A11. 🟡 `no-unescaped-entities` ke 7 **actual errors** (build pass ho jaata hai, par lint gate hamesha fail hoga)

`app/acceptable-use/page.tsx:30,44` · `app/developers/page.tsx:180` (×4) · `app/security/page.tsx:45` — apostrophes/quotes JSX text me bina escape. CI add karte hi **pehla hi red build** in 3 files se aayega. Fix trivial (`&apos;`/`&ldquo;`), par isliye important hai kyunki H5 (CI) ka blocker yahi hai.

### A12. 🟢 Minor par note-worthy

- `components/SitePage.tsx` design tokens **hardcode** karta hai (`#F7F4EE`, `#14110F`, `#6B6560`) jabki poori app CSS vars (`--bg`, `--ink`, `--muted`) use karti hai — aur `#F7F4EE` ≠ manifest/theme ka `#F8F6F1`. **Do alag creams.** Public trust pages dark-mode/`prefers-color-scheme` ignore karti hain jabki layout uska support claim karta hai.
- `app/reset/page.tsx:3` — `useEffect` import unused → reset page ke kuch state-init logic ka adhoora hona.
- `app/print/page.tsx` me 1 silent catch.
- `robots.ts` / `sitemap.ts` theek; `/changelog` README me listed, file nahi (404) — **sitemap me bhi nahi hai, to Google ko wo internal link 404 milega**.
- `lib/ai/rules.ts` `SYSTEM_PROMPTS.chat` rule 7: *"Never mention model vendors, APIs, keys, demo, or offline mode"* — **A5 isi policy ka direct violation hai** (server prompt nahi, response copy hai, par impact same: user ko infra pata chal gaya).

---

### A13. 🔴 `/status` page sach me status **report hi nahi karta** — 7/9 rows kabhi badal nahi sakte

`app/status/page.tsx:38`:
```js
const up = (v?: string) => Boolean(v && !String(v).includes("offline") && !String(v).includes("fallback"));
```
Aur line 66: `{Object.entries(health.providers).map(([k, v]) => …)}` — yani **badge = static description string pe substring test**, kisi measured state pe nahi. Live `/api/health` ke against verify kiya:

| Rendered row | Badge | Reality |
|---|---|---|
| `configured` (**internal array**) | ● Live | user-facing row ke roop me `[]` dikh raha hai |
| `llm` "Chat & Code models" | ● Fallback active | ✅ **ek hi row jo actually state batata hai** |
| `image` "Image generation" | ● Live | **PERMANENT** — string me "offline"/"fallback" kabhi nahi aata, chaarne pe fal/HF/OpenAI sab mar jaayein |
| `audio` "Voice generation" | ● Fallback active | **PERMANENT FALSE** — string me word "fallback" literally maujood hai, server TTS perfectly chal raha ho tab bhi |
| `stt` | ● Live | raw key, `LABELS` me translation nahi |
| `webSearch` "Web search" (`"duckduckgo"`) | ● Live | **PERMANENT** |
| `devApi` "Developer API" (`"/api/v1/chat"`) | ● Live | **PERMANENT** — ye status hai hi nahi, ek path hai |
| `byok` "Key encryption" (`"aes-256-gcm"`) | ● Live | **PERMANENT** — ye bhi config hai, health nahi |
| `agent` | ● Live | raw key |

Plus: **`LABELS.vision` dead code hai** — `/api/health` `vision` key **return hi nahi karta**, to `LABELS` me `vision: "Image understanding"` likha hone ka matlab ye hai ki wo row **kabhi render nahi hota**. Health jo 2 cheezein genuinely return karta hai (`stt`, `agent`) unke labels missing hain, aur jo 1 cheez `LABELS` maangta hai (`vision`) wo health deta hi nahi — **do taraf se drift, koi type-level check nahi** (`providers: Record<string,string>` hone se TS kuch pakad nahi sakta).

**Net:** 9 rows me se **7 kabhi change nahi ho sakte**, 1 hamesha jhootha-red hai, aur sirf 1 real signal hai. Page ka lede: *"Live from the platform itself… Honest by design: we show degraded states, not just green"* — jo structurally possible nahi hai jaisa likha hai.

**Fix (40 min, exact):** `providers` ko map karo `Record<string, { ok: boolean; detail: string }>` me:
```ts
// health/route.ts
providers: {
  llm:       { ok: llmLive,                detail: llmLive ? `multi-provider (${live.join(", ")})` : "offline smart mode — no provider key configured" },
  image:     { ok: true,                   detail: "Pollinations live" + (imageLive.length ? ` + ${imageLive.join(", ")}` : "") },
  audio:     { ok: audioLive,              detail: … },   // ← actual provider result, string guess nahi
  stt:       { ok: sttLive,                detail: … },
  vision:    { ok: visionLive,             detail: … },
  webSearch: { ok: true,                   detail: "DuckDuckGo (keyless)" },
}
// status/page.tsx
const up = (v?: { ok: boolean }) => v?.ok === true;
```
Saath me: `providers.configured` array ko user-facing row se hatao (wo internal hai), aur `LABELS` ko `keyof typeof providers` type se bind karo taaki drift **compile-time pe** pakda jaaye — yahi wo jagah hai jahan TypeScript ka ek line ka fix hamesha ke liye is class ka bug khatam karta hai. `tsconfig` me `noUncheckedIndexedAccess` on karne se `LABELS[k]` khud error deta.

## PART B — Pichhle review me jo maine **overstated/wrong** bola tha (self-correction)

| Main bola tha | Reality | Status |
|---|---|---|
| "46-entry catalog UI tak kahin nahi jaata" | `/api/ai/models` `selectable[]` deta hai aur **ImageStudio use karta hai** | ❌ **main galat tha** — sirf chat/code picker missing hai (A7) |
| "`ai/search` query length cap nahi → DoS" | `lib/ai/search.ts:124` `query.trim().slice(0, 400)` — **cap hai** | ❌ **main galat tha** — remove kiya |
| "`/api/ai/generations` limit param bug" | `route.ts` me `Number(null)===0` trap **already handled** hai, comment ke saath | ✅ code sahi hai |
| "three different prices in one repo" | do prices hain ($5, ₹500), teen nahi; JSON-LD INR se match karta hai | ⚠️ exaggerated, A6 me corrected |
| "`docs/` claims `db 60%` — harsh" | meri live multi-process test (3 processes → 1 user gone) se **60% generous** nikla | ✅ stands |

**Kyun likh raha hoon:** ek audit ki value uski precision se aati hai. Maine review me 4 exploits live prove kiye the — par 3 claims galat nikle. Ye list bhi utnihi honest hai.

---

## PART C — Scan ka sabse actionable output

Ek table jo poori scan ka saar hai:

| # | Issue | Files | Effort | Severity |
|---|---|---|---|---|
| 1 | `catch {}` → `catch (e) { logOnce(e) }` for 36 blocks | 20 | 3 h | M |
| 2 | 15 unused `rateLimit` imports hatao + `withGuards()` helper | 16 | 4 h | M→H (A2 fixes memory/durable split) |
| 3 | `checkLimit` add: `compare`, `transcribe`, `verify`, `search`, `v1/chat`; agent = N units | 5 | 1 d | **H** |
| 4 | transcribe size cap 25 MB | 1 | 15 min | **H** |
| 5 | STT copy se env names hatao | 1 | 10 min | M |
| 6 | `qualityGate` code mode me lagao | 1 | 30 min | M |
| 7 | Single `PRICING` const ($5/₹500 contradiction) | 4 | 1 h | M |
| 8 | `PUBLIC_MODELS` ke `coming_soon` rows UI se hatao / `selectable` pe switch | 2 | 2 h | M |
| 9 | 7 unescaped-entity errors fix (CI blocker) | 3 | 20 min | L |
| 10 | zod schemas baaki 38 routes pe | 38 | 1 d | H |
| 11 | `isComplexCodePrompt`, `applyFeedback` wire-or-delete | 2 | 1 h | L |
| 12 | `SitePage` CSS vars pe lao + theme consistency | 1 | 1 h | L |
| 13 | **`/status` badge = static-string substring test** → `{ok,detail}` contract + `LABELS` type-bind + `configured` row hatao (A13) | 2 | 40 min | **H** (trust page jhooth bol raha hai) |
| 14 | `metrics` POST pe `kind` allowlist (unbounded key growth) | 1 | 10 min | M |
| 15 | `audio` `speed` clamp + `user/keys` pe format validation + `media.ts` upsert path pe user-id prefix | 3 | 2 h | M |

Items 3+4+6+8+13 milke **~2 din** me is scan ke saare HIGH close ho jaate hain — aur ye sab `docs/REVIEW_FULL_2026-08-31.md` ke P0 (XSS/PRO/IP/DB) se **independent** hain, dono parallel me chal sakte hain.


---

# Status update after Wave 0 (2026-08-31)

This file described the code **as found**. The items below are now fixed on
`arena/01a0568a-buildwe` with tests that fail against the pre-fix code (see
`docs/BUILD_PLAN.md` Wave 0 for the evidence). Everything not listed here is
still open exactly as written.

| Issue | State |
|---|---|
| **C1** free PRO via junk `checkout/verify` | **fixed** — demo mode off by default and impossible in production; verify requires a real signed order that Razorpay itself reports as paid, owned by the caller, redeemed at most once (CAS) |
| **C2** stored XSS on `/s/[id]` + attribute injection in the dashboard | **fixed at the renderer** — shared `lib/safe-md.ts` escapes quotes, allow-lists URL schemes and fence labels. `'unsafe-inline' 'unsafe-eval'` in the CSP is **still open** (nonce pass) |
| **C3** rate-limit bypass via `x-forwarded-for[0]` | **fixed** — `TRUST_PROXY_HOPS` decides whether the header is readable at all; signup/login also key on the email, every `ai:*` route keys on the session id |
| **C4** whole-JSON read-modify-write losing cross-process writes | **mitigated** — lock file + three-way merge on write, verified with two servers on one store; Postgres (W6.1) is still the real fix |
| **A3** `ai/transcribe` had no size cap | **fixed** — 25 MB ceiling, 413 with a stated reason |
| **A4** `ai/compare`: 4 calls/request with zero quota, retired `gemma2-9b-it` seat | **fixed** — charged per live lane against the chat allowance; seats env-configurable, retired model gone |
| **A5** `lib/ai/stt.ts` naming provider env vars to end users | **fixed** — copy says what is missing without naming credentials |
| **A6** three prices ($5 / ₹500 / 50000 paise) | **fixed** — `components/billing/useProPrice.ts` is the single source, read from the checkout config the order endpoint actually charges |
| **A13** `/status` badges derived from prose substrings | **fixed** — health now returns typed `{state, ok, detail, evidence}` rows; the page renders them with no local label table |
| 22 routes with an unused `rateLimit` import (A2) | **mostly closed** — 11 AI/auth routes rewritten onto `limitAi()`; the remaining imports are gone with them |
| `/api/metrics` public GET + arbitrary `kind` | **fixed** — ops token or admin session, kind allow-list |
| Reset/verify token replay, `SHOW_DEV_LINKS` unguarded | **fixed** — verify tokens are single-use, dev links are non-production only, forgot is throttled |
| 6-char minimum password | **fixed** — 8 on signup and reset (client copy still needs a pass) |
| 7 ESLint errors (`react/no-unescaped-entities`) | **fixed** — `eslint` reports 0 errors, 15 warnings |
| No LICENSE, dead deps `uuid`/`nanoid` | **fixed** — explicit rights file added (flip to MIT if you want it open), dead deps dropped |
| **C5–C7**, A1, A7–A12 and every HIGH in this file not named above | **still open** — scheduled in `docs/BUILD_PLAN.md` (A1 → W1.10, A7 → W3.3, A8 → Wave 9, A12 → design-system task) |

No behaviour in this repo was changed to a mock or a stub anywhere in Wave 0:
where a credential is missing the endpoints now fail **honestly** (503 with a
reason) instead of pretending.

## Status update after Wave 1 (2026-08-31)

| ID | Item | Status now |
|---|---|---|
| A2 | OAuth links accounts on an email the IdP did not verify | **fixed** — GitHub verified-primary only; `test:auth` proves an unverified `user.email` cannot reach an existing password account |
| A2b | No PKCE on the authorization-code flow | **fixed** — S256 + verifier cookie; the flow is now endpoint-overridable and tested against an IdP that enforces the RFC check |
| A14 | BYOK store accepted any ≥20-char string as an API key | **fixed** — provider-shaped prefixes, 422 with nothing saved, masked on read |
| A1 | CSP `'unsafe-inline'` / `'unsafe-eval'` | still open (Wave 8 nonce pass) |
| C4 | JSON-file store under concurrency | mitigated (lock + merge); real fix is W6.1 Postgres |
| — | `providers.ts` returned only the display label, so any second-pass call to a vendor was doomed | **fixed** — `modelId` added and used by the tool correction pass |
| — | `streamChatOrCode`'s `{done:true}` forwarded raw ended client-side "completion" before grading | **fixed** in the tool runner (frame normalisation + carry-over buffer) |
| A15 (new) | Server-side `fetch` without `cache` was cacheable — OAuth identity lookups and provider status polls could be served stale | **fixed** — gateway defaults to `no-store`; IdP profile/email/userinfo explicit. Proven by `npm run test:auth` (reverting the fix reproduces "stale identity served") |
