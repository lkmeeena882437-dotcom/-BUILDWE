# BUILDWE → 1min.ai parity: master work list (no mocks, real only)

**Owner decision logged 2026-08-31:** boss does not want to micro-select waves — *"tum khud list bnaao sabhi kaamo ki aur requirements ke hisaab se banaaate jao"*. And: **"sara kaam real chaiye, koi demo ya mock nahi."**
So: this file is the queue. I pick order by dependency, work top-down, and **never ship a fake path**. Every task has an acceptance test that must pass before it's ticked.

**Standing rules derived from that instruction**
1. **No mock/demo fallbacks presented as product.** Where a provider key is missing, the route returns an honest 501/503 error — never a fabricated "success". (This also means deleting the demo paths we already have: `demoMode`, fake order ids, `amount: 0` verify, demo "PRO activated".)
2. **Requirement blocked → I ask, I don't stub.** If a task needs a key/account/money, it goes in the **Blocked** column of this file with the exact env var name, and I tell you in the reply. I do not fake it to make a demo look good.
3. **Definition of done** = `tsc --noEmit` clean + `next build` clean + the named acceptance check passes against the running dev server (curl/replay), plus no new ESLint errors.
4. Existing broken behavior I find while working gets logged in `scan/NEW-ISSUES.md`, fixed only if it blocks the task.

Companion doc: `docs/1MIN_AI_FEATURE_MAP.md` (the 126-item inventory this list is derived from).

**Progress log:** W0 ✅ 2026-08-31 → W1 ✅ code+tests 2026-08-31 (W1.11 his eye-test on a deploy) → next up W2 (credit economy).

---

## Wave 0 — Safety & honesty floor — **DONE 2026-08-31**
*Everything below is in-repo and shipped; no external key was needed.*

| ID | Task | Files | Status / evidence |
|---|---|---|---|
| W0.1 | Kill default-on demo mode; PRO impossible without a verified payment | `lib/config.ts`, `lib/payments/razorpay.ts` | ✅ `demoMode` now defaults **false** and is force-off in production; the demo accept-anything branch is gone. Test: *"C1: junk checkout payload cannot buy PRO"* passes on the fix and **fails on the old code** (A/B run: `2/8` passed pre-fix) |
| W0.2 | Checkout idempotency + amount check + server-side order lookup | `checkout/verify`, `checkout/order`, `lib/db/store.ts` | ✅ signature checked with `timingSafeEqual`, then `GET /v1/orders/{id}` must say `status=paid` and `amount_paid ≥ price`; ledger row must pre-exist, belong to the caller, and still be `created`; `markPaymentPaidIfPending` is a CAS so a replayed verify changes nothing. No `amount: 0` rows any more |
| W0.3 | Rate-limit identity can't be rotated away | new `lib/rate-limit/guard.ts`, `memory.ts`, 15 routes | ✅ `x-forwarded-for` is only read through `TRUST_PROXY_HOPS`; signup/login key on email; all `ai:*` routes key on the session id (IP removed). `tests/throttle.mjs`: **5/5** on the fix, **0/5** on the old code (rotating IPs → "blocked 0 → 200×8") |
| W0.4 | Stored XSS in shared conversations + attribute escaping | new `lib/safe-md.ts`, `app/s/[id]/page.tsx`, `app/page.tsx` | ✅ one hardened renderer for both surfaces: quotes escaped, `http/https/mailto` allow-list, fence labels allow-listed. `tests/markdown-xss.mjs`: **7/7** |
| W0.5 | Meter the free-load routes | `v1/chat`, `ai/compare`, `ai/transcribe`, `history` | ✅ dev API now needs a live user + `checkLimit` and records usage **only when a provider actually answered**; compare is charged per live lane (was 4 free calls ×10/min); transcribe/audio limited; history read throttled |
| W0.6 | Stop leaking internals | `lib/ai/stt.ts`, `app/api/health/route.ts` | ✅ no env-var names in user-facing copy; `/api/health` has no `demoMode`, no configured-vendor list |
| W0.7 | `/api/metrics` was public | `app/api/metrics/route.ts` | ✅ GET needs `BW_OPS_TOKEN` or an `ADMIN_EMAILS` session (test asserts 401); POST `kind` is allow-listed and `ms` clamped |
| W0.8 | Dev-only auth links behind a real gate | `auth/forgot`, `auth/reset` | ✅ `SHOW_DEV_LINKS` is ignored unless non-production (`ALLOW_DEV_AUTH_LINKS`); forgot is now throttled per email + per IP so it can't mint tokens forever |
| W0.9 | `/status` must tell the truth | `app/api/health/route.ts`, `app/status/page.tsx` | ✅ every row is a server-computed `{label,state,ok,detail,evidence}` triple with 4 real states; the page renders those rows verbatim (no local label table, no substring guessing, no dead `vision` label). 13 rows |
| W0.10 | Upload cap, single-use verify token, password floor | `ai/transcribe`, `auth/verify`, `auth/register`, `auth/reset` | ✅ 25 MB ceiling → 413; email-verify tokens land in `consumedTokens` and cannot be replayed; min password 8 on both signup and reset |
| W0.11 | Cross-process write safety | `lib/db/store.ts` | ✅ lock file (stale takeover) + three-way merge on write, plus `markPaymentPaidIfPending` CAS. `tests/store-concurrency.mjs` (two real servers, one store): **5/5**, and **1/5 on the old code** where "user count went backwards: 6" of 12. Still a stopgap — W6.1 (Postgres) is the real fix |
| W0.12 | LICENSE + dead deps + price truth | `LICENSE`, `package.json`, `app/page.tsx`, `app/pricing/page.tsx` | ✅ explicit "all rights reserved" file (flip it to MIT if you want open); `uuid`/`nanoid` removed; the three drifted prices ($5 / ₹500 / 50000 paise) now come from **one** source — `components/billing/useProPrice.ts` reads the same config the order endpoint charges |

