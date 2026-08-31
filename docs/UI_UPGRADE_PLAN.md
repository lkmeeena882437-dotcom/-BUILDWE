# UI Upgrade Plan — prompt bar, flyouts, pricing table, link previews, chat→workspace

**Status: `APPROVED` received 2026-08-31. Steps run one at a time, each verified before the next.**

| Step | State | Evidence |
|---|---|---|
| 1 `lib/ui` primitives + tokens + `/dev/ui-lab` | **DONE** | `test:ui` **14/14** (placement math compiled from the real module + live SSR markup + the CSS the page loads); `tsc` 0; `next lint` 0 new warnings; `next build` exit 0; `/`, `/pricing`, `/tools/blog-post` server HTML **byte-identical** to the pre-change baseline; all 6 other suites green (8/7/12/13/5 + credits 16/16, durability 5/5) |
| 2 pill (extract + sticky + IME-safe Enter) + `lib/ui/Btn` extraction | **DONE** | `test:ui` **18/18** incl. a real inert render of `PromptBar`, a literal-by-literal parity list and a prop-declaration vs prop-passed diff; `/`, `/pricing`, `/tools/blog-post` HTML still byte-identical; build 0; `/` First Load 143→150 kB (measured `main` = 137 kB) | 2b improvement pass on Steps 1–2 (his standing ask) | **DONE** | `test:ui` **24/24** — 6 new checks, each one guarding a specific fix below |
| 3–11 queued — Step 3 on his `next` |

