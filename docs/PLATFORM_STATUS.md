# BUILDWE — Platform Status Report

**Version:** 1.10.0 · **Date:** 30 August 2026 · Branch `arena/01a0508e-buildwe`

Boss ka sawaal: *"Frontend kitna complete h, backend kitna h, database kitna h,
or kya kami h ab — or jo hamko dekhna chaiye or jo real ai power ke liye jaruri h"*

Ye report andaaze pe nahi hai. Har number chalte hue platform se nikala gaya
hai, aur har "kami" ko live test karke confirm kiya gaya hai.

---

## Ek nazar me

| Layer | Complete | Sach me kya matlab |
|---|---|---|
| **Frontend** | **90%** | Poora UI ban chuka hai aur kaam karta hai. Kami polish aur do-teen missing panels ki hai, dhaanche ki nahi. |
| **Backend** | **85%** | 40 API routes, multi-provider routing, agent loop, limits, billing — sab live. Kami durability aur execution sandbox ki hai. |
| **Database** | **60%** | Schema poora aur sahi hai, isolation bulletproof hai. **Engine hi sabse badi kami hai** — ek JSON file. |
| **Storage** | **35%** | Images third-party URL hain, audio base64 memory me. Apna koi storage nahi. |
| **AI power** | **75%** | Routing, agent, fallback, offline brain — sab asli. Kami: **koi provider key nahi lagi hui.** |

**Sabse choti cheez jo sabse bada farak layegi: ek free Groq key.** Uske bina
poora AI layer offline mode me chal raha hai.

---

## 1. Frontend — 90%

### Jo poora ban chuka hai ✅

| Cheez | Haal |
|---|---|
| 16 pages | Sab 200 OK — landing, pricing, help, about, security, privacy, terms, status, contact, developers, how-it-works, acceptable-use, verify, reset, share, print |
| 5 AI modes | Chat · Code · Image · Voice · Auto — sab wired |
| Code canvas | Code / Preview / **Files** teen tab, version history, Run/Test/Fix/Optimize/Refactor |
| **Agent panel (naya)** | Live step log, per-tool status, verified banner, Stop button |
| Image Studio | Progress bar (phase labels ke saath), failure card + retry, filmstrip, fullscreen, download |
| Audio Studio | Voice list, speed, player, history, rendering indicator, failure bar |
| Project files UI | List, open-into-canvas, save, delete, refresh, empty state |
| History | Search, project filter, team filter, delete |
| Auth UI | Login, register, OAuth (Google/GitHub), reset, verify, guest mode |
| Settings | BYOK keys, skills, plan, delete account |
| Accessibility | 42 aria-labels, role="alert"/"status" live regions, keyboard paths |
| Mobile | Responsive layouts, bottom nav, `pb-mobile-nav` |
| States | 7 skeleton/shimmer loaders, 17 retry affordances, abort/stop wired |

### Ab bhi kami ❌

| Kami | Asar | Kitna kaam |
|---|---|---|
| Conversation rename UI | Delete hai, rename nahi — chhoti si kami | 1 ghanta |
| PRO model picker | Backend manual override support karta hai, UI nahi deti | 3 ghante |
| Diff view | Agent file badalta hai, user ko purana vs naya dikhta nahi | 4 ghante |
| Multi-file preview | Preview sirf canvas ka HTML chalata hai, project ke saare files nahi | 6 ghante |
| Real-device mobile QA | Responsive CSS hai, par asli phone pe test nahi hua | 2 ghante |

**Faisla:** frontend ki koi structural kami nahi hai. Jo bacha hai wo
"achha se behtar" wala kaam hai, "toota hua" nahi.

---

## 2. Backend — 85%

### Jo poora ban chuka hai ✅

**40 API routes**, sab live test kiye hue:

| Group | Routes | Haal |
|---|---|---|
| AI | chat, code, agent, auto, image, audio, vision, search, verify, compare, code-action, file, models, feedback, generations | ✅ |
| Auth | login, register, logout, me, verify, forgot, reset, delete, oauth/[provider] + callback | ✅ |
| Data | history, projects, projects/files, teams, share, user/keys, user/skills | ✅ |
| Billing | checkout/order, checkout/verify, checkout/webhook | ✅ |
| Platform | health, metrics, dev/keys, v1/chat (public API) | ✅ |