**Also swept in (they were one-liners in files I was already in):**
the 7 `react/no-unsecured-entities` lint errors that would have broken the first CI run → **`eslint` now reports 0 errors / 15 warnings** (was 7 / 28); 11 routes' unused `rateLimit` imports removed; `gemma2-9b-it` (retired on Groq) out of the compare seats, seats now env-configurable; `/api/history` GET no longer answers `200 {conversations: []}` for a failed read, and DELETE no longer reports success on failure.

### Verification (all runnable, all committed)
```
npm run test:security    # 8/8   — money, metrics, XSS transport, history honesty
npm run test:markdown    # 7/7   — the renderer that is the actual XSS boundary
npm run test:throttle    # 5/5   — boots two throwaway servers, proves IP rotation is useless
npm run test:durability  # 5/5   — two servers on one JSON store, no lost writes
npx tsc --noEmit         # clean
npx next build           # clean
```
Each suite was also run **against the pre-fix code** (`git worktree` at HEAD) and fails there, so none of them are vacuous. `tests/harness.mjs` boots disposable servers on spare ports with their own data dirs — limit tests never depend on whatever a developer's warm `:3000` has already swallowed.

**Open, deliberately deferred from this wave:** CSP still carries `'unsafe-inline' 'unsafe-eval'` (needs a nonce pass; the tool pages were built to work with the existing CSP); `docs/PLATFORM_STATUS.md`'s invented test counts (Wave 8 housekeeping).
**Closed later the same day (W0.13 + key validation, with `test:auth`):** OAuth PKCE (S256, verifier cookie bound to the flow) and GitHub's unverified-`user.email` account-linking hole; BYOK key-shape validation on `POST /api/user/keys`.

---

## Wave 1 — Tool runner + writing/marketing/dev tools — **DONE 2026-08-31** (wiring proven; prose quality awaits his key)

