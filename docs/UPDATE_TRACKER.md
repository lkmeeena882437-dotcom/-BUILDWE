# BUILDWE — Update Tracker (internal, not public)

Boss bhejte hue updates yahan track hote hain. Public changelog page hata diya gaya hai (v1.4.1).

## Status board

| Update | Source | Status |
|---|---|---|
| Update #1 — Product Audit & AI Intelligence Roadmap | boss (chat paste) | ✅ Implemented (v1.5.0) — P0 complete, P1 partial (see below) |
| Update #2 — Next Big Update (latency/cost/security/fallback/verification/errors + smart-execution rules) | boss (chat paste) | ✅ Implemented (v1.6.0) — see below |
| Update #2 re-check pass | boss ("recheck karo, kuch adhura to nahi") | ✅ v1.6.1 — 4 gaps mile aur fix hue (niche) |
| Code Canvas actions + status review + main push | boss ("ha kr bhai… pahle status review do, phir main me push") | ✅ v1.7.0 — Run/Test/Fix/Optimize/Refactor + docs/STATUS_REVIEW.md |
| Update #3 — Product/UX/Brand/Trust plan | boss (chat paste) | ✅ Implemented earlier (v1.4.0) |
| **Full Platform Audit & Completion** | boss (PDF → pasted) | ✅ **v1.8.0** — 6 confirmed vulns fixed + router/gateway/agent foundations (`docs/AUDIT_UPDATE1.md`) |
| **Real-user experience audit** | boss ("ek AI user ki tarah review karo, jo galat hai khojo, phir sab complete karo") | ✅ **v1.9.0** — F1–F7 sab fix (`docs/USER_EXPERIENCE_AUDIT.md`) |

## Update #2 — kya implement hua (v1.6.0)