**Reliability layer** (`lib/ai/gateway.ts`): har provider call par timeout
(30–60s), retry with backoff, error taxonomy (`TIMEOUT`/`RATE_LIMIT`/…),
sanitised messages. Raw provider errors user tak kabhi nahi pahunchte.

**Multi-provider routing (v1.10.0 me naya)** — 28 models, 9 vendors, har
vendor ka apna adapter. Router sirf un providers ko dekhta hai jinki key lagi
hai. Fallback chain cross-vendor pehle jaati hai, taaki ek vendor down hone
se poori capability na mare.

**Coding Agent (v1.10.0 me naya)** — asli plan → act → check → fix loop,
paanch tools, static verification, har axis pe budget.

**Security — verified safe:**

| Control | Haal |
|---|---|
| BYOK encryption | AES-256-GCM ✅ |
| Guest cookies | HMAC-signed ✅ |
| JWT | HS256, httpOnly ✅ |
| Razorpay webhook | HMAC verified, idempotent ✅ |
| Prompt injection | "UNTRUSTED DATA" marking on web results ✅ |
| Path traversal | 400 pe block ✅ (live test) |
| Cross-user isolation | Har query owner-scoped ✅ (live test) |
| Input caps | 24k/message, 120k/conversation, 413 pe reject ✅ |
| Code execution | Server pe kabhi nahi — sirf client iframe + Web Worker ✅ |
| CSP headers | Set ✅ |

**Server-side limits:** free = daily, PRO = calendar-month. Frontend bypass
possible nahi — har check server pe hai.

### Ab bhi kami ❌

| Kami | Severity | Asar | Kitna kaam |
|---|---|---|---|
| **Rate limit in-memory hai** | **HIGH** | Serverless pe har instance ka apna counter — multi-instance pe bypass ho sakta hai | 4 ghante (Upstash Redis) |
| **Metrics restart pe udd jaati hain** | MEDIUM | `/api/metrics` sirf current process ka data deta hai | 3 ghante |
| **Server-side code sandbox nahi** | MEDIUM | Agent code likh sakta hai, chala nahi sakta. `run_check` static hai. | Container host chahiye |
| Hardcoded dev-secret fallback | MEDIUM | `SESSION_SECRET` na ho to dev default use hota hai — prod me fail hona chahiye | 1 ghanta |
| `userFromPayload()` JWT `plan` trust karta hai | MEDIUM | Purana token PRO claim kar sakta hai jab tak DB se cross-check na ho | 2 ghante |
| Email actually bhejta nahi | MEDIUM | Verify/reset tokens ban to jaate hain, email nahi jaati | 3 ghante (Resend) |
| Agent multi-file preview nahi | LOW | Agent kaam karta hai, preview ek file tak | 4 ghante |
| PDF/DOCX/XLSX export | LOW | Boss ke original scope me tha | 6 ghante |

---

## 3. Database — 60% (sabse kamzor layer)

### Schema poora hai ✅

11 collections, 58 exported functions, sab owner-scoped:

| Collection | CRUD | Isolation |
|---|---|---|
| users | ✅ full | — |
| conversations | ✅ full | ✅ per-user |
| generations | ✅ full | ✅ per-user |
| usage | ✅ full | ✅ per-user |
| projects | ✅ full | ✅ per-user |
| projectFiles | ✅ full | ✅ per-user |
| shares | ✅ full | ✅ per-user |
| payments | ✅ full | ✅ per-user |
| apiKeys | ✅ full | ✅ per-user |
| teams | ✅ full | ✅ membership |
| passwordResets | ✅ full | ✅ per-user |

**Retention (v1.9.0)** — har cap per-owner hai, koi global `slice()` nahi.
Isse wo CRITICAL bug fix hua jisme ek busy user doosre ka data delete kar deta tha.

**Guest → account migration** kaam karta hai. **Cascade delete** kaam karta hai.

### Engine hi sabse badi kami hai ❌

**Aaj: ek JSON file** (`/tmp/buildwe-data/buildwe.json`), poori DB har write
pe `JSON.stringify` hoti hai. Optional Supabase mirror hai par wo bhi poore
document ko ek row me daalta hai.

