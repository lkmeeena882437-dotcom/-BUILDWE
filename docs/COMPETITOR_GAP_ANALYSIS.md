# BUILDWE vs ChatGPT / Claude / Gemini — Gap Analysis

**Positioning:** BUILDWE is a **unified free workspace** (Chat + Code + Image + Audio), not a single-model chatbot. Compare like **ChatGPT (all-in-one)** + **Cursor-lite code** + creative tools.

## Competitor strengths we match or partially match

| Feature | ChatGPT | Claude | Gemini | BUILDWE now |
|---------|---------|--------|--------|-------------|
| Text chat streaming | ✓ | ✓ | ✓ | ✓ |
| Multi-turn conversation | ✓ | ✓ | ✓ | ✓ (improved mind) |
| Code generation | ✓ | ✓✓ | ✓ | ✓ + canvas |
| Image generation | ✓ | ✗ | ✓ | ✓ |
| Voice / TTS | ✓✓ | limited | ✓ | ✓ (device + upgrade path) |
| Free tier | limited | limited | generous | ✓ ads-funded free |
| Mobile responsive | ✓ | ✓ | ✓ | ✓ |
| Auth + history | ✓ | ✓ | ✓ | ✓ (serverless limits) |

## Gaps (needed) — priority order

### P0 — Quality & intelligence (this sprint)
1. **Message-faithful replies** — always answer *this* user text ✅ done + mind layer
2. **Conversation memory / mind** — remember prefs, language, goals across turns ✅ done
3. **User skills / custom instructions** — like Custom GPT instructions ✅ done
4. **Model ladder** — free live + paid/pro models “Coming soon” ✅ done (seats reserved)
5. **Feedback loop** — 👍👎 trains local mind weights / notes ✅ done

### P1 — Parity features
6. **Web search / browse** ✅ done — DuckDuckGo key-free, grounded answers with [n] source chips, `search:` prefix or 🌐 toggle; works even without LLM keys
7. **Vision (image understand)** ✅ done — attach image in chat → Groq llama-4-scout when key set, honest preview fallback otherwise
8. **File analysis** ✅ done — attach CSV/TXT/MD/JSON → server-side stats (rows, column types, min/max/avg, keywords) injected into the prompt
9. **Projects / folders** ✅ done — create/assign/filter/delete projects, sidebar chips
10. **Artifacts panel** ✅ done — code canvas + live HTML preview tab (sandboxed iframe)
11. **Share conversation link** ✅ done — `/s/{id}` public read-only page + copy-link button
12. **Branch / edit & continue from message** ✅ done (edit-prompt button re-asks)
13. **Stop + partial save** ✅ done — server saves the partial answer when the client aborts
14. **Export chat** ✅ Markdown export in Settings (PDF via browser print)

### P2 — Platform growth
15. **Ads slots** ✅ done — tasteful house-ad slots (chat empty state + sidebar), free only, PRO ad-free; override via `NEXT_PUBLIC_AD_HTML`
16. **PRO billing** Razorpay ✅ done — real order create + HMAC verify + plan=pro upgrade; demo mode until live keys
17. **Permanent DB** ✅ done — optional Supabase mirror (`lib/db/remote.ts`): debounced snapshot push + boot pull when env set; atomic local JSON writes otherwise. SQL + env documented in `.env.example`
18. **Mobile apps** ✅ PWA first — manifest + icons + service worker (installable)
19. **Team workspaces** ✅ done — create teams, invite links (`/?join=CODE`), join by code, share chats with team, team chips filter in sidebar, owner-dissolves-on-leave rule
20. **API for developers** ✅ done — `/api/v1/chat` + key management at `/developers`, hashed keys, 30 rpm

### P3 — "Real Audio + BYOK + Dev API + Ads" update
21. **Real TTS audio** ✅ done — Pollinations `openai-audio` key-free MP3 with native player + MP3 download; browser TTS fallback
22. **BYOK** ✅ done — Settings → API keys; user keys AES-256-GCM encrypted server-side, power Chat/Code/Vision/dev API for that account
23. **Export PDF** ✅ done — Settings → Print / PDF (clean print view at `/print`)