| ID | Task | Result | Proof |
|---|---|---|---|
| W1.1 | Declarative tool spec | `lib/tools/types.ts` + `lib/tools/registry.ts`: **31 tools**, each = fields with hard caps, select allow-lists, sampling budget, and an output contract (`ToolChecks`). Prompt builders live only on the server; `/api/tools/[id]` serves a `publicTool` view with them stripped | `test:tools` "the public spec never leaks the prompt builders" |
| W1.2 | Run endpoint | `POST /api/tools/[id]` (SSE) + `GET /api/tools` catalogue. Per-tool rate window keyed on session, `checkLimit` **before** any call, `recordUsage(…, attempts)` after, 503 refusal when no live model is reachable | "missing required input is rejected before any model call", "with no live model the tool refuses instead of printing a template" |
| W1.3 | Tool UI | `components/tools/ToolRunner.tsx` renders itself entirely from the spec (zero per-tool JSX), streams, reports the contract result, Stop / Copy / Regenerate / Fill example | preview: any `/tools/*` page |
| W1.4 | The tool set | 31 shipped: blog-post, article, essay, paraphraser, grammar-checker · tweet, x-thread, instagram, facebook, linkedin-post, linkedin-comment, youtube-script, tiktok-hooks · ad-copy, product-description, slogan, press-release, seo-meta, brand-voice · email-writer, proposal · cover-letter, resume-summary, interview-prep · summarizer, meeting-notes, fact-check(hallucination check) · code-translator, code-explain, unit-tests, commit-message | "every registered tool accepts its own example and reaches the model" — one real run per tool, prompt inspected upstream |
| W1.5 | AI-content detector | **not shipped** (would need a trained classifier to be honest; `fact-check` ships the claim-extractor + live-search pipeline instead) | deferred list |
| W1.6 | Document translator | **not shipped** — needs the file-extract path rebuilt first | deferred list |
| W1.7 | Blog generator (outline → sections) | in `blog-post`: takeaways, 4–6 sections, CTA, `META:`/`SLUG:` lines, 4096-token budget, graded for headings/bullets/length | "a successful run builds the prompt server-side…" |
| W1.8 | 7 persona studios | `STUDIOS` + `/studios` + `/studios/[slug]` ×7 (`StudioRunner`). A studio = curated tool list + one shared instruction the runner appends; every tool is still graded by its own contract | catalogue assertions on studio↔tool references |
| W1.9 | Tool pages + SEO surface | `/tools/[slug]` ×31 static (`generateStaticParams`, `dynamicParams=false`), real title/description/OG per tool, all in `sitemap.ts`; tool pages render their contract into HTML | "tool pages render server-side" |
| W1.10 | `quality.ts` actually called | generic `qualityGate` **plus** per-tool `evaluateChecks`, one corrective regeneration, kept only if measurably better, and the verdict shown either way. `ai/code` also still uses it via the chat route | "a contract violation costs one corrective pass, and it is charged twice" |
| W1.11 | His eye-test on real output | **open — needs a deploy with his keys**, see below | — |

**Real bugs these tests caught (not reading-found, run-found):**
- `streamChatOrCode` returned only the *public* model label (`"BUILDWE AI"`), and a follow-up call was sent that label as the model → **every corrective pass would have died silently in production**. It now returns `modelId` (catalog id) which the retry uses, and `meta.modelId` + history carry it. Caught by the `X`/`Y` iteration on `test:tools`.
- `anyStreamToTextSSE` terminates its own stream with `{done:true}`; forwarding provider bytes raw made a client believe the run ended before grading, and a chunk boundary could cut a token in half. The runner now normalises frames with a carry-over buffer.
- GitHub sign-in linked accounts on `user.email`, which GitHub does **not** verify → anyone could attach a victim's address to their profile and log in as them. Verified-primary only now.
- OAuth had no PKCE; added (S256, verifier in an httpOnly cookie, bound to the same 10-minute window as `state`). `test:auth` runs the flow against a fixture IdP that enforces `S256(verifier) == challenge` like the real ones, so dropping PKCE fails the suite.
- IdP endpoints are now env-overridable (`GITHUB_AUTH_URL`/`_TOKEN_URL`/`_API_URL`, `GOOGLE_*`) — self-hosted IdP support, and the only reason the flow is testable at all.
- `POST /api/user/keys` accepted any 20-character string as a "key"; now `gsk_…` / `sk-or-v1-…` shapes or 422 with nothing written.
- `app/layout.tsx` was still quoting the old `$5/mo`; metadata + JSON-LD offers now come from `getCheckoutPublicConfig()` and the tool count from the registry.
- **Cacheable provider GETs.** Server-side `fetch` calls without an explicit `cache` can be served from Next's data cache. For an OAuth profile lookup that means signing in as *whoever was fetched last*: `test:auth` reproduced it (second sign-in received the first identity, and with it the wrong email link). Now `fetchWithTimeout` in the gateway defaults to `cache: "no-store"` — which also covers image/audio/STT provider status polling, where a cached GET would freeze a generation at "starting" — plus explicit `no-store` on the IdP profile/email/userinfo lookups. Media fetches and the Razorpay order read already had it.