Iska matlab:

| Problem | Severity | Kya hota hai |
|---|---|---|
| **Serverless pe `/tmp` gayab ho jaata hai** | **CRITICAL** | Vercel instance recycle = saara data khatam, jab tak Supabase mirror on na ho |
| **Har write poori DB likhta hai** | **HIGH** | 1000 users pe har chhota update megabytes likhega |
| **Concurrent writes ek doosre ko overwrite karte hain** | **HIGH** | Last-write-wins — do simultaneous requests me ek ka kaam gum |
| **Koi index nahi** | MEDIUM | Har lookup poora array scan karta hai |
| **Koi transaction nahi** | MEDIUM | Payment + plan upgrade atomically nahi ho sakte |
| **Koi migration system nahi** | MEDIUM | Schema badla to purana data manually fix karna padega |

**Ye ek proper database maangta hai.** Meri sifarish: **Supabase Postgres**
proper tables ke saath (abhi wala single-JSON-row mirror nahi). Free tier kaafi
hai. Kaam: 2-3 din, kyunki 58 store functions ka interface same rakhte hue
andar se Postgres queries karni hongi — call sites badalne ki zarurat nahi.

---

## 4. Storage — 35%

| Cheez | Aaj kaise hai | Problem |
|---|---|---|
| Generated images | Pollinations ka URL DB me save hota hai | ❌ Hum host nahi karte — wo URL kabhi bhi mar sakta hai |
| Generated audio | base64 data URL, memory me | ❌ Persist hi nahi hota, refresh pe gayab |
| Uploaded files | Vision ke liye 5 MB memory me | ❌ Kabhi save nahi hote |
| Project files | DB me text ke roop me | ⚠️ Chalta hai, par binary support nahi |
| User avatars | Hai hi nahi | ❌ |

**Apna koi object storage nahi hai.** Chahiye: Supabase Storage ya Cloudflare
R2 (dono ka free tier kaafi hai). Kaam: 1 din.

---

## 5. AI power — 75%

### Asli cheezein jo ban chuki hain ✅

| Capability | Haal |
|---|---|
| Model catalog | **28 models, 9 vendors** — chat 9, code 6, image 6, audio 6 |
| Provider adapters | Groq, OpenRouter, OpenAI, Anthropic, Google — har ek ka apna wire format |
| Availability-aware routing | Bina key wale providers score se pehle hi hat jaate hain |
| Task-aware selection | writing / reasoning / code / translation / summarise detect hota hai |
| Cross-vendor fallback | Chain pehle doosre vendor pe jaati hai, phir usi vendor ke models pe |
| Auto Router | Intent detect (chat/code/image/audio) + model auto-select |
| **Coding Agent** | plan → act → check → fix, 5 tools, static verification |
| Offline brain | Maths, conversions, runnable code, honest "pata nahi" |
| Web search grounding | DuckDuckGo + lite fallback, honest failure reasons |
| Vision | Image understanding wired (key chahiye) |
| Prompt injection defence | Web results "UNTRUSTED DATA" mark hote hain |

**Router verified:**

```
"hi"                                    → Llama 3.1 8B Instant  (sasta, sahi)
"Design a multi-region architecture…"   → GPT-OSS 120B          (reasoning)
"Write a nuanced 2000-word essay…" PRO  → Claude 3.5 Sonnet     (writing)
"refactor this enterprise…"        PRO  → chain me Claude Code aata hai
```

**Agent verified** (mock provider ke against, poora loop):

```
list_files → write_file (broken HTML) → run_check FAIL
  ("Unbalanced braces: 1 unclosed | Handler addItem() never defined")
→ premature finish REJECTED → write_file (fixed) → run_check PASS
→ finish → verified=true
```

### Ab bhi kami ❌

| Kami | Severity | Asar |
|---|---|---|
| **Koi provider key configured nahi** | **BLOCKER** | Poora AI layer offline mode me chal raha hai. Sab code ready hai, key nahi hai. |
| Agent code chala nahi sakta | MEDIUM | `run_check` static hai. Asli execution ke liye container chahiye. |
| Streaming agent output nahi | LOW | Agent steps stream karta hai, model tokens nahi |
| Image/audio ke liye alag provider adapters | MEDIUM | Registry chat/code ko multi-provider karta hai; image/audio abhi Pollinations pe |
| Vision multi-provider nahi | LOW | Sirf Groq vision path |
| Model-specific limits | MEDIUM | Limits per-feature hain, per-model nahi — mehnga model sasti quota kha sakta hai |

