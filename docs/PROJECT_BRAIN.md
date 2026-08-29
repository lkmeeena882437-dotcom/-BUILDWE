# BUILDWE.ONLINE — Complete Review + Brain Plan

## 1. Why this product exists

**Problem:** Creators, students, and builders juggle ChatGPT + Cursor + image tools + TTS apps. Tab chaos, different logins, paid walls everywhere.

**BUILDWE solution:** One cream-clean AI workspace — **Auto · Chat · Code · Image · Audio** — start free, upgrade only if needed.

**Who it’s for**
- Students (explain, notes, code homework)
- Indie founders (landing pages, copy, logos, voiceovers)
- Developers (scaffold apps, debug, multi-file canvas)
- Creators (scripts → voice, prompts → images)

**Promise:** *Build anything. Create everything.*

---

## 2. What we designed (UI / UX)

| Layer | Choice | Why |
|-------|--------|-----|
| Theme | Cream light `#F8F6F1` (not dark) | Premium, calm, Gen-Z clean — Apple/Linear/Notion feel |
| Accent | Terracotta `#C45C26` | Warm identity, not generic purple AI |
| Shell | 3-layer sidebar + mobile bottom tabs | Thumb-first, history always reachable |
| Modes | Auto + 4 tools | Auto routes intent; power users switch manually |
| Plans | Free default → PRO checkout | Honest freemium |
| Legal | /about /privacy /terms /pricing | Trust + compliance |

**Gen-Z style targets (this build)**
- Bigger type hierarchy, tighter cards, more whitespace
- Soft borders, minimal chrome, fast motion
- Model capability headlines on every tool
- Landing that sells the “one workspace” story in 5 seconds

---

## 3. What AI products usually need

1. **Auth** — guest + account, session  
2. **History** — chats/generations saved  
3. **Streaming** — token-by-token chat/code  
4. **Provider abstraction** — swap models without UI rewrite  
5. **Rate limits / fair use** — protect free keys  
6. **Usage metering** — free vs pro  
7. **File/canvas** — code projects  
8. **Media pipeline** — image/audio URLs + download  
9. **Billing** (optional) — PRO  
10. **Privacy/Terms**  
11. **Error + empty + loading states**  
12. **Mobile-first UX**

---

## 4. Current gaps (pre-this-build)

- Single 3k-line `page.tsx` — hard to maintain  
- AI mostly **demo** client-side  
- No real free DB/auth persistence server-side  
- Image/audio simulated  
- Frontend polish still “template-ish”  
- Model capabilities not marketed in UI headlines  

---

## 5. 100% FREE stack (A→Z)

| Need | Free choice |
|------|-------------|
| Hosting dev | Local / any free host later (Vercel free) |
| Auth | Guest cookie + email/password (scrypt) in local DB |
| Database | SQLite file via `better-sqlite3` **or** JSON store if native fails → **JSON file DB** (zero native deps) |
| Chat/Code LLM | **Groq free tier** + **OpenRouter free models** |
| Images | **Pollinations.ai** (no key) + optional Fal/HF |
| Audio | **Browser Web Speech** + optional OpenAI TTS if key |
| Payments | Optional demo PRO (no forced paid APIs) |
| Secrets | `.env.local` only |

---

## 6. Runtime brain (how a request works)

```
Client composer
  → POST /api/ai  { mode, messages|prompt, plan }
  → auth from cookie (guest or user)
  → rate limit (IP + user)
  → if mode=auto → detectIntent()
  → pickModel(capability, plan, complexity)
  → provider:
       chat/code → Groq / OpenRouter stream SSE
       image → Pollinations URL
       audio → return { type: 'browser-tts' } or TTS URL
  → save message/generation to DB
  → stream or JSON back
```

---

## 7. Build order (execute fully)

1. Free JSON DB + session auth  
2. Real `/api/ai` SSE + image + audio routes  
3. Split UI + Gen-Z cream redesign (landing + dashboard)  
4. Model capability headlines per mode  
5. Wire frontend to real APIs  
6. Debug, build pass, run server  

---

## 8. Model capability headlines (UI)

- **Auto** — “One prompt. The right tool.”  
- **Chat** — “Think deeper. Write clearer.”  
- **Code** — “Idea → working files.”  
- **Image** — “Text becomes visual.”  
- **Audio** — “Words become voice.”  
