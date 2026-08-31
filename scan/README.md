# BUILDWE — Full File Scan

**Date:** 31 Aug 2026 · **Commit scanned:** `2f6ad80` (tree = GitHub `origin/main`, verified byte-identical: 125 files, zero diff)
**Scope:** every tracked file. 103 code/config files (20,301 lines) + 22 docs. Nothing sampled — **sab files scan hue**.

## Kya-kya hai yahan

| File | Kya hai |
|---|---|
| `METRICS.csv` | **har file ka row** — lines, bytes, exports, `empty catch` count, lint issues, TODO count |
| `API-ROUTES.csv` | **40 API routes ka guard matrix** — auth / rate-limiter / durable? / zod / quota / fetch-timeout / try-catch / verdict |
| `FINDINGS-BY-FILE.md` | **per-file verdict** — har file ke saamne kya mila, line number ke saath |
| `NEW-ISSUES.md` | is deep pass me mile **naye 13 issues (A1–A13)** + pichhle review ki **5 self-corrections** + 15-row fix table |
| `FINDINGS-BY-FILE.md` ka top finding | 🔴 `/status` page — 9 rows me se **7 kabhi change nahi ho sakte** (badge = static string ka substring test). Live-verified. |

## Method (reproduce karne layk)

```bash
npm i -D eslint@8.57.0 eslint-config-next@14.2.35 @typescript-eslint/eslint-plugin @typescript-eslint/parser
npx eslint . -f json -o /tmp/eslint.json          # 35 issues, 7 real errors
npx tsc --noEmit                                    # clean
npm run build                                       # clean, 40 routes + 16 pages
```
Plus: har API route ka source padha, guard presence regex se extract kiya (script: `scan/../` me nahi, ad-hoc tha), aur 4 critical findings live server pe curl se exploit kiye (wo `docs/REVIEW_FULL_2026-08-31.md` me hain).

> **Note:** lint ke liye jo temp `.eslintrc.tmp.json` banaya tha wo hata diya gaya hai aur `package.json` revert kar diya gaya hai — repo waisa hi hai jaisa tha. Par **eslint config add karna khud ek P1 fix hai** (dekho `docs/REVIEW_FULL_2026-08-31.md` §5 H4: `npm run lint` aaj interactive prompt pe hang hota hai).

## Top-line numbers

```
files scanned            103 code + 22 docs
total code lines      20,301
TypeScript               ✅ 0 errors
next build               ✅ 0 errors
ESLint                   7 errors, 28 warnings
  └ @typescript-eslint/no-unused-vars      25
  └ react/no-unescaped-entities            7   ← actual ERRORS
  └ @next/next/no-page-custom-font          1
  └ no-empty (empty block)                  1
  └ react-hooks/exhaustive-deps             1
empty `catch {}` blocks                    36   ← silent-failure pattern
API routes                40
  ├ with session check    26  (14 me nahi — 8 legitimately public)
  ├ with rate limiter     18  ← 22 routes UNLIMITED
  ├ with durable limiter  14
  ├ with zod schema        2  ← 38/40 bina validation
  └ with quota checkLimit  7  ← 33/40 bina quota
```

## Ek-nazari verdict

| Area | Files | Status |
|---|---|---|
| `lib/db/store.ts` | 1 | 🔴 engine hi sabse badi kami (JSON file, last-write-wins across processes) |
| `lib/payments/` | 1 | 🔴 demo mode = free PRO |
| `app/s/[id]/page.tsx` | 1 | 🔴 stored XSS (markdown link attr injection) |
| `lib/rate-limit/` | 2 | 🔴 XFF spoofable → har IP limit bypass |
| `app/api/v1/chat`, `ai/compare`, `ai/transcribe`, `ai/search`, `ai/verify` | 5 | 🟠 provider calls with **no quota** |
| `lib/ai/` | 16 | 🟡 architecture accha; catalog hygiene kharab (dead providers, retired model ids) |
| `app/page.tsx` | 1 | 🟠 3,934 lines / 3,317-line component / 92 `useState` |
| pages (`app/*/page.tsx`) | 16 | 🟢 kaam karte hain; 7 unescaped-entity errors + pricing contradiction |
| components | 7 | 🟡 chhoti-gandi bugs (AdSlot, ImageStudio retry) |
| config / infra | 7 | 🟠 CSP wide, no CI, no tests, no LICENSE, 2 npm HIGH vulns |
| docs | 14 | 🟠 stale + unverifiable claims |

`FINDINGS-BY-FILE.md` me har file ka alag verdict hai.