| W1.12 | `no-store` on every server-side provider read | done — one default in the gateway, four explicit sites | `test:auth` "a sign-in never reads the IdP profile out of Next's data cache" (fails without the fix: `stale identity served`) |

**Verification block:** `test:tools` 13/13 · `test:auth` 12/12 · W0 suites still green (8/8, 7/7, 5/5, 5/5) · `tsc --noEmit` clean · `next build` clean, with all 31 tool pages + 7 studio pages prerendered as static HTML · **eslint 0 errors / 2 warnings** — and `npm run lint` now works out of the box (eslint + `eslint-config-next` added as devDependencies, `.eslintrc.json` committed).

**What is honestly NOT proven here:** the *quality of the prose*. This sandbox has no outbound network (`curl https://example.com` dies at TLS), so the suites drive the real provider adapter against a protocol-level OpenAI endpoint via `AI_BASE_URL_GROQ` — every layer of our own code is exercised over real HTTP, but no vendor's judgement is. W1.11 is his read-through on the Vercel deploy, where his Groq/OpenAI keys are already set.

**Blocked on you:** nothing for the code; **W1.11 needs the deploy** (and one honest favour: run 3–4 tools on real work of yours and tell me which tool's output is weak — the registry is data, so I fix prompts, not UI).

---

## Wave 2 — Credit economy — **DONE 2026-08-31** (16/16 `test:credits`; live money path awaits his Razorpay test-key eye)

His spec, taken literally: *"1 normal generation = 1 credit, heavy server tools 2–3, 10 free at signup so I can judge quality, ₹99 = 100 credits, ₹399 = 500 credits, price normally — don't complicate the system."* So the economy is **one flat price per artifact**, deliberately not a per-model exchange table: a meter people understand beats a meter that is precisely cost-matched.

| ID | Task | Shipped | Proof |
|---|---|---|---|
| W2.1 | Wallet + ledger | `Wallet` and `CreditRow` in `lib/db/store.ts` (`wallets`, `creditLedger` collections, per-user ledger retention 500), with the same read-modify-write lock as every other write. `reconcileWallet()` makes the **ledger** the truth and rebuilds the cached balance — money must not depend on a cache a crashed write left behind | "the balance survives a restart of the server" |
| W2.2 | Policy layer | `lib/credits.ts`: `holdCredits` (spend **before** the paid call), `refundCreditsFor` (guarded by `refId + ":refund"`, so a retry cannot double-refund), `chargeExtra` (a corrective pass is a second charge), `topUpCredits`, `creditSummary`, `creditGate`/`creditReceipt` for the direct artifact routes | "two failed runs leave the wallet exactly where it started" |
| W2.3 | Prices | `CREDITS.cost` in `lib/config.ts` — `tool 1`, heavy tools `creditCost: 2` declared per spec, `image 2`, `audio 1`, `transcribe 1`, `vision 1`, `agent 3`, `compareLane 1`, **`chat 0`**. Every number is `CREDIT_COST_*` env-overridable; packs are `CREDIT_PACK_*` | "packs and per-work costs come from config, and env overrides land" |
| W2.4 | Metering + refusal | `lib/tools/run.ts` holds first and returns **402 `INSUFFICIENT_CREDITS`** (with `balance`/`needed`/`packs`) before any provider call; refunds on quota refusal, a thrown provider error, `!out.live`, and an empty stream. `/api/ai/image`, `/audio`, `/transcribe`, `/vision`, `/compare` (per dead lane) and `/agent` (whole run) hold and refund through the same helpers. `browser-tts` is **refunded**: the browser's own speech engine cost us nothing | "a zero-balance account is refused before any paid call", "the image route holds 2 credits" |
| W2.5 | Grants | Welcome 10 minted inside `createUser`'s single write (guests get it lazily on first wallet read, cookie-scoped). PRO's monthly grant is `maybeGrantProMonthly`, keyed `pro:<YYYY-MM>:<userId>`, checked on wallet read — **no scheduler exists in this app**, so no cron was invented. Every grant is idempotent on `refId`, which is what makes a replayed verify or webhook unable to mint money twice | "signing up does not stack a second welcome grant on the guest one" |
| W2.6 | Top-up | `POST /api/checkout/order { pack }` creates a **real** Razorpay order (`createPackOrder`), stores `Payment{kind:"pack",packId,credits}`, and `/api/checkout/verify` marks it paid by CAS before minting — the amount is the server's, never the client's. `/api/checkout/webhook` does the same for `payment.captured` (Razorpay retries), and now **branches on the product**, so buying a pack no longer flips the account to PRO. With no keys on the server, both refuse loudly; a `order_demo_*` is unredeemable in every environment | "checkout refuses to sell anything while keys are unset, and mints nothing" |
| W2.7 | UI | `GET /api/credits` (wallet, price list, ledger — `no-store`), `components/billing/CreditsUI.tsx` (module store + header `WalletChip` + sheet with balance, "what costs what", packs, ledger), the runner's `done` frame carries `{charged, balance}` so the chip updates without a second request, a `N credits` tag on every Run button, `creditCost` on `/api/tools`, and a credits section on `/pricing` that reads the same numbers. A 402 from **any** studio opens the sheet | "a tool page states its price before the button is pressed" |
| W2.8 | Calculator | folded into `/pricing`: the whole cost table is rendered from the server's own response, so a price change cannot strand a page | — (see W2.3: one flat table) |
| W2.9 | Refund rules | The refund is structural, not a policy: nothing is kept for nothing. Packs don't expire while the account is open; a 30-day money-back claim is a human decision, so it lives in `/terms`, not in code that grants it | — |

**Two bugs the suite found in the running app** (neither was visible by reading the code):
1. `/api/tools/[id]` rebuilt its error body field-by-field, so the 402's `balance`/`needed`/`packs` were **dropped** → the UI could say "out of credits" but never "this costs 2, you have 0, top-ups start at ₹99".
2. The tool route only attached the guest cookie on success. A guest whose first request was a *failed* run never received their identity, so the welcome grant and the refund it just wrote stayed attached to an id the browser never got — simultaneously "my refund vanished" and "I can mint fresh 10-credit wallets by failing on purpose". Every response from that route now persists the guest.

**Also changed for the tests, not for the feature:** `next.config.js` honours `NEXT_DIST_DIR`, and the harness gives every disposable server its own build dir inside its temp data dir. Sharing one `.next` between concurrent `next dev` processes doesn't just slow things down — a second compile can hang forever, which showed up as a suite "unable to reach its own server". Production and normal dev still use `.next`.

**What is honestly NOT proven here:** that a pack purchase actually credits a wallet end to end. Everything up to the money is exercised (order creation, refusal paths, mint idempotency at the store level), but Razorpay's `paid` status and HMAC can only be confirmed against a real order — which is a 2-minute test on the Vercel deploy with his test keys in a browser.

**Blocked on you:** one Razorpay **test-key** checkout on the preview deploy (see W2.10 below), then a price read-through.

| W2.10 | On the preview: buy the ₹99 pack with a Razorpay **test** card, then (a) reload and confirm the credits are still there, (b) replay the same verify once more by refreshing and confirm the ledger does **not** pay out twice, (c) buy a pack on a PRO account and confirm the plan is untouched (that was the webhook bug) | his browser |

---

## Wave 3 — Chat depth (their flagship UX; our best existing asset)
| ID | Task | Requirement |
|---|---|---|
| W3.1 | `compare`: user picks N models (2–6) from catalog instead of 4 hard seats; retire `gemma2-9b-it`; honest per-lane cost preview | none |
| W3.2 | Answer merge / "mix models": combine picks into one synthesis + keep all lanes visible | W3.1 |
| W3.3 | `selectable` filter bug in dashboard (`m.all` ignoring it) + kill `coming_soon` in user-facing lists (A7) | none |
| W3.4 | Chat memory: `memories` collection + auto-extract + per-user toggle + "forget" UI | none |
| W3.5 | Multi-file/PDF chat: text layer **or** OCR path, chunking + citations | OCR provider decision (W7 OCR key or local) |
| W3.6 | Replace DDG scraping with a real search API + raise the 400-char snippet cap | **`SEARCH_API_KEY`** (Brave/Tavily/Serper — needs plan) |
| W3.7 | Deep-research runner: multi-step plan → gather → cited report, resumable, with budget cap | W3.6 |
| W3.8 | `publicModelLabel()` substring collapse → exact catalog lookup (A9) | none |
| W3.9 | Catalog breadth pass: rows + capability flags for the vendors we already connect to | provider keys to verify each |

**Blocked on you:** search API choice + key (W3.6) — DDG scraping is not "real".

---

## Wave 4 — Image generation, editing & layers
| ID | Task | Requirement |
|---|---|---|
| W4.1 | `lib/ai/image-edit.ts`: img2img + inpaint/outpaint via one aggregator (Fal **or** Replicate — pick one) | **`FAL_KEY` or `REPLICATE_API_TOKEN`** |
| W4.2 | Upscale (Real-ESRGAN class) | W4.1 |
| W4.3 | Background remove + replace | W4.1 |
| W4.4 | Object remove / erase (mask-driven) | W4.1 |
| W4.5 | In-image text remover | W4.1 |
| W4.6 | Search-and-replace object in image | W4.1 |
| W4.7 | Mask editor canvas UI (brush, polygon, feather) — the big front-end item | W4.1 |
| W4.8 | Image extender (outpaint) | W4.1 |
| W4.9 | Image→prompt (describe then verbalize as prompt) — reuse `understanding.ts` | none |
| W4.10 | Sketch→image, 3D-style generation | W4.1 |
| W4.11 | Variator (N variations from a seed/prompt) | W4.1 |
| W4.12 | Layers: multi-image composite with blend modes | W4.7 |
| W4.13 | Replace `ImageStudio.tsx` fake progress bar with real job states (queued/running/done) | none |
| W4.14 | Face swap (image) — **policy-gated: consent notice + no photos of real people without consent** | consent policy + provider |

**Blocked on you:** media provider account with credit card; per-image cost acceptance (~$0.003–0.05/image). Without it this whole wave is honest-error stubs and I will not pretend otherwise.

---

## Wave 5 — Voice & audio
| ID | Task | Requirement |
|---|---|---|
| W5.1 | Voice cloning (consent-gated) | **`ELEVENLABS_API_KEY`** |
| W5.2 | Voice design (create voice from description) | W5.1 |
| W5.3 | Voice changer (existing audio → new voice) | W5.1 |
| W5.4 | Voice isolator / noise removal | provider (LALAL.AI / Adobe-class) |
| W5.5 | Audio inpaint (regenerate a region) | provider |
| W5.6 | SFX + music generation (Stable Audio class) | **`STABILITY_API_KEY`** |
| W5.7 | Audio translator = STT → translate → TTS pipeline (our compose-not-buy path) | W5.1 |
| W5.8 | Captions generator: SRT/VTT/ASS export + burn-in, from STT + word timestamps | none |
| W5.9 | Fix `stt.ts`: no size cap, no timeout budget, key-name leak (A5) → also used by W5.8 | none |
| W5.10 | AudioStudio: real streaming playback + download + history | none |

**Blocked on you:** ElevenLabs + Stability keys (and the voice-cloning consent call — legal exposure is real).

---

## Wave 6 — Storage & durability (the true fix for W0.11)
| ID | Task | Requirement |
|---|---|---|
| W6.1 | Postgres/Supabase as primary store for users, projects, files, shares, payments, wallet, jobs | **a hosted Postgres** |
| W6.2 | Drop whole-JSON read-modify-write in production paths; keep JSON only as no-DB dev mode | W6.1 |
| W6.3 | Async job queue (generate/edit/transcribe jobs) with status polling + retries | W6.1 |
| W6.4 | Object storage for media (Supabase Storage / S3) — no more `/tmp` reliance | storage bucket |
| W6.5 | Retention policy per plan (their "3 days / 3 months / unlimited") + purge job | **decision: retention** |
| W6.6 | Backups + restore runbook doc | none |

---

## Wave 7 — Agents, schedules, connectors
| ID | Task | Requirement |
|---|---|---|
| W7.1 | Replace regex-scrape tool resolution in `agent.ts` with schema-validated tool calls | none |
| W7.2 | `POST /api/agent/run` auth'd + rate-limited + credit-charged (currently unauth'd) | W7.1, W2.2 |
| W7.3 | `user/skills` actually consumed by the router (dead today) | none |
| W7.4 | Scheduled agents (cron) + run history + failure notifications | W6.1 |
| W7.5 | X / LinkedIn / Instagram / Facebook / Threads connectors (OAuth + publish) | **each platform's app review** — slow, external |
| W7.6 | Content-calendar artifact type (week view, draft → queue → publish) | W7.5 |
| W7.7 | YouTube connector (upload + captions + localized metadata) | Google OAuth scope approval |
| W7.8 | Industry-trend monitor (digest on a schedule, sources config) | W3.6 |