Two things Step 1 discovered and fixed in itself: `useDismiss` now honours the popover's *own*
trigger (`aria-controls` match) so an absolutely positioned menu cannot flicker shut-and-reopen
when its button is clicked, and `MenuRow` carries `rowRole` because `aria-checked` on a
`menuitem` is an ARIA violation the linter flagged on the first run.
Branch: `arena/01a0568a-buildwe` (PR #4 stays open and unmerged — every step below stacks on this branch, so the PR grows and one final merge lands everything in `main` at once).

---

## 0. What the scan found (read this first — it changes the shape of the work)

Your list asks for several things that **already exist** in this repo, in a rougher form. I am not going to rebuild them next to the originals: a second copy of a component that can drift from the first is exactly the class of bug this repo has been audited for (the `$5 / ₹500 / 50000 paise` price drift, the duplicated tool catalogue in the sidebar). So each row below says *upgrade X at file:line*, not *create X*.

| Your ask | What is already in the code | Real gap |
|---|---|---|
| 1. Sticky pill prompt bar, auto-expand, leading `+`, trailing actions, focus ring | `app/page.tsx:2786–2995` — composer with `rounded-3xl` card, `<textarea rows=1>` + `grow()` (`app/page.tsx:784`, 96px mobile / 128px desktop cap), attachment chip, 5 mode chips, style popover, web-search, compare, image-attach, file-attach, mic, send/stop | It is a **flex footer**, not a sticky pill; no `+` affordance (attach is two icon buttons); focus ring only via global `:focus-visible`; `Enter` does not respect IME composition |
| 2. Fixed left sidebar + profile trigger + dark anchored flyout + cascading submenus + click-away | `app/page.tsx:2034–2270` — real `<aside>`, collapsible (`sidebarOpen`, `w-[260px]`↔`w-[72px]`), nav sections, History list in `min-h-0 flex-1 overflow-y-auto` (`:2221`), profile row at the bottom (`:2258`) | Profile opens a **full Sheet modal** (`setModal("profile")`), not an anchored flyout; no submenu; the app's only dismiss idiom today is a `fixed inset-0` invisible button (used at `:2910`, `:3046`) |
| 3. 4-column dark pricing table, segmented control with sliding indicator, 3rd card "Recommended", 1st card CTA disabled | `app/pricing/page.tsx` — 2 cards (Free/PRO) + the credits section added in Wave 2; `app/page.tsx:3859` has a 2-tab segmented control (no sliding indicator); `Btn` already has `disabled:opacity-40 disabled:pointer-events-none` | 4 tiers + Personal/Business. **Business has no billing today**: `createProOrder` charges one fixed `RAZORPAY.amountPaise` |
| 4. Attachment menu (drop-up, icon+title+subtitle rows, grey hover, click-away) | the two hidden `<input type=file>` elements and their handlers (`app/page.tsx:2861–2899`) | no menu at all today — this is genuinely new |
| 5. Rich dropdown mode selector (chevron flip, two-line items, 1px dividers) | `MODE_META` chips (`:2848`) + `switchMode` (`:797`) which already aborts a running stream | no dropdown; new |
| 6. Chat-to-workspace: categorized sidebar, artifacts, dynamic right panel, VFS, context-aware chat | `app/page.tsx:3005–3400` — right panel on `var(--code-bg)` with `code / preview / files` tabs, version history w/ restore (`pushCanvasVersion` `:902`), agent log; VFS API `app/api/projects/files/route.ts` (GET/POST/DELETE, per-user retention); **agent** already gets `canvasCode` + project files as context (`app/api/ai/agent`) | **Chat has no workspace context**: `app/api/ai/chat/route.ts` accepts `body.projectId` only to attach the conversation to a project — the model never sees the open file, so it rewrites code in the chat instead of updating the file. No "artifact" entity; `canvasVersions` is the only versioning |
| 8. Rich link preview | `lib/safe-md.ts:107` renders `[x](url)` → `<a target=_blank rel=noopener noreferrer nofollow ugc>`; `safeHref` allow-lists schemes | no preview, **and no SSRF guard anywhere in the repo** (`grep` for private-IP blocking: nothing) |
| 9. Auth modal (header, SSO, "OR USE EMAIL", segmented tabs, inputs, CTA) | `app/page.tsx:3773–3894` `AuthSheet` — Google/GitHub links, `or use email` divider (`:3857`), log-in/sign-up tabs (`:3861`), forgot-password view, busy CTA | it is a bottom **Sheet**, not a centered modal; the tabs are a plain 2-button row |

### 0.1 Design system — one honest correction

Your brief mentions **cyberpunk/neon**. This codebase is not that, and nothing in it is: the product runs a **warm-paper** system — Inter, `--bg #F7F4EE`, `--ink #14110F`, `--accent #C45C26`, 16px radius, `shadow-soft/lift`, and a deliberate motion language (`--dur-fast 120ms / --dur 180ms / --dur-slow 280ms`, `cubic-bezier(.2,.8,.3,1)`, `anim-rise`, `anim-sheet`, `shimmer`, `typing-caret`) in `app/globals.css:1–365`.

It also already has **a real dark theme**: `tailwind.config.js` sets `darkMode: "class"`, `.dark` overrides every token (`globals.css:29–44`, plus dark semantic states at `:244`), and `app/page.tsx:591–602` toggles it from a `system | light | dark` preference. The one permanently-dark surface is the code/agent panel (`var(--code-bg)`), which is where your "dark popover" instinct already matches the product.

**Decision (mine, and I will not re-ask): every "dark-themed" item below is built on the existing token layer** — popovers/menus get a `--surface-dark` pair that in Light mode renders the code-panel dark (so the flyout looks like the thing next to it) and in Dark mode renders the theme's own elevated card. That satisfies "dark-themed popover, fade-in, hover highlight" without a second palette, without touching 63 existing pages, and without violating your own rule 4. A full neon rebrand is a *different* project — I put it at the end as optional Step 11 with its blast radius, so you can say yes/no later instead of me deciding it silently.

### 0.2 Reuse contract (so "reuse existing UI components" is checkable, not a promise)

New code may import: `Btn`, `Sheet`, `clsx`, `lucide-react` icons, `bw-badge*`, `anim-rise`, `anim-sheet`, `shimmer`, `--dur*`, `--ease`, `prose-bw`. New code may **not**: add a CSS-in-JS lib, add a headless-UI dependency, add a font, copy `Btn` into a local variant, or hard-code a hex colour that already has a token (eslint rule check in Step 11).

---

## 1. Execution plan — 11 steps, one at a time, each independently verifiable

Order is dependency-first: primitives before surfaces, surfaces before money, money before merge. Each step = one commit + one preview test by you + `tsc`/`lint`/affected-suite by me. Nothing in step N depends on step N+2.

### Step 1 — Shared primitives (no visible change on purpose)
**Files:** `lib/ui/useDismiss.ts` (new), `lib/ui/Popover.tsx` (new), `lib/ui/MenuRow.tsx` (new), `lib/ui/SegmentedControl.tsx` (new), `app/globals.css` (add `--surface-dark`, `--surface-dark-border`, `.bw-popover`, `.bw-popover-dark`, `.bw-menu-divider`, `.bw-focus-ring`, `@keyframes bw-pop-in`), `lib/ui/README.md`.
**Behaviour:** `useDismiss({open, onClose})` = Escape + `pointerdown` outside (with `rootRef`), returns `{ref, withinTrigger}`; focus returns to the trigger on close; `aria-expanded`/`aria-controls` wiring helper; `role="menu"` + arrow-key/`Home`/`End`/`Enter` nav; scroll-lock NOT used (a popover must not lock the page).
`Popover` props: `placement: "top" | "bottom"`, `align: "start" | "end"`, origin-correct animation (`anim-rise` for bottom, a new `scale(.97)→1` for top), `z-50`, `max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain`.
`SegmentedControl` = the sliding indicator you asked for: a positioned pill moved by `transform: translateX()` derived from the measured button widths, `transition: transform var(--dur) var(--ease)`, `role="tablist"`, arrow-key support, respects `prefers-reduced-motion` (already global).
**Why first:** steps 2–9 all need these; doing them per-step is how you get four slightly different click-away implementations.
**Verification:** `tsc`, `next build` clean, and a new `tests/ui.mjs` case asserting the CSS classes exist in the built CSS and that `/` still renders byte-identically (a "nothing changed yet" guard).
**Risk:** zero visible surface; the only shared file touched is `globals.css` (additive).

### Step 2 — Prompt bar: sticky pill (your item 1)
**Files:** new `components/workspace/PromptBar.tsx` (extracted from `app/page.tsx:2786–2995`), `app/page.tsx` (render `<PromptBar …props>` instead of inline markup), `globals.css` (`.bw-pill`, `.bw-pill:focus-within`).
**Kept exactly:** `grow()` heights and its mode-change effect, `Enter`/`Shift+Enter`, attachment chip + `setAttachment(null)`, the file-size limits (200 KB text, 5 MB image) and their error strings, `analyzeFileApi` flow, mic via `SpeechRecognition` with the "Use Chrome" note, send/stop swap while `streaming || imgLoading || audioBusy || visionBusy`, `disabled={!input.trim() && !attachment}`, the error row with Upgrade/Try-again, the streaming status line.
**Changed:** container = `rounded-[28px]` pill, `sticky bottom-0` **inside the existing scroll container** (not `position: fixed` — a fixed bar would collide with the mobile nav at `app/page.tsx:3376` and break the `pb-mobile-nav` padding; sticky-in-scroller gives the same visual result and keeps `--safe-b`), backdrop `color-mix(in srgb, var(--bg-elevated) 95%, transparent)`, `box-shadow: var(--shadow-1)` → `--shadow-2` on focus-within, `border-color` ring transition (`--dur`) + `--accent` ring on focus-within, leading `+` button (opens Step 4's menu), trailing group = mode trigger (Step 5) + style + web + compare + mic + send, all `Btn variant="icon" size="sm"` (existing).
**New fix found while scanning:** `onKeyDown` sends on Enter even while an IME is composing — a Hindi/Devanagari input gets sent mid-word. Add `if (e.nativeEvent.isComposing) return;` (one line, real user bug for you).
**Verification:** `tsc`; `tests/ui.mjs` asserts `sticky bottom-0`, `aria-label="Send"`, `min-h-[48px]`, and that the old markup is gone (no duplicate composer); you test: type, resize window, mobile scroll, Enter/Shift+Enter, mic, attach, stop-mid-stream, guest-mode line.
**Rollback:** revert 1 commit; the inline composer returns.

### Step 3 — Composer polish inside the same pill
**Files:** `PromptBar.tsx`, `globals.css`.
**Content:** paste-an-image (clipboard `paste` handler → reuses `setAttachment`), a character-count hint that only appears at >75% of `INPUT_LIMITS.messageChars` (the server rejects above it; the UI currently says nothing until the 413), and `⌘/Ctrl+Enter` as an alternate send. Drag-drop onto the pill → same two file handlers (no new limits).
**Verification:** `tests/ui.mjs` (drop/paste handlers present, hint markup), preview check by you.

### Step 4 — Attachment menu (your item 4)
**Files:** new `components/workspace/AttachmentMenu.tsx`, `PromptBar.tsx`, `app/page.tsx` (move the two hidden inputs + `newFilePath`/record handlers into refs exposed to the menu — same code, new owner).
**Rows (each real, each already-implemented action):** `Attach image → vision`, `Attach text / CSV file`, `Paste a link to preview it` (Step 8's client hook), `Record voice note` (existing `transcribe` route + `app/api/ai/transcribe`), `Use a /tools generator` (link, not a duplicate of the tool page), `Clear attachment` (disabled when none — `Btn`'s disabled idiom).
**Markup per row:** 16px `lucide` icon left, title 13px, muted subtitle 11px, `bg-[var(--surface-dark-hover)]`-style grey hover (one class), `role="menuitem"`, dividers only where a group ends. Drop-up: `placement="top"`, `align="start"`, closes on outside click / Escape / action.
**Verification:** rows present in DOM after click can't be curl-tested (client-only), so: `tests/ui.mjs` asserts every row's `data-action` exists and maps to a handler name present in the bundle; plus an honest line in the PR: "menu interaction verified in the preview by the owner".
**Note:** no row that does nothing. If a row's backend is missing, the row is not in the menu.

### Step 5 — Mode selector (your item 5)
**Files:** `PromptBar.tsx`, new `components/workspace/ModeMenu.tsx`, `app/page.tsx` (`switchMode` untouched).
**Content:** trigger = active mode icon + label + `ChevronDown` that rotates 180° when open (`transition: transform var(--dur)`); popover = 5 two-line rows with dividers; current row gets a `Check`; opening aborts nothing (the *pick* calls `switchMode`, which keeps its existing "abort the running stream" behaviour); keyboard `↑↓Enter`, `Esc` closes and restores focus; on `<sm` the trigger shows the icon only (labels hidden as today).
**Verification:** SSR markup test (`tests/ui.mjs`: trigger label + 5 `data-mode` values in the client payload is not SSR-visible, so assert the component is rendered from `MODE_META.length` and the ids match `/api/ai/*` route names) + preview click-through by you.

### Step 6 — Sidebar: profile flyout with cascading submenu (your item 2)
**Files:** `app/page.tsx` (aside bottom block `:2250–2272`), new `components/workspace/ProfileFlyout.tsx`.
**Content:** the profile row becomes `aria-haspopup="menu" aria-expanded`; menu anchors **above-right** of the trigger (`absolute bottom-full left-0 mb-2`, `origin-bottom-left`, `anim-rise` + scale-in), dark surface, rows: `Plan · Free/PRO` → opens existing plans sheet, `Credits · {balance}` → `openCredits()` (existing store — no new billing UI), `Settings`, `Teams`, `API keys (BYOK)`, `Theme ▸` **cascading submenu** (System/Light/Dark → calls the existing `setThemePref`; submenu opens to the right, flips to the left when `getBoundingClientRect().right + 240 > innerWidth`), `Log out`. All the deep forms stay in the current `Sheet`s — the flyout is a launcher, not a second settings screen.
**Sidebar internals:** history list keeps its `min-h-0 flex-1 overflow-y-auto` (already correct), gets a category group header for `Chats / Projects / Teams` + collapse per group (your "SS2-style categorized sidebar"), and `scrollbar-gutter: stable` so the list doesn't jump when the flyout opens.
**Verification:** `tests/ui.mjs` asserts the aside renders `role="button" aria-haspopup="menu"`, that theme rows call the same three `ThemePref` values as the settings sheet (source-level check), and that no Settings feature became unreachable (grep each `setModal("…")` still exists).

### Step 7 — Pricing: 4 tiers + Personal/Business toggle (your item 3)
**7a. Layout (UI only).** `/pricing` gets `grid md:grid-cols-4`, `SegmentedControl` (Personal | Business) with the sliding indicator, 3rd card = `Recommended` top badge + `border-[var(--accent)]` + primary CTA, 1st card CTA `disabled` with label "You're on this plan" (true for a signed-in free user, and *not* disabled for a guest, where it means "continue free" — honesty over pixel-matching the mock), feature lists with 14px `Check`/`X` icons `inline-flex items-center`, hover transitions on active CTAs only. Tiers = the four things that actually exist today: `Free`, `Starter credits ₹99`, `PRO (Recommended)`, `Value credits ₹399`. Prices come from `GET /api/checkout/order` + `GET /api/credits` (the existing server-owned numbers) — nothing hand-typed, per audit A6.
**7b. Business = seats, made real (touches money).** Business column shows `PRO · ₹{price} × seats`. Server side: `POST /api/checkout/order { seats }` → `amountPaise = RAZORPAY.amountPaise × seats`, `notes.product = "buildwe_pro"`, `notes.seats`, `Payment.seats`; a seat-count selector (`1–10`) in the card; verify/webhook grant stays idempotent (money rules unchanged, one new field). Enforcement: `/api/teams` seat checks read `Payment`/`plan` — today teams are unlimited; with Business, `MAX_FREE_TEAM_SEATS = 1`, pro seats = plan seats.
**Decision:** I will not ship the Business toggle in 7a **without** 7b. A toggle that prices things it can't charge is exactly the fake path you banned. If you want the visual 7a now, I'll render Business rows as "teams billing lands in this wave" disabled state — your call inside the `APPROVED` message, default = do 7a+7b together.
**Verification:** new `tests/pricing.mjs`: `GET /pricing` HTML contains 4 cards + `Recommended` + a `disabled` first CTA; the order route with `{seats:3}` returns `amount === 3 × configured paise` and refuses `seats:0/99`; forged `seats` in verify cannot change the paid amount (the CAS + `pay.amount < expected` check already exists); the existing `test:security` + `test:credits` suites stay green.

### Step 8 — Rich link preview (your item 8) + the SSRF work it requires
**Files:** new `lib/net/ssrf.ts` (scheme allow-list http/https; resolve hostname, refuse private/loopback/link-local/unique-local ranges incl. `169.254.169.254`; max 5 redirects re-validated per hop; 8s timeout; 256 KB body cap; no `Authorization` forwarding), new `app/api/preview/route.ts` (`GET ?url=`, `cache: "no-store"`, rate-limited via `limitAi("preview", …)`, result cached in a new `linkPreviews` store collection with a per-host TTL), new `components/chat/LinkPreview.tsx` (card: favicon, title, 1-line description, host, optional `og:image` **served through the same guard** as a proxied `<img>` only if we later add storage — until then remote `<img>` with `referrerPolicy="no-referrer"`), renderer hook in `lib/safe-md.ts`'s caller (not inside the sanitizer: it must stay a pure string fn) + `app/s/[id]` share page.
**Where cards appear:** one card per **unique** URL per message, after the paragraph containing it, in chat and share pages. Not inside tool output (tool answers are prose the user copies — a card would corrupt the copy).
**Verification (local, real, no mock):** `tests/preview.mjs` boots a localhost HTTP fixture that serves genuine `og:` HTML → asserts parse; then asserts refusals: `http://127.0.0.1:3000/`, `http://[::1]/`, `http://169.254.169.254/latest/meta-data/`, `file:///etc/passwd`, `javascript:alert(1)`, a redirect loop, an oversized body, and a slow server (timeout). That is a protocol-level test of the guard, not a unit test of a fake.
**Honest limit:** real outbound fetch to arbitrary public sites needs your Vercel deploy (this sandbox has no egress); the parser, cache, refusal list and rendering are all proven here.

### Step 9 — Chat-to-workspace context (your item 6, the part with real teeth)
**Files:** `app/api/ai/chat/route.ts` + `/code` (accept `context: {projectId, path}` — same validation style as today), new `lib/ai/workspace-context.ts` (reads the open file + up to N siblings from the existing project-files store, byte-capped, `INPUT_LIMITS`-respecting; the block says exactly which file is open and how to return an edit), client: the `files` tab gets "Open in chat context" per file, `PromptBar` shows a small `Context · index.html` chip (removable), the response parser learns one fenced block type — ```buildwe-file path="…" — rendered as an **Apply to file** button that `POST`s `/api/projects/files` (existing) and calls `pushCanvasVersion` (existing) so restore works unchanged.
**Rules:** the model gets file *contents*, not the whole project; oversized files are truncated with a visible note rather than silently cut; if no file is open, no context block is sent (no token spend on nothing); an Apply that fails validation shows the server's error, never a fake ✓.
**Verification:** `tests/workspace-context.mjs` with the localhost provider fixture (same as `tests/tools.mjs`): (a) a prompt with `context` present makes the fixture see the file body in the system message; (b) with no context, the system message contains no file text; (c) a reply containing a `buildwe-file` block results in a real `POST /api/projects/files` write that a later `GET` returns; (d) a bogus path / over-cap size is refused with a code, not a 500.

### Step 10 — Artifacts, list + pin (your item 6's "Artifacts system")
**Files:** new `lib/db/store.ts` additions (`Artifact` rows: id, userId, conversationId, path, kind, lang, text, source:"chat"|"agent"|"canvas", createdAt) reusing the retention-per-user pattern; right-panel header gets an `Artifacts` dropdown listing them (open / pin / restore), and a chat reload restores its artifacts. `canvasVersions` stays as the version timeline (no second versioning system).
**Verification:** `tests/artifacts.mjs`: a chat that produces a file block + an agent run both create rows; retention cap holds per user; deleting the conversation keeps or drops artifacts **as documented**; a deleted user has them removed (matches the delete-user sweep already tested).

### Step 11 — Sweep, a11y, tests wiring, docs (and the optional theme)
`tests/ui.mjs` + new suites wired into `npm test`; every popover in the app moved onto `useDismiss` (the style menu `:2910` and the version menu `:3046` are the two existing hand-rolled ones); focus-trap + `inert` behind the auth modal; `aria-live="polite"` on the composer status line; a11y contrast pass on `--soft` text; Razorpay `theme.color` read from one token instead of two hard-codes; eslint rule banning raw hex in `app/**`/`components/**` where a token exists; `docs/UI_UPGRADE_PLAN.md` updated to a "shipped" table like Wave 1/2 (proof per line).
**Optional, your call:** full **neon/cyberpunk** rebrand = new token set + 63 pages touched + share/print/PWA manifest + the 31 tool pages' markdown CSS. I'd do it as its own wave with before/after screenshots; not smuggled into a UI-features branch.

---

## 2. Things I'd add that you didn't list (and why they're cheap)

1. **IME-safe Enter** (Step 2) — you type Hinglish; today an Enter mid-composition sends a half-typed Devanagari word.
2. **⌘K palette** (new file `components/workspace/CommandPalette.tsx`, reuses `Popover` + `MenuRow`): jump to a chat, a tool, a studio, or run a tool with the current selection. Everything it calls already exists.
3. **`/` focuses the prompt, `Esc` stops a stream** — 6 lines, and the muscle memory is the product's whole feel.
4. **Empty-state art in the flyout/sidebar** for "no projects yet" using existing `shimmer` + `Btn` (the files tab already has a good empty state to copy).
5. **Per-message actions row** (copy / to-artifact / share / verify) — the parts exist (`doShare`, `/api/ai/verify`, artifacts), it's wiring.
6. **`linkPreviews` + `artifacts` also need the Wave 6 Postgres mirror list** — I'll add both to the migration table at the same time instead of a later sweep.
7. **`/status` rows** for the two new surfaces (link preview fetcher configured? workspace context on?) so what's off is visible rather than silent, matching the row pattern from Wave 2.
8. **Skip list:** I'm deliberately *not* doing a virtualized message list, `react-window`, a modal lib, or a state manager — none of the asks need them and the bundle is the product's fastest feature today.

---

## 3. Verification protocol (every step, no exceptions)

| Check | Command | Who |
|---|---|---|
| Types | `./node_modules/.bin/tsc --noEmit` | me |
| Lint | `npx next lint` (0 errors allowed; 2 known warnings) | me |
| Markup/behaviour suite | the step's `tests/*.mjs` + all 7 existing suites | me |
| Production build | `npx next build` (run only while the preview is stopped — dev and build share `.next`) | me |
| Real interaction | the live preview at port 3000 (and Vercel preview after push) | you |

Per step I'll hand you a **2–4 item test script** ("click X, expect Y") — that's your "wait for me to test and verify" gate. I stop after each step and do not proceed on assumption.

## 4. Risk table

| Step | Risk | Mitigation |
|---|---|---|
| 2 (composer extraction) | losing a behaviour that lives in 400 lines of inline JSX | the extraction is mechanical (same handler bodies), and `tests/ui.mjs` asserts each `aria-label`/limit string survived; one commit, revert = old composer back |
| 7b (seats) | money code | one commit; the existing CAS + `pay.amount < expected` guard already blocks a re-priced redeem; `test:security` + `test:credits` must stay green; 0/1 seat = today's behaviour exactly |
| 8 (link preview) | SSRF | dedicated `lib/net/ssrf.ts` + refusal tests, incl. the metadata IP; no credentials forwarded; feature is one route, one file, revertable |
| 9 (context) | token cost / prompt injection from a project file | context is opt-in per file, byte-capped, and the system block tells the model the file is **data, not instructions** |
| 6 (flyout) | a settings feature becoming unreachable | the check is literally "every existing `setModal(...)` still exists in the file" |

## 5. What I need from you

1. `APPROVED` to start (and then I do **Step 1 only** and hand it to you).
2. For Step 7: default = 7a+7b together (real seat billing). Say "7a only" if you'd rather the Business side show a disabled notice.
3. Step 11's neon rebrand: yes/no/ignore — not blocking anything before it.