### Status: ALL roadmap items shipped. Remaining "Coming soon" seats (paid FLUX Pro / studio voices / premium models) activate only when paid provider keys are added — BYOK covers the free path.

## What we will NOT copy blindly
- Dark generic dashboard
- Vendor name dropping in UI
- Fake “unlimited” that breaks
- Locked free tier with no value

## BUILDWE unique wedge
**One free place for the 4 jobs** people open 4 tabs for — Chat, Code, Image, Audio — with Auto routing and an improving Mind.

---

## UPDATE 3 (v1.4.0) — Product, UX, Brand, Trust & AI Experience

**P0 items**
- ✅ Auth foundation: OAuth Google + GitHub (graceful until keys set), forgot-password with single-use hashed 1-hour reset links, password reset page, account deletion with full cascade, guest nudge ("Guest = Try · Account = Own"), animated auth sheet with loading states
- ✅ Visual design system: semantic success/warning/error/info states, motion tokens (fast/subtle), entrance animations, focus-visible rings, prefers-reduced-motion support, micro-interactions
- ✅ Human-language rule: outcome-first hero ("AI that understands the work. Not just the words."), natural-language placeholders, "BUILDWE picks the tool" helper, no syntax required anywhere
- ✅ Trust & transparency: /how-it-works, /security, /acceptable-use, /changelog, /status (live health), /help (FAQ), /contact, JSON-LD (Organization + WebSite + SoftwareApplication), robots.txt, sitemap.xml, honest ₹500 pricing display, cookie consent notice
- ✅ Performance & reliability: Understanding → Writing progress states, Try-again recovery, provider isolation (existing), complexity budgets (existing)
- ✅ Security: untrusted-content guards (web results + files marked as data, instructions inside ignored), live-mode search-grounding fix (system messages were dropped before)

**P1 items**
- ✅ Brand architecture: BUILDWE Chat / Code / Vision / Voice with taglines
- ✅ Answer controls: Short/Balanced/Detailed/Deep + Simple/Standard/Expert; quick actions Simplify/Shorten/Expand/Explain/Save; canvas version history (12 snapshots)

**QA**: reset/replay/delete lifecycle, wrong-password delete block, cascade verification (teams/projects), depth+tone regression, all pages + sitemap + robots 200, TS clean, build pass.

---

## UPDATE #1 (v1.5.0) — AI Intelligence & Output Quality (audit roadmap)

- ✅ Prompt Understanding Layer (intent/entities/goal/style/output/missing → system hint + UI chip)
- ✅ Smart Clarification (one question only when material; else sensible defaults)
- ✅ Response Quality Gate (on-topic/format/length → ✓ Checked / ⚠ Review badge, honest notes)
- ✅ Verification layer: Verify action → claim extraction → live-source match → Verified/Uncertain + sources (no fake confidence %)
- ✅ Auto length by complexity + explicit Short/Balanced/Detailed/Deep & Simple/Standard/Expert
- ✅ New quick actions: Example, Verify, Use-as-prompt (plus Simplify/Shorten/Expand/Explain/Save/Copy/Regenerate)
- ✅ Understanding layer wired into chat AND code routes
- 🔁 Public /changelog page removed per product decision (history stays in docs)

---

## UPDATE #2 (v1.6.0) — Next Big Update (speed/cost/safety/reliability + smart execution)

Scope per boss's "mix" decision: Update #2 + Update #1's pending P1 (multi-model compare, convert-to-deliverable) + visible manual "Use another model" button.