**Blocked on you:** platform developer accounts + app review per network. Expect days-to-weeks of approval, not code time.

---

## Wave 8 — SEO engine & locales (marketing surface, cheap once tools exist)
| ID | Task | Requirement |
|---|---|---|
| W8.1 | `generateStaticParams` for `/tools/[slug]` + `/models/[slug]` + `/features/[slug]` with real content | waves 1–5 |
| W8.2 | Split sitemap into per-type files (`sitemap-0.xml` index + sections) | W8.1 |
| W8.3 | `metadataBase` on every page (fixes relative-URL OG bug from the 2026-08 audit) | none |
| W8.4 | OG image generation per tool/model (real `ImageResponse`) | none |
| W8.5 | Comparisons + alternatives pages (10–15 initial, honest content) | copy decision |
| W8.6 | `robots.txt` + canonical handling | none |
| W8.7 | i18n scaffolding: `en` + `hi` first, 5 locales max at start | translation review |
| W8.8 | 404 / not-found page, `sitemap` in nav footer | none |

---

## Wave 9 — Verification & quality bar (runs continuously, sized here)
| ID | Task | Requirement |
|---|---|---|
| W9.1 | CI (toolchain half **done**): `tsc --noEmit` + `eslint` + `next build` + Playwright smoke on 5 routes. **Toolchain half is done:** `eslint@8.57.1` + `eslint-config-next` are now devDependencies with a committed `.eslintrc.json`, so `npm run lint` runs in CI without an interactive prompt. Still needed: a workflow file (or his `gh` secret for Checks) | repo CI access |
| W9.1b | CI workflow **written and validated**, parked at `docs/ci/github-actions.ci.yml`: `checks` (tsc → lint → build) + `suites` (all six `npm run test:*`), on push to `main`/`arena/**` and PRs. It cannot be *placed* by me — GitHub refuses any push touching `.github/workflows/` without the `workflows` permission (`remote rejected: refusing to allow a GitHub App to create or update workflow`), and one `git mv` enables it | **you: `git mv` (or grant `workflows: write`)** |
| W9.2 | ~~Fix the 7 ESLint errors~~ **done in W0** — 0 errors / 2 warnings left (`app/layout.tsx` `no-page-custom-font`, which is a Pages-Router rule that doesn't apply under `app/`; and `components/AdSlot.tsx`'s unnecessary `useMemo` dep) | none |
| W9.3 | `tests/` with real assertions: **done for** auth+verify-token replay (W0), checkout double-redeem (W0), rate-limit bypass (W0), share-page escaping (W0), tool contracts + metering (W1), OAuth PKCE (W1). Still owed: credit math (W2), login/reset flows end-to-end | none |
| W9.4 | `noUncheckedIndexedAccess` + shared TS config for tests | none |
| W9.5 | Dep audit: pin/patch `next` (GHSA-955p-7x2x-c27v), remove dead deps | none |
| W9.6 | Playwright e2e matrix: desktop + mobile viewport, chat → image → audio flows | none |
| W9.7 | Error budget: every `catch {}` that swallows → logged with context; 36 sites | none |

