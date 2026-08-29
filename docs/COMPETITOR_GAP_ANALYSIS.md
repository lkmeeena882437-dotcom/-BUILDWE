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