- ✅ Complexity compute budgets: max_tokens 1024/2048/4096 (simple/medium/complex), temp 0.45 code / 0.7 chat — threaded through groqStream/groqComplete/openRouterStream
- ✅ Long-context compression: >18 turns → last 14 kept + one background line of older user asks
- ✅ Security headers (CSP-lite, frameguard, nosniff, Referrer-Policy, Permissions-Policy) via next.config.js — original images.remotePatterns preserved
- ✅ Provider fallback transparency: fallbackNote per stage (openrouter/groq/offline) → SSE meta → UI amber banner "Model switched: …"
- ✅ Error recovery panel: real explanation + Try Again / Use another model (altModel 1–3 → preferOffset) + contextual tip; API errors carry code+hint (RATE_LIMIT first)
- ✅ Verification reliability: primary/official source preference (docs/developer/gov/edu + claim-keyword host scoring), official flag on sources
- ✅ Surgical editing + correction loop detection in understanding layer (system hints; correction never restarts, names the wrong assumption in one line)
- ✅ Multi-model comparison: /api/ai/compare — 3 seats (llama-3.3-70b / 3.1-8b / gemma2-9b) + judge synthesis, honest offline, 10/min rate limit; composer Layers button + lanes/synthesis modal UI
- ✅ Convert-to-deliverable quick actions: Document / Table / Report
- ✅ Prompt rules 13 (honest limits) & 14 (formatting serves comprehension)
- ✅ No new surface area — anti-bloat principle respected (intelligence behind the interface)

**QA**: TS clean, build pass, live regression — security headers present on /, /changelog 404, chat/code SSE with fallbackNote+understood meta, compare offline-honest + 429 RATE_LIMIT (with session cookie), surgical/correction intents detected, altModel accepted, home/status 200.

## RE-CHECK PASS (v1.6.1) — gaps found & fixed

Boss asked: "recheck everything, kuch adhura to nahi?" Full audit of v1.4.0+v1.5.0+v1.6.0 vs all three updates:

- ✅ verified already-present: BYOK key encryption (AES-256-GCM), untrusted-content guards, canvas version history, reduced-motion + aria, AdSlot, answer controls
- ✅ fixed: duplicate-work prevention (≥85% overlap → "reference earlier answer" hint)
- ✅ fixed: plan-first hint for complex tasks (smart-execution rule)
- ✅ fixed: FILE_TOO_LARGE code+hint on vision 413; client 200 KB text-file cap
- ✅ added: lightweight internal metrics (/api/metrics, zero PII, robots-disallowed) — ttft/completion/error/fallback/regeneration/recovery + correction & surgical counters
- ✅ fixed: Try Again retries SAME model; Use another model advances (was double-shifting)

**QA**: TS clean, build pass, live — metrics snapshot counts chat_send/chat_done/fallback + ttft sample, vision 413 carries code+hint, dup-message chat 200, /api disallowed in robots.

## v1.7.0 — Code Canvas Actions (Update #1 P1 #8 complete)

- ✅ New POST /api/ai/code-action {code, lang, action: fix|optimize|refactor|test} — 20/min rate limit, plan code limits, BYOK precedence, honest offline unavailable (never fabricates a "fix"), fenced-block extraction + Hinglish change-notes
- ✅ Canvas toolbar: Run ▶ (emerald) · Test · Fix · Optimize · Refactor — with busy spinners + tooltips, Copy/Save intact
- ✅ Run: HTML→preview, JS→sandboxed Web Worker (console.log/assert capture, 3s timeout, imports stripped, no server-side execution ever), other langs→honest note
- ✅ Test: AI-generated framework-free assertions, auto-run in sandbox for JS with PASS ✓/FAIL ✗ output
- ✅ Fix/Optimize/Refactor: canvas update + auto version snapshot (History restore path intact)
- ✅ Canvas console panel (Output/Tests/Info/Note, dismissible, role=status/alert)
- ✅ docs/STATUS_REVIEW.md added (internal ops doc)

**QA**: TS clean, build pass, live — code-action 400 empty/unknown, offline honest available:false, v1.7.0 boot, metrics live.