---

## Explicitly deferred (and why)
| Item | Why deferred |
|---|---|
| Native desktop apps (macOS/Windows) | Separate repos + signing/notarization + update infra. PWA covers the need until there are users. |
| iOS/Android stores | Needs Apple/Google accounts ($99/yr + review), and a store-ready product; re-visit after Wave 8 |
| Their exact 20-locale crawlability | 5 locales is a real decision; 20 is a content operation, not a feature |
| Copying `AdSlot` removal | Our ads are our revenue path — but must fix `useMemo` non-rotation (A8) before counting it "done" |
| 1:1 credit-for-credit pricing parity | Their per-feature credit prices are not public; ours must come from **our** real costs (W2.3) |

## What I need from you (single list, nothing else blocking)
0. **One LLM key — `GROQ_API_KEY` (free tier, fastest to get) or `OPENAI_API_KEY` / `OPENROUTER_API_KEY`.**
   Without any of these, *chat itself* is offline: every AI route currently answers with the
   labelled fallback ("Offline mode — no live model is reachable right now"), which is honest but
   is not a real model. You said everything must be real, so this is the single highest-value key
   in the list — I cannot verify one word of Wave 1's tool output quality without it, and the
   sandbox here has no outbound network to any provider either.
1. **Razorpay keys** — set by him in Vercel on 2026-08-31, so nothing is blocked on me: what is left is his one test-card checkout on the preview (W2.10). If `RAZORPAY_WEBHOOK_SECRET` is not also set, say so: without it a buyer who closes the tab mid-payment is only made whole by the interactive verify path.
2. **One media provider account:** Fal **or** Replicate key (unlocks all of Wave 4 + face swap + upscaling).
3. **ElevenLabs + Stability keys** (Wave 5).
4. **A search API key** (Brave/Tavily/Serper) — DDG scraping is fragile and not "real".
5. **A hosted Postgres/Supabase URL** (Wave 6) — JSON store under load loses data; that's already proven in this repo.
6. **Three policy decisions:** voice-cloning consent policy · face-swap allowed or not · data retention days per plan.

