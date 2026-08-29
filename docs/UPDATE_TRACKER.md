# BUILDWE — Update Tracker (internal, not public)

Boss bhejte hue updates yahan track hote hain. Public changelog page hata diya gaya hai (v1.4.1).

## Status board

| Update | Source | Status |
|---|---|---|
| Update #1 — Product Audit & AI Intelligence Roadmap | boss (chat paste) | ✅ Implemented (v1.5.0) — P0 complete, P1 partial (see below) |
| Update #2 — Next Big Update (latency/cost/security/fallback/verification/errors + smart-execution rules) | boss (chat paste) | ✅ Implemented (v1.6.0) — see below |
| Update #2 re-check pass | boss ("recheck karo, kuch adhura to nahi") | ✅ v1.6.1 — 4 gaps mile aur fix hue (niche) |
| Update #3 — Product/UX/Brand/Trust plan | boss (chat paste) | ✅ Implemented earlier (v1.4.0) |

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