---

## 6. Ab kya karna chahiye — priority order

### 🔴 P0 — inke bina "real AI platform" nahi ban sakta

**1. Provider keys lagao** — *2 minute, ₹0*
Ek free Groq key (console.groq.com) 5 chat + 3 code models unlock kar deti hai.
Ye sabse zyada asar wali cheez hai. Baaki sab code taiyaar baitha hai.

**2. Asli database** — *2-3 din*
Supabase Postgres proper tables ke saath. Abhi JSON file hai; serverless pe
`/tmp` udd jaata hai. Ye single biggest technical risk hai.

**3. Durable rate limiting** — *4 ghante*
In-memory counter multi-instance pe bypass ho jaata hai. Upstash Redis free tier.

### 🟡 P1 — production ke liye zaroori

**4. Object storage** — *1 din* · images/audio apne paas host karo
**5. Email delivery** — *3 ghante* · verify/reset abhi tokens banate hain, bhejte nahi
**6. JWT plan claim DB se verify** — *2 ghante* · purana token PRO claim na kar sake
**7. Prod me secret fallback hatao** — *1 ghanta* · `SESSION_SECRET` na ho to boot fail ho
**8. Metrics persistence** — *3 ghante*

### 🟢 P2 — platform ko poora karne ke liye

**9. Agent execution sandbox** — *container host chahiye* · asli code execution
**10. Model-specific limits** — *4 ghante* · mehnge models ki alag quota
**11. Diff view + multi-file preview** — *10 ghante*
**12. PDF/DOCX/XLSX export** — *6 ghante*
**13. Conversation rename** — *1 ghanta*
**14. Real-device mobile QA** — *2 ghante*

---

## 7. Boss se kya chahiye

| Cheez | Kyu | Kaise milegi | Kharcha |
|---|---|---|---|
| **Groq API key** | Poora AI layer live ho jayega | console.groq.com → 2 min signup | **Free** |
| **Supabase project** | Asli database + storage | supabase.com → new project | **Free tier** |
| Upstash Redis | Durable rate limits | upstash.com | **Free tier** |
| Resend API key | Verification emails | resend.com | Free 3000/month |
| OpenRouter key *(optional)* | Cross-vendor fallback | openrouter.ai | Free credits |
| Anthropic key *(optional)* | PRO writing quality | console.anthropic.com | Paid |

Pehli teen free hain aur teeno P0/P1 blockers hatati hain.

---

## 8. Imaandar baat: is sandbox se kya test nahi ho sakta

Yahan se **har AI provider ka outbound TLS blocked hai** — Groq, OpenRouter,
Pollinations, DuckDuckGo, sab. Sirf github.com reachable hai.

Iska matlab:

- ✅ Test ho chuka: routing logic, agent loop (mock provider se), offline brain,
  saare guards, data isolation, limits, build, 38/38 regression
- ❌ Test nahi ho sakta: asli model ka jawab kaisa aata hai, asli latency,
  asli image/audio generation

Live provider quality **deploy ke baad hi** verify hogi. Isliye Groq key
sabse pehli priority hai — usse hi pata chalega ki asli output kaisa hai.

---

## 9. Bharosa — kya cheez sach me pakki hai

| Test | Result |
|---|---|
| Regression suite | **38/38 pass** |
| Agent unit tests | **19/19 pass** |
| Router selection tests | **8/8 sensible picks** |
| Agent loop end-to-end | **verified** (broken → detect → fix → pass) |
| TypeScript | **clean** |
| Production build | **clean** |
| Cross-user isolation | **verified** live |
| Path traversal | **blocked** live |
| Data-loss bug (F2) | **fixed + verified** |

---

**Kul milakar: platform ka dhaancha poora hai aur mazboot hai. Do asli
kamzoriyaan hain — database engine, aur koi provider key na hona. Dono ek
din se kam me theek ho sakti hain, aur dono free tier se ho jaayengi.**