Boss ne "mix" scope chuna (Update #2 + Update #1 ke pending P1: multi-model compare + convert-to-deliverable) + manual "Use another model" button errors par visible.

### P0
- **Latency & budgets** (`lib/ai/providers.ts`): complexity-based compute — simple 1024 / medium 2048 / complex 4096 max_tokens; temp code 0.45 / chat 0.7; budget sab stream fns me threaded
- **Long-context**: >18 turns → last 14 + purani user asks ka ek compressed background line (blind full-history nahi)
- **Security headers** (`next.config.js`): CSP-lite (script/style/img/connect/frame directives, Razorpay allowlist), X-Frame-Options SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy
- **Provider fallback + transparency**: har stage par `fallbackNote` (openrouter backup / groq one-piece / offline key-hint) → SSE meta → UI me amber "Model switched" banner
- **Manual model switch**: errors par recovery panel — **Try Again** + **Use another model** (`altModel` 1–3 → `preferOffset`, user choice visible per boss decision)
- **Error handling**: errors ab `code` + `hint` carry karte hain (RATE_LIMIT pehle) → UI me useful explanation + tip
- **Verification reliability**: verify route ab **primary/official sources ko preference** deta hai (docs/developer/gov/edu/claim-keyword hosts score) + `official` flag; compare UI me "agreement is not proof" note
- **Prompt-injection**: search context pehle se UNTRUSTED-marked tha (v1.4) — confirmed intact

### P1
- **Surgical editing**: "make only section 2 shorter" regex-detect → system hint (purana answer reproduce, sirf named part change)
- **Correction loop**: "no that's not what I meant" detect → one-line wrong-assumption naming + corrected answer, restart nahi
- **Multi-model comparison**: composer me Layers button → modal → 3 seats (llama-3.3-70b reasoning / 3.1-8b speed / gemma2-9b writing) + judge synthesis (agreement ≠ truth honesty) → `POST /api/ai/compare` (10/min, offline par honest unavailable)
- **Convert-to-deliverable**: quick actions **Document / Table / Report** — answer ko structured deliverable me convert + existing Save/Download
- **Version history**: code canvas V1/V2/V3 + Restore pehle se tha (v1.3) — intact
- **Citation UX**: sources chips pehle se the; verify me official-source badge add hua

### P2
- **Honest limits**: prompt rule 13 — kabhi bluff nahi, alternative offer
- **Formatting discipline**: rule 14 — formatting comprehension ke liye, decoration ke liye nahi
- **Streaming UX / a11y**: Understanding…→Writing… phases existing; reduced-motion + aria-labels existing — verified intact

### Anti-bloat
Koi naya mode/nav item nahi — sab intelligence existing UI ke andar (composer button, quick actions, banners). "Keep the interface simple; intelligence behind the interface."

## Update #2 re-check pass — v1.6.1 (boss ne bolle "recheck karo")

**Re-check result**: teeno updates (v1.4.0 / v1.5.0 / v1.6.0) code me verify kiye — key encryption (AES-256-GCM) pehle se tha ✓, prompt-injection guard ✓, version history ✓, a11y/reduced-motion ✓, ads ✓. 4 gaps mile, sab fix:

- ✅ **Duplicate-work prevention** (P1 miss tha): same conversation me user ka repeated ask (exact ya ≥85% word-overlap) → system hint "point to earlier answer, only what's new — don't redo"
- ✅ **Plan-first for complex** (smart-execution rule): complex tasks → "2–3 line plan, then execute step by step" hint
- ✅ **FILE_TOO_LARGE recovery**: vision 413 → code + hint ("reduce under 5 MB…"); client text-file attach cap 200 KB friendly error ke saath
- ✅ **Internal metrics** (boss ki metrics list ka lightweight version): lib/metrics + GET/POST /api/metrics — chat sends/done/errors, fallback rate, corrections, surgical edits, regenerations, recovery actions (try-again vs use-another-model), avg time-to-first-token (client-beaconed), completion rate. Zero PII, robots-disallowed, UI me link nahi (anti-bloat). Note: in-memory — server restart pe reset (honest, no fake history)
- ✅ Recovery semantics fix: **Try Again = same model**, **Use another model = next model** (pehle dono shift kar rahe the)

**Deliberately pending (boss ko bataya)**: code canvas Run/Test/Fix/Optimize/Refactor actions (Update #1 P1 #8), PDF/DOCX/XLSX file intelligence (#7), real-device mobile QA, persistent metrics storage.

## v1.7.0 — Code Canvas Actions + Status Review (boss ka green signal)

- ✅ **Run ▶** — HTML → live preview switch; JS → sandboxed Web Worker (console capture, 3s timeout, no DOM/network, user code KABHI server pe nahi chalta); other langs → honest note + Save
- ✅ **Test ✓** — AI runnable tests banata hai (console.assert style, no frameworks); JS me tests+code sandbox me chal ke PASS/FAIL output panel me
- ✅ **Fix 🔧 / Optimize ⚡ / Refactor ♻** — `/api/ai/code-action` (rate limit 20/min, plan limits, BYOK priority); naya code canvas me set + **version history me auto-save** (purana wapas mil sakta hai); kya badla wo Hinglish notes me
- ✅ Canvas console panel (Output/Tests/Info/Note) with close button
- ✅ Offline honest: bina live model ke action bolta hai "key add karo" — fake fix kabhi nahi
- ✅ `docs/STATUS_REVIEW.md` — boss ke liye complete website review (kya bana, kaise kaam karta hai)
- 🔁 Update #1 ka P1 #8 ab COMPLETE — bacha sirf: PDF/DOCX/XLSX (#7), real-device mobile QA, persistent metrics

**Update #1 P1 list final status**: multi-model compare ✅ (v1.6.0) · consensus/judge ✅ (v1.6.0) · convert-to-deliverable ✅ (v1.6.0) · canvas actions ✅ (v1.7.0) · file intelligence PDF/DOCX ⏳

## Update #1 — kya implement hua (v1.5.0)

### P0 (all done)
- **Prompt Understanding Layer** (`lib/ai/understanding.ts`): intent · subject · platform · style · language · expected output · material-missing detection → system hint + "Understood:" UI chip
- **Smart Clarification**: ONE question only when gap is material; minor details → sensible defaults (listed in UI chip)
- **Context**: conversation memory (mind.ts, existing) + understanding injected per-turn
- **Smart routing + transparency**: existing auto routing; model tag shown; auto length by complexity (simple → short, complex → structured)
- **Response Quality Gate** (`lib/ai/quality.ts`): on-topic / format / length checks → "✓ Checked" ya "⚠ Review" badge + honest notes (no fake %)
- **Accuracy & Verification Layer**: 🛡️ Verify action per answer → `POST /api/ai/verify` extracts claims (stats/dates/prices/superlatives) → live-source match → Verified / Uncertain labels + source links
- **Answer-first output**: prompt rule 11 (v1.4.0) + auto-depth hints (new)
- **Response length controls**: Short/Balanced/Detailed/Deep + auto (new) — Simple/Standard/Expert (v1.4.0)
- **Readability**: prompt rules + structured hints
- **Quick actions**: Simplify · Shorten · Expand · Explain · **Example (new)** · **Verify (new)** · **Use-as-prompt (new)** · Save · Copy · Regenerate

### P1 (partial — baaki Update #2 me karunga jab boss bhejega/bole)
- ✅ Model transparency (tag + understood chip)
- ✅ Suggested prompts per mode (existing)
- ✅ Multi-model comparison (5.1) — done in v1.6.0 (3 seats + judge synthesis)
- ✅ Consensus/Judge system (5.2) — done in v1.6.0 (compare synthesis)
- ✅ Convert-to-deliverable (6) — done in v1.6.0 (Document/Table/Report quick actions)
- ⏳ Advanced Code Canvas actions Run/Test/Fix/Optimize/Refactor (8)
- ⏳ File intelligence PDF/DOCX/XLSX (7) — CSV/TXT/images done

### P2/P3 (future, per plan): GitHub integration, one-click deploy, agents, browser agent, video workflow

## Ops notes
- `/changelog` public page REMOVED (404) — links + sitemap se bhi hataya. Internal history `docs/COMPETITOR_GAP_ANALYSIS.md` me.


## v1.8.0 — Full Platform Audit & Completion (boss Update #1 PDF)

Poora audit `docs/AUDIT_UPDATE1.md` me hai — har PDF point numbered, aur har
fix ka **live test log** (before/after) diya hai. Yahan sirf summary.

### 6 confirmed vulnerabilities (guess nahi — live reproduce karke fix)

| # | Kya tha | Severity |
|---|---|---|
| V1 | Guest cookie plaintext thi → `Cookie: bw_guest=<victim>` se doosre guest ka poora data mil jaata tha | **CRITICAL** |
| V2 | Chat/code me input size cap nahi tha → ek hi request se token cost blow | HIGH |
| V3 | Image/audio prompt API par unbounded | MEDIUM |
| V4 | Kisi bhi LLM call par timeout nahi tha → hanging provider = latka hua request | HIGH |
| V5 | Guest→account migration hi nahi thi → register karte hi guest ka saara kaam orphan | HIGH (data loss) |
| V6 | Payment webhook nahi tha → paisa katne ke baad tab band = PRO nahi milta | MEDIUM |

Plus: PRO ke "monthly" limits actually **daily** counter se compare ho rahe the
(~30x zyada allowance mil rahi thi) — ab real calendar-month.

### Naya (additive — kuch bhi purana hataya nahi)

- `lib/auth/guest.ts` — HMAC-signed guest identities
- `lib/ai/gateway.ts` — har provider call par timeout + retry + sanitised error + input guard
- `lib/ai/router.ts` — scored Auto Router (14/14 test pass; 5 purane misroutes fix)
- `lib/db/store.ts` — project files (agent context), `migrateGuestData`, `getMonthlyUsage`
- `/api/projects/files` — coding agent read/write (path traversal blocked, owner-scoped)
- `/api/ai/generations` — image/audio history jo save to hoti thi par kabhi padhi nahi jaati thi
- `/api/checkout/webhook` — signed, idempotent, subscription downgrade ke saath

### Verification
36/36 regression pass · `tsc --noEmit` clean · production build clean ·
har vuln ka before/after live test `docs/AUDIT_UPDATE1.md` me.

### Abhi bhi pending (honest)
Server-side code sandbox (§3.3 — free hosting me container isolation nahi),
project files ka UI panel, image job progress UI, PDF/DOCX/XLSX, real-device
mobile QA, metrics persistence. Detail audit doc me.


---

## v1.9.0 — Real-user experience audit (F1–F7)

Boss ki shikayat thi: *"jese koi real ai platform work krta h, wese hamara abhi
nahi kr rha h"*. Pehle ek asli user ki tarah pura platform chala kar 7 problems
dhundhi (F1–F7), phir saari fix ki. Detail + before/after transcripts
`docs/USER_EXPERIENCE_AUDIT.md` me.

### Jo galat mila aur fix hua

| # | Problem | Severity | Status |
|---|---|---|---|
| F1 | Offline chat sirf prompt wapas bolta tha — "What is 2+2?" ka jawab "What do you need?" | **P0** | ✅ naya `lib/ai/offline-brain.ts` |
| F2 | Global `slice(0,200)` caps doosre user ka data delete kar dete the | **P0 CRITICAL** | ✅ per-user `RETENTION` + `trimPerUser()` |
| F3 | Per-conversation message cap nahi tha — unbounded growth, har write pe puri DB serialize | P1 | ✅ 400 messages/conversation |
| F4 | `GROQ_API_KEY` / `.env.local` / vendor naam user-facing messages me leak | P1 | ✅ 6 jagah saaf |
| F5 | Search chup-chaap `{ok:true, results:[]}` — user ko pata hi nahi kya hua | P1 | ✅ `webSearchDetailed()` + status/reason |
| F6 | Offline reply par koi recovery action nahi | P1 | ✅ Retry live + Connect a key |
| F7 | Adhure kaam: generation progress/retry UI, project-files panel | P2 | ✅ dono ban gaye |

### F1 sabse bada tha (yahi boss ki asli complaint thi)

Ab offline mode: maths aur unit/temperature conversion **exactly compute** karta
hai, code maange to **chalne wala poora code** deta hai, writing maange to
**asli structure** deta hai, aur jo cheez offline verify nahi ho sakti uske liye
**imaandari se** bolta hai + web search ka rasta dikhata hai. Language ab input
se match karti hai — English sawaal ka English jawab.

Kabhi bluff nahi, kabhi sawaal wapas nahi, kabhi vendor/env ka naam nahi.

### F2 ka live proof

```
fix se pehle:  Victim's chats now: 0   *** DELETED — DATA LOSS ***
fix ke baad:   Victim's chats now: 1   STILL THERE ✓
```

### Verification
34/34 regression pass · `tsc --noEmit` clean · production build clean ·
project files end-to-end (traversal 400, cross-user isolation empty).

### Abhi bhi pending (honest)
Server-side sandbox (container host chahiye), auto error-detect-fix loop,
PDF/DOCX/XLSX, metrics persistence, durable rate limit, audio MP3 storage,
conversation rename UI. Aur: is sandbox se har provider ka outbound TLS blocked
hai, isliye **live provider response deploy hone ke baad hi test ho sakta hai** —
uske liye ek free key chahiye hogi.


---

## v1.10.0 — Multi-model routing + real coding agent

Boss ke teen order the. Teeno pure.

### 1. "Ham ek hi model ke bharose nahi h — har field me 4-5 alag models"

**Jo galat mila:** catalog me 20 models likhe the, par `providers.ts` sirf
Groq ka request shape banata tha aur har model id **api.groq.com** ko bhejta
tha. "Claude Sonnet" chunne par string `claude-sonnet-4` Groq ko jaati thi,
Groq usse reject karta tha, aur chup-chaap Groq ka hi model chal jaata tha.
Matlab menu me 20 dish the, kitchen me ek.

**Ab:** naya `lib/ai/provider-registry.ts` — har vendor ka apna adapter.

| Vendor | Wire format | Kya alag hai |
|---|---|---|
| Groq, OpenRouter, OpenAI | openai | standard |
| Anthropic | anthropic | system top-level field, `x-api-key`, version header |
| Google | google | `contents`/`parts`, `streamGenerateContent` |

**28 models, 9 vendors:** chat 9 · code 6 · image 6 · audio 6.

Routing ab **availability-aware** hai — jis provider ki key nahi lagi, uske
models scoring se pehle hi hat jaate hain. Aur `modelChain()` fallback me
**pehle doosre vendor** ko rakhta hai, taaki ek vendor down hone se poori
capability na mare.

Scoring me **task-kind detection** aaya (writing / reasoning / code /
translation / summarise), jo har model ki declared strengths se match hoti hai:

```
"hi"                                   → Llama 3.1 8B Instant (sasta, sahi)
"Design a multi-region architecture…"  → GPT-OSS 120B         (reasoning)
"Write a nuanced 2000-word essay…" PRO → Claude 3.5 Sonnet    (writing)
```

### 2. "Coding wale section ko agent bna do — kaam A to Z kre"

**Jo galat tha:** ek prompt, ek code block. Na plan, na project ki memory,
na verification, na sudhaar.

**Ab:** `lib/ai/agent.ts` me asli loop —
**plan → act → check → fix → done**, paanch tools ke saath:
`list_files`, `read_file`, `write_file`, `delete_file`, `run_check`, `finish`.

`run_check` static analysis hai (execution nahi): balanced braces (quotes aur
comments samajh kar), JSON validity, HTML/script tag balance, aise event
handlers jo kabhi define hi nahi hue, bacha hua markdown fence, placeholder text.

**Agar checks fail ho rahe hain to agent `finish` nahi kar sakta** — usse wapas
kaam par bhej diya jaata hai.

**Live verified** (mock provider se poora loop):

```
list_files → write_file (toota HTML) → run_check FAIL
   ("Unbalanced braces: 1 unclosed | Handler addItem() never defined")
→ finish REJECTED → write_file (theek) → run_check PASS → finish
→ verified=true
```

Is test me **do bug khud pakde aur fix kiye**: placeholder detector todo app
ke "Todo" shabd par galat trigger ho raha tha, aur `verified` sirf isliye true
ho jaata tha ki files badli thi — ab wo tabhi true hota hai jab checks pass hon.

**Safety:** user ka code server pe kabhi execute nahi hota. Execution wahin
hai jahan tha — client ka sandboxed iframe aur Web Worker.

**Budgets:** 8 steps, 24 tool calls, 60k chars/file, 200k total, 120s wall
clock, bounded transcript. Plan ke against code generation ki tarah metered,
6 runs/min rate limit.

**UI:** canvas me Agent button (jo Stop bhi banta hai) + live step log with
per-tool status + verified banner.

### 3. "Frontend/backend/database kitna complete h, kya kami h"

Poori report: **`docs/PLATFORM_STATUS.md`**

| Layer | Complete | Sabse badi kami |
|---|---|---|
| Frontend | 90% | rename UI, diff view, multi-file preview |
| Backend | 85% | in-memory rate limit, koi execution sandbox nahi |
| Database | **60%** | **JSON file hai — serverless pe `/tmp` udd jaata hai** |
| Storage | **35%** | apna object storage hai hi nahi |
| AI power | 75% | **koi provider key configured nahi** |

**P0 (inke bina real AI platform nahi):**
1. Groq key lagao — *2 min, free* — poora AI layer live ho jayega
2. Asli database (Supabase Postgres) — *2-3 din, free tier*
3. Durable rate limiting (Upstash) — *4 ghante, free tier*

### Verification
38/38 regression · 19/19 agent unit tests · 8/8 router picks · agent loop
end-to-end · `tsc` clean · production build clean.

---

## v1.11.0 — Audit ke fixes + durable infrastructure

Boss ne poochha: *"koi feature double to nahi bana? kuch adhura to nahi
chhoda?"* Poora repo dobara padha, apna pichhla kaam bhi shaq se dekha.
**Double kuch nahi mila. Adhura 6 cheezein milin — sab fix.**

### Apni hi galtiyaan pakdi

**1. 182 line dead code** — v1.10.0 me provider registry banaya tha, par
purane `groqStream`, `groqComplete`, `openRouterStream`, `openAIStreamToTextSSE`
delete karna bhool gaya tha. Koi call site nahi tha. Ye registry ka hi
timeout/retry logic duplicate karte the — matlab koi bhi future fix do jagah
karna padta. Hata diye.

**2. Image catalog abhi bhi jhooth bol raha tha** — v1.10.0 me chat aur code
ke liye multi-provider bana diya tha, par **image chhod diya tha**. Catalog me
fal aur HuggingFace models list the, lekin `generateImage()` sirf Pollinations
URL banata tha. "FLUX Pro" chuno ya "FLUX" — bilkul same image aati thi.

`lib/ai/image-providers.ts` naya: asli fal + HuggingFace adapters,
availability-aware selection, cross-vendor fallback, aur `fellBack` flag taaki
UI bata sake ki user ka pick unavailable tha. Pollinations keyless free default
hi raha — kuch regress nahi hua.

### Adhuri cheezein poori kin

**3. Audio kabhi save hi nahi hota tha** — generated MP3 sirf base64 data URL
me thi. History row banta tha par refresh ke baad aawaz gayab. Images doosre ke
server se hot-link hoti thin. `lib/storage/media.ts` naya — Supabase Storage
par upload, stable public URL. Best-effort: storage na ho to purana behaviour.

**4. Rate limiting bypass ho sakti thi** — in-memory limiter per-instance hai.
Serverless par ek caller requests spread karke apni limit multiply kar leta,
aur har cold start counter reset kar deta. `lib/rate-limit/durable.ts` — atomic
Postgres function (ek hi statement me check + increment, concurrency-safe).
11 AI endpoints + login + register par laga. **Redis/Upstash ki zarurat khatam**
— jo Supabase waise bhi chahiye, usi se ho gaya.

**5. Do auth kamzoriyan:**
- `SESSION_SECRET` missing ho to chupchaap ek **publicly-known dev string** use
  hoti thi — koi bhi kisi ka session forge kar sakta tha. Ab production me
  throw karta hai. Wahi `BYOK_ENCRYPTION_SECRET` aur verify-token ke liye.
- `userFromPayload()` JWT ke andar ka `plan` claim trust karta tha. Matlab PRO
  rehte hue bana token, subscription khatam hone ke baad bhi PRO deta rehta.
  Ab paid entitlement hamesha DB se aati hai.

**6. Setup SQL kahin thi hi nahi** — `supabase/schema.sql` naya. Ek paste me
durable store + rate-limit table + atomic function + media bucket, sab RLS ke
saath jo anon/authenticated ko block karta hai.

---

## v1.11.1 — UI ko backend se joda + PRO gate ka bug

**7. ImageStudio abhi bhi hardcoded thi** — v1.11.0 me `/api/ai/models` ka
`selectable` bana diya tha par component use hi nahi kar raha tha. Ab karta
hai: sirf reachable models dikhte hain, `FAL_KEY` daalte hi FLUX Dev/Pro apne
aap aa jaate hain. Selected model list me na ho to auto-switch.

**8. PRO gate free users ko premium models de raha tha** — gate sirf literal id
`"pro"` check karta tha, par asli premium ids `fal-ai/flux/dev` aur
`fal-ai/flux-pro/v1.1` hain. **Free user premium image models chala sakta tha.**
Ab catalog ke `tiers` se gate lagta hai.

Verified: free user → `fal-ai/flux/dev` → 402 · free user → `turbo` → 200.

**9. Health endpoint sach nahi bolta tha** — `db` hamesha `disk`/`memory` kehta
tha chahe Supabase laga ho. Naya `durability` block: `database`, `rateLimits`,
`mediaStorage`. Ab ek nazar me pata chalta hai setup poora hua ya adhura.
Saath me: health image models ko chat providers ke against gin raha tha — fix.

### Verification
38/38 regression · 19/19 agent unit · 8/8 router picks · `tsc` clean ·
production build clean · PRO gate dono direction live verify.

### Boss ke liye
- `docs/SETUP_GUIDE.md` — Supabase steps, Redis kyun nahi chahiye, 5 test
- `docs/REMAINING_WORK.md` — kaun kya karega, aur kya jaanbujh kar chhoda