Until 1–5 arrive, Waves 0, 1, 3(partial), 7.1–7.4, 8, 9 proceed — those need no external keys, which is why I started with them.

---

## Wave 10 — UI surfaces (prompt pill, flyouts, pricing table, link previews, chat→workspace) — **IN PROGRESS — approved 2026-08-31, Step 1 DONE (`test:ui` 14/14, app HTML unchanged)**

His 9-item UI/UX brief (2026-08-31). Full step-by-step plan, file:line scan of what already
exists, reuse contract, verification protocol and risk table: **`docs/UI_UPGRADE_PLAN.md`**.
No code in that branch of work has been written yet; the scan is what it produced.

| Step | What | Needs |
|---|---|---|
| 1 ✅ | `lib/ui/` primitives: `useDismiss`, `Popover`, `MenuRow`, `SegmentedControl` + dark-surface tokens (zero visible change) | none |
| 2–3 | Prompt bar → sticky pill (`components/workspace/PromptBar.tsx`), IME-safe Enter, paste/drop attach | none |
| 4 | Attachment menu (drop-up, icon+title+subtitle rows, click-away) | none |
| 5 | Mode selector as rich dropdown w/ chevron flip | none |
| 6 | Sidebar profile **flyout** + cascading theme submenu + categorized sections | none |
| 7 | `/pricing`: 4 real tiers + Personal/Business sliding segmented control; 7b = seat-aware orders in `lib/payments/razorpay.ts` + `/api/teams` enforcement | 7b touches money |
| 8 | Rich link preview + `lib/net/ssrf.ts` (no SSRF guard exists today) | sandbox has no egress → protocol-level local tests, live check on Vercel |
| 9 | Chat → workspace context (open file in, `buildwe-file` block, Apply to file) | none |
| 10 | Artifacts list/pin/restore (reuses `canvasVersions`) | none |
| 11 | Sweep: all popovers on `useDismiss`, focus trap/`inert`, ⌘K palette, `/` and `Esc` shortcuts, hex-colour lint rule, `/status` rows, tests in `npm test` | optional neon rebrand = his call |

Sequencing rule agreed: one step at a time, each one gets a 2–4 item preview test script, then
his `next` before I continue. Money changes stay in their own commit.
