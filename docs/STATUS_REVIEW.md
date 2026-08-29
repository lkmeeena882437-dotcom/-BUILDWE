# BUILDWE — Status Review (v1.7.0)
_Internal review — boss ke liye. Public nahi._

**Date:** 29 Aug 2026 · **Live:** port 3000 · **Branch:** `arena/01a04db8-buildwe` → merged to `main`

---

## 1. BUILDWE kya hai (ek line me)

Ek hi website jahan user Hinglish/English me kuch bhi likhe — AI uska **intent samajh ke** sahi tool chunta hai: baat-cheet, code, image, voice, file-analysis, fact-verify, model-comparison. User ko AI ki jargon nahi pata — **"-interface simple, intelligence peeche"**.

## 2. Modes (user ke 6 tools)

| Mode | Kya karta hai | Kaise kaam karta hai |
|---|---|---|
| **Chat** | sawaal-jawaab, likhai, plan | Understanding layer → smart routing → streaming jawaab + quality gate |
| **Code** | website/app code banao | Code-specific prompt + Code Canvas (live preview + V1/V2/V3 history) + Run/Test/Fix/Optimize/Refactor actions (v1.7.0) |
| **Vision** | image samjho | image attach → describe/extract (5 MB limit, friendly error) |
| **Voice** | script → audio | real MP3 jahan key ho, warna browser voice (free fallback) |
| **Image** | AI se image | Pollinations etc., offline me honest message |
| **Auto** | user kuch na chune | AI khud mode detect karta hai |

## 3. AI Pipeline (har message ke peeche, ordered)

1. **Guest/user session** — login optional, guest cookie se kaam chalti hai
2. **Rate limit + plan limit** — overload se bachav
3. **Understanding Layer** — intent (12 types), platform, style, language, expected output, missing-info detect
   - material gap → **1 hi sawaal** (clarifier chip)
   - minor gaps → sensible defaults (UI chip me dikhta hai)
   - **surgical edit** detect ("sirf section 2 chhota karo") → purana answer preserve
   - **correction detect** ("nahi, yeh manna tha") → 1 line me galti accept + corrected answer
   - **duplicate ask detect** → dobara kaam nahi, pehle wale answer se link
4. **Complexity budget** — simple 1024 / medium 2048 / complex 4096 tokens; simple = seedha jawaab, complex = pehle 2-3 line plan
5. **Long-context** — 18+ turns → last 14 + purani baatein compressed (paisa + speed bachta hai)
6. **Model routing** — free models list, complexity-based pick; **BYOK** (user ki apni Groq/OpenRouter key) priority me
7. **Provider fallback** — primary fail → backup → offline composer; **har switch UI me dikhta hai** ("⚙ Model switched: …")
8. **Streaming** — "Understanding… → Writing…" phases, stable layout
9. **Quality Gate** — on-topic/format/length check → "✓ Checked" / "⚠ Review" badge (honest, koi fake % nahi)
10. **Persistence** — conversation save, sources + quality label ke saath

## 4. Trust & Safety features

- **🛡 Verify** — har answer pe button: claims (numbers/dates/prices) nikaal ke live web sources se cross-check; **official/primary source preference** (docs/gov/edu); "agreement ≠ proof" honesty
- **⚖ Compare models** — 1 sawaal → 3 models (reasoning/speed/writing) → judge synthesis; offline me saaf bolta hai
- **Prompt-injection guard** — web/file content = UNTRUSTED, uske andar likhe instructions ignore
- **Key security** — BYOK keys AES-256-GCM encrypted, masked, kabhi client ko wapas nahi
- **Security headers** — CSP, frame-guard, nosniff, referrer-policy, permissions-policy
- **Error recovery** — har error par: asli wajah + **Try Again** (same model) + **Use another model** (agla model) + hint (jaise "file 5 MB se chhoti karo")

## 5. User-facing surface (kya-kya dikhta hai)

- **Sidebar:** New chat, history (search + projects + teams), guest/login, plans
- **Composer:** mode chips, answer-style (length + language), 🌐 web-search toggle, ⚖ compare, 📎 file/image attach, 🎤 voice input
- **Message par:** Copy, Regenerate, Edit-prompt, 👍/👎, quick actions — **Simplify · Shorten · Expand · Explain · Example · Document · Table · Report**, 🛡 Verify, Use-as-prompt, Save
- **Chips:** "Understood: …", quality badge, sources, fallback banner
- **Code Canvas:** code editor view + live HTML preview + version history (12 snapshots, Restore) + **Run ▶ / Test ✓ / Fix 🔧 / Optimize ⚡ / Refactor ♻** (v1.7.0)
- **Sheets:** Settings (theme, models, skills/mind, BYOK keys, export chat, print), Plans, Teams, Profile

## 6. Pages (public)

`/` app · `/pricing` `/how-it-works` `/developers` `/security` `/help` `/terms` `/privacy` `/status` `/s/[id]` (share) · `/print` · auth pages
(`robots.txt` me `/api/`, `/reset`, `/verify` disallow; changelog page **hatayi gayi** — internal only)

## 7. Free-stack guarantee (boss ka rule)

- Bina kisi key ke bhi app chalti hai — offline composer + browser voice + honest "key add karo" messages
- Koi paid API kabhi force nahi; BYOK free Groq key se full quality milti hai
- Demo fallbacks hamesha rahenge

## 8. Internal ops (public nahi)

- `/api/metrics` — time-to-first-token, completion rate, fallback rate, regenerations, recovery actions, corrections, surgical edits (in-memory, restart pe reset; zero PII)
- `docs/UPDATE_TRACKER.md` — boss ke updates ka status board
- `docs/COMPETITOR_GAP_ANALYSIS.md` — internal implementation history

## 9. Version history

| Ver | Kya aaya |
|---|---|
| v1.3 | canvas version history, ads, share, projects/teams |
| v1.4.0 | Boss Update #3: UX/brand/trust — answer controls, search grounding, security guards |
| v1.5.0 | Boss Update #1: understanding layer, clarification, quality gate, verify |
| v1.6.0 | Boss Update #2: budgets, long-context, security headers, fallback transparency, error recovery, compare models, Document/Table/Report, surgical/correction |
| v1.6.1 | Re-check pass: duplicate prevention, plan-first, file-size hints, internal metrics |
| **v1.7.0** | **Code Canvas actions: Run / Test / Fix / Optimize / Refactor** |

## 10. Known limits (honest)

- Sandbox se Groq API kabhi-kabhi unreachable (ECONNRESET) — offline fallback khud ba khud chal jaata hai, UI me banner dikhta hai
- Python code "Run" nahi hota (server pe arbitrary code chalana unsafe) — JS/HTML client-side me chalte hain
- PDF/DOCX/XLSX file-analysis pending (CSV/TXT/images chalte hain)
- Real-device mobile QA pending (responsive + touch UI code-level verified)
- Metrics restart pe reset hote hain
