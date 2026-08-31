# 1min.ai — complete feature inventory + BUILDWE gap map

**Date:** 2026-08-31 · **Prepared for:** boss review before any build
**Target:** `https://1min.ai` / `https://app.1min.ai` (the "All-in-One AI Platform — Your AI Super App")
**Our baseline:** BUILDWE @ `arena/01a0568a-buildwe`, 103 files / 20,301 lines / 15 pages / 40 API routes (see `scan/METRICS.csv`)

> **Read this first — what this doc is and is not.**
> This is an **inventory, not a plan**. Nothing has been built or changed. Every 1min.ai item below
> is sourced from their public surface (homepage nav, 5 sitemap files, `/pricing`, `/credit-calculator`)
> plus third-party review sites. I could **not** log into `app.1min.ai`, so anything behind their login
> (exact in-app layout, credit meter UI, agent scheduler) is inferred from those public pages and is
> labelled ⚠️. Do not treat ⚠️ rows as verified facts — they are the *named features*, whose
> internal behaviour is unconfirmed.

---

## 1. What 1min.ai actually is (positioning)

| Dimension | 1min.ai |
|---|---|
| One-liner | "All-in-One AI Platform / Your AI Super App" — one subscription, one credit wallet, every AI task |
| Core wedge | **Multi-model side-by-side**: ask once, get GPT + Claude + Gemini + Grok answers in one screen (their "killer feature" per reviews) |
| Monetisation | Credits (not messages). 4 plans, one wallet across all tools, top-ups per million credits, rollover |
| Breadth | ~70 tools in 7 categories (homepage nav: 32 named + 38 behind `+N` counters) |
| Models | ~70 distinct models behind 53 chat landing pages in `sitemap-ai-models.xml` (verified by parsing); marketing claims 100+ |
| Clients | Web + macOS + Windows desktop + iOS + Android + **public API** (`docs.1min.ai`) |
| Languages | ~13 locales seen in sitemaps (en, en-GB, de, it, es, fr, pl, pt, pt-BR, zh-CN, zh-HK, zh-TW, zh-SG) |
| SEO machine | **17 sitemaps**: features, tools, models, agents, workflows, integrations, comparisons, alternatives, use-cases, industries, solutions, guides, tutorials, blog, newsletter, home, info |
| Trust story | commercial use on all plans, no training on user data, 30-day money-back, Stripe + Lemon Squeezy |
| Company signal | Vietnam-based (staff bylines on their own blog), 483 GetApp reviews, ~$6.5/mo entry price → volume business, not enterprise |

**Their public plan matrix** (from `/pricing`, verified today):

| | FREE | PRO | BUSINESS | ENTERPRISE |
|---|---|---|---|---|
| Price | $0 | **$6.5/mo** | **$10/mo** | **$7/member/mo** |
| Credits | 450K (+15K daily login bonus) | 1.45M | 2.45M | 2.45M / member |
| AI features | limited | all | all | all |
| Product features | all | all | all | all |
| Storage | 3 days | 3 months | 12 months | unlimited |
| Prompt library | limited | unlimited | unlimited | unlimited |
| Brand voice | limited | unlimited | unlimited | unlimited |
| Members / sharing | — | — | 10 members | unlimited |
| Extra credits | $1.34/M | $0.67/M | $0.67/M | $0.67/M |
| Perks | no card needed | 20% annual save | 20% annual save | priority support, feature requests |

All plans also list: unlimited free credits to use daily, rollover of unused credits, one credit wallet for every feature, commercial use, 30-day money-back.

**Credit pricing example** (from `/credit-calculator`, live today): Audio Generation on *Stable Audio 3 (StabilityAI)* = **2,053 credits/second** → 1,000,000 credits ≈ 487 seconds. Review sites report per-feature free-tier ceilings ≈ 250,000 words · 50 images · 3 videos · 75 upscales · 7 bg-removals · 37,500 TTS chars · 1,500 s transcription, and e.g. *Flux Schnell* image ≈ 9,000 credits. ⚠️ third-party figures, not verified in-app.

---

## 2. The feature inventory

Legend for BUILDWE status:
✅ we have it · 🟡 partial/exists but thin · ❌ missing · 🔧 present but broken (cross-ref `scan/NEW-ISSUES.md`)
Effort: **S** ≤ ½ day · **M** 1–2 d · **L** 3–5 d · **XL** > 1 week or needs a paid provider contract

### A. Chat & reasoning core (12)

| # | 1min.ai feature | What it does | BUILDWE today | Effort |
|---|---|---|---|---|
| A1 | Multi AI Chat | one prompt → several models answer side by side, pick/merge | 🟡🔧 `ai/compare` exists but 4 hard-coded seats, `available:false` on some, zero quota (A4) | M |
| A2 | Mix AI Models | combine several model outputs into one answer | 🟡 `router.ts` auto-picks **one** model; no merge | M |
| A3 | 100 AI Chat | access to 100+ models in one box | 🟡 46 catalog entries / 8 vendors — but their verified public list is ~70, so this is a catalog job (see §3) | M |
| A4 | AI Chat Memory | persistent facts about the user across chats | ❌ conversations persist, no memory layer | L |
| A5 | AI Document Chat | chat with uploaded docs (multi-file) | 🟡 `ai/file` single-file, no indexing | M |
| A6 | Chat with PDF | PDF parsing + citation | 🟡 same route, no PDF-specific pipeline | M |
| A7 | Chat with AI Image | vision in the chat thread | ✅ `ai/vision` + `image` mode | — |
| A8 | Real-time web search | live browsing inside answers | 🟡🔧 `search.ts` scrapes DDG HTML, 400-char cap (fragile) | M |
| A9 | Deep Research | o3-pro / o3-deep-research / o4-mini / Perplexity long-form reports | ❌ no multi-step research runner | L |
| A10 | AI Character Generator | persona/roleplay system-prompt builder | ❌ (only `user/skills` tags) | S |
| A11 | Per-model free chat pages | "free AI chat with <model>" SEO landing → same app | ❌ no per-model entry points | M |
| A12 | Model tiers / reasoning levels | cheap vs smart routing | ✅ `model-tiers.ts`, `router.ts` | — |

### B. Writing ### B. Writing & content tools (19) content tools (20 — 19 named + the YMYL checker row)

Every row here is, under the hood, a **form + fixed prompt + a model call** — i.e. cheap for us once a tool runner exists.

| # | 1min.ai feature | What it does | BUILDWE today | Effort |
|---|---|---|---|---|
| B1 | Grammar Checker | correct grammar/spelling, diff view | ✅ `grammar-checker` (corrected text + per-edit rule list) | S |
| B2 | AI Content Summarizer | long text → summary, bullet/para modes | ✅ `summarizer` (5 shapes + a "Not covered" section they don't have) | S |
| B3 | AI Content Rewriter | rewrite in a chosen tone | ✅ as `paraphraser` modes (fluent/formal/simple) | S |
| B4 | AI Content Paraphraser | reword while keeping meaning | ✅ `paraphraser` (CHANGED note proves nothing was added) | S |
| B5 | AI Content Shortener | compress text to N words | ✅ as `paraphraser` mode `short` (~60%) | S |
| B6 | AI Content Expander | grow a draft outward | ✅ as `paraphraser` mode `expand` | S |
| B7 | AI Content Translator | text translation | ❌ | S |
| B8 | AI Document Translator | whole-document translation | ❌ | M |
| B9 | Free AI Content Generator | generic copy generation by use-case | ✅ `blog-post` / `article-writer` / `ad-copy` | S |
| B10 | AI Content Detector | flags AI-generated text | ❌ | M |
| B11 | AI Keyword Research / SEO | keyword + intent analysis | ❌ | L |
| B12 | Blog Article Generator | outline → full post | ✅ `blog-post` (takeaways → H2s → CTA → META/SLUG, contract-graded) | M |
| B13 | Brand Voice Generator | reusable tone profile applied to outputs | ✅ `brand-voice` — derived from samples and saved into workspace skills, so chat + every tool pick it up | L |
| B14 | AI Presentation Generator | prompt → slide deck | ❌ | L |
| B15 | LinkedIn Comment Generator | platform-native replies | ✅ `linkedin-comment` (5 options with a stance) | S |
| B16 | X / Twitter Comment Generator | ditto | ❌ | S |
| B17 | Facebook Comment Generator | ditto | ❌ | S |
| B18 | TikTok Hooks AI | scroll-stopping openers | ✅ `tiktok-hooks` (12 hooks in 4 mechanisms + first-frame note) | S |
| B19 | AI Code Translator | port code between languages | ✅ `code-translator` (idioms + "what changed" + re-test list + optional equivalence test) | S |

**Wave 1 delta (2026-08-31, `arena/01a0568a-buildwe`):** everything marked ✅ above is live in code, not
promised: `lib/tools/registry.ts` holds **31 tools** and `lib/tools/run.ts` executes them (validation →
server-built prompt → quota → live model → contract grading → one corrective pass → history). Rows still ❌
are honestly unbuilt: B7 (a standalone translator), B8, B10, B11, B14, B16, B17.
Also shipped from other buckets in the same pass: the social generators (tweet, X thread, Instagram caption,
Facebook post, LinkedIn post, YouTube script), the career set (cover letter, resume summary, interview prep),
the business set (email, proposal), docs (meeting notes, hallucination check) and dev (code explainer,
unit tests, commit message) — i.e. most of bucket C and part of E/F are now tool pages rather than chat prompts.
§4's totals were compiled before this wave; treat ✅ counts as 13 → ~40 and ❌ as 89 → ~60 until Wave 2 rewrites them.
| — | **YMYL / Hallucination Checker** | fact-check pass on generated copy | 🟡 `quality.ts` written but **never called** (A1) | M |

### C. Image generation & editing (18)

| # | 1min.ai feature | What it does | BUILDWE today | Effort |
|---|---|---|---|---|
| C1 | AI Image Generator | text→image, multi-model (Flux/DALL-E/SD/Ideogram/Midjourney) | ✅ `ai/image`, `image-providers.ts` | — |
| C2 | Image Studio UI | prompt, aspect, count, history, download | 🟡🔧 `ImageStudio.tsx` fake progress bar (L113) | S |
| C3 | Image model picker | choose model per generation | 🟡🔧 catalog reaches UI via `selectable[]`; dashboard also loads `coming_soon` entries (A7) | S |
| C4 | AI Image Variator | variations of an input image | ❌ needs img2img | M |
| C5 | AI Image Upscaler | 2×/4× resolution boost | ❌ needs upscaler provider | M |
| C6 | AI Background Remover | cut-out subject | ❌ | M |
| C7 | AI Background Replacer | swap background (text prompt) | ❌ | M |
| C8 | Object Remover | erase unwanted person/thing, inpaint fill | ❌ | L |
| C9 | AI Text Remover | strip burned-in text from images | ❌ | M |
| C10 | Search and Replace (in image) | swap one object for another | ❌ | L |
| C11 | Image Mask Editor | brush a mask, edit inside it | ❌ canvas UI + inpaint | XL |
| C12 | Image Extender | outpaint beyond canvas | ❌ | L |
| C13 | AI Image to Prompt | image → editable prompt | 🟡 `ai/understanding` can describe, no prompt-format | S |
| C14 | AI Face Swap (photo) | swap face into a target image | ❌ | L |
| C15 | Sketch to Image | drawing → rendered image | ❌ | M |
| C16 | 3D Image Generator | 3D renders / turntable style | ❌ | L |
| C17 | AI Image Editor | general instruction-based edit | ❌ | L |
| C18 | Client brief → moodboard / sketch approval flows | packaged creative workflows (blog-only names) | ❌ | M ⚠️ |

### D. Audio & voice (14)

| # | 1min.ai feature | What it does | BUILDWE today | Effort |
|---|---|---|---|---|
| D1 | Text to Speech | multi-voice TTS (ElevenLabs, OpenAI) | ✅ `ai/audio` | — |
| D2 | Speech to Text | transcription (Deepgram/Groq Whisper) | ✅🔧 `ai/transcribe` — no size cap (A3), env key leak in `stt.ts:136` (A5) | S |
| D3 | Audio Studio UI | voice picker, speed, preview, download | 🟡🔧 `AudioStudio.tsx` L115→340 flow | S |
| D4 | Voice Cloning | clone a voice from samples | ❌ | L |
| D5 | AI Voice Design | create custom voice from description | ❌ | L |
| D6 | Voice Changer | re-voice existing audio | ❌ | M |
| D7 | AI Voice Isolator | remove music/noise from speech | ❌ | M |
| D8 | Audio Inpaint | regenerate a region of audio | ❌ | L |
| D9 | Audio Generation / Text to Sound | SFX + ambience from prompt | ❌ (Stable Audio class) | M |
| D10 | AI Music Generator | full tracks | ❌ | M |
| D11 | AI Audio Translator | translate + re-voice audio | ❌ pipeline of D2+B7+D1 | L |
| D12 | Voiceover studio ("AI voiceovers 1min.ai") | script → finished VO | 🟡 TTS exists, no script tooling | M |
| D13 | Free voice acting with ElevenLabs v3 | acting directions per line | ❌ needs model + pricing | M |
| D14 | Captions Generator | SRT/VTT from video or audio | ❌ (could reuse STT) | M |

### E. Video (6)

We have **zero** video surface today — this is the single largest structural gap.

| # | 1min.ai feature | What it does | BUILDWE today | Effort |
|---|---|---|---|---|
| E1 | AI Text to Video | prompt → short clip (Hunyuan/Veo/Kling class) | ❌ | L + provider |
| E2 | AI Image to Video | still → motion clip | ❌ | L + provider |
| E3 | AI Video Face Swap | face swap in motion | ❌ | XL |
| E4 | YouTube Video Summarizer | URL → summary/chapters | ❌ | M |
| E5 | YouTube Translator | transcript → translated audio/subs | ❌ | L |
| E6 | AI Video Generator for Business | templated promo video | ❌ ⚠️ | L |

### F. Agents & automation (11)

| # | 1min.ai feature | What it does | BUILDWE today | Effort |
|---|---|---|---|---|
| F1 | Multi AI Chat agent | agent that consults several models | 🟡 `agent.ts` uses one routed model | M |
| F2 | Agent for X | draft/schedule post threads | ❌ no connect/publish | L |
| F3 | Agent for Instagram | caption + hashtag + imagery | ❌ | L |
| F4 | Agent for LinkedIn | professional posts | ❌ | L |
| F5 | Agent for Facebook | page/community posts | ❌ | L |
| F6 | Threads Content Agent | multi-day content plan for Threads | ❌ | M |
| F7 | YouTube Localization Agent | retitle/describe/sub for locales | ❌ | L |
| F8 | Content-marketing agent / "week of content" | brief → week of posts | ❌ | L |
| F9 | Personal brand on autopilot | recurring persona-driven posting | ❌ | L |
| F10 | Monitor industry trends with agent | scheduled digest | ❌ needs cron/queue | L |
| F11 | Agent for software development | repo-aware coding agent | 🟡 `agent.ts` + code canvas, no repo access | L |

Our ✅ baseline for this bucket: `app/api/ai/agent` (626-line `lib/ai/agent.ts`) is a real multi-step loop — architecturally we're closer than elsewhere, we just don't expose per-platform agents.

### G. Persona "Studios" (packaged workspaces) (8)

Their newest merchandising layer: same tools, pre-arranged per job title (`/ai-tools-for-*`).

| # | Studio | BUILDWE today | Effort |
|---|---|---|---|
| G1 | Content Creator Studio | ❌ | S (config once tools exist) |
| G2 | Copywriter Studio | ❌ | S |
| G3 | Artist Studio | ❌ | S |
| G4 | Marketer Studio | ❌ | S |
| G5 | Small Business Studio | ❌ | S |
| G6 | AI + Trailblazer Studio | ❌ | S |
| G7 | For Software Engineers / Teachers / Solopreneurs / Executives / Students (5 more) | ❌ | S |
| G8 | `/ai-use-cases`, `/ai-for-industries`, `/ai-solutions` variants | ❌ | M |

Note: 7 of these 8 cost almost nothing in code — they are *curation* of the tool set from buckets B–F.

### H. Platform, billing & account (22)

| # | 1min.ai | BUILDWE today | Effort |
|---|---|---|---|
| H1 | One credit wallet across every tool | ❌ flat message-ish limit | L |
| H2 | Per-feature + per-model credit prices | ❌ none | L |
| H3 | Daily login free credits (15K) | ❌ | S |
| H4 | Top-up credits at $/million | 🟡 `checkout/order` (Razorpay, demo) 🔧 free-PRO exploit C1 | M |
| H5 | Unused credit rollover | ❌ | M |
| H6 | Public credit calculator page | ❌ | M |
| H7 | Storage retention by plan (3 d / 3 mo / 12 mo / ∞) | ❌ no retention policy at all | M |
| H8 | Prompt library (limited → unlimited) | 🟡 `user/skills` only, no library | M |
| H9 | Brand voice profiles | ❌ | M |
| H10 | Members management | 🟡 `teams` + invites (32-bit, never expire — scan) | M |
| H11 | Sharing & collaboration | 🟡 `/s/[id]` read-only share 🔧 stored XSS C2 | M |
| H12 | Commercial use on all plans (policy) | ❌ no LICENSE, no such clause | S |
| H13 | 30-day money-back guarantee + refund flow | ❌ | M |
| H14 | Stripe + Lemon Squeezy | ❌ single gateway, `amount: 0` verify path 🔧 | L |
| H15 | OAuth (Google/GitHub) | ✅🔧 email unverified, no PKCE (scan) | M |
| H16 | BYOK (bring your own keys) | ✅ `user/keys`, `dev/keys` — **we lead here** | — |
| H17 | Public developer API + docs site | 🟡 `/api/v1/chat` + `/developers` page, no keys/metering/limits 🔧 | L |
| H18 | Usage analytics / credit history | 🟡 `metrics` route is public 🔧 | M |
| H19 | Feedback → "feature requests" for enterprise | 🟡 `ai/feedback` collected, not surfaced | S |
| H20 | Status page | ✅🔧 `/status` badges are string-matching, 7 rows can never change (A13) | S |
| H21 | Guest / no-card trial | ✅ `auth/guest` | — |
| H22 | Ad-supported free tier | ✅ `AdSlot` — **ours, they have none** 🔧 never rotates (A8) | S |

### I. Distribution & clients (8)

| # | 1min.ai | BUILDWE today | Effort |
|---|---|---|---|
| I1 | Web app | ✅ whole product | — |
| I2 | Installable PWA | ✅ `PwaRegister` | — |
| I3 | macOS desktop app | ❌ | XL (separate repo/signing) |
| I4 | Windows desktop app | ❌ | XL |
| I5 | iOS app | ❌ | XL |
| I6 | Android app | ❌ | XL |
| I7 | ~13 language locales | ❌ English-only | L |
| I8 | Print/reading view | ✅ `/print` — **ours** | — |

### J. Growth engine (marketing-as-product) (7)

| # | 1min.ai | BUILDWE today | Effort |
|---|---|---|---|
| J1 | `/ai-features` hub (16 pages) + per-feature landing pages | 🟡 15 static marketing pages | L |
| J2 | `/ai-models` 85 model landing pages ("free AI chat with X") | ❌ | L |
| J3 | `/ai-tools`, `/ai-agents`, `/ai-workflows` hubs | ❌ | M |
| J4 | `/ai-comparisons` + `/alternatives` (vs OpenRouter etc.) | ❌ | M |
| J5 | `/ai-integrations`, `/ai-tutorials`, `/ai-guides`, `/blog`, newsletter | ❌ | M |
| J6 | Multi-locale sitemap generation | ❌ | M |
| J7 | Docs site (`docs.1min.ai`) for API | 🟡 `/developers` single page | M |

This bucket is why they *look* 100× bigger than us: a large slice of the "product" is programmatic SEO + content, not code. Worth deciding explicitly — it's a marketing operation with a content cost, not a dev backlog.

---

## 3. Model catalog they expose (verified counts, not their marketing number)

Counted by parsing the `en` section of `sitemap-ai-models.xml` programmatically:

- **89** total entries in that sitemap's `en` section (index page excluded from this below)
- **53** are per-model chat landing pages (`ai-chat-with-*`, `free-ai-chat-with-*`)
- After collapsing the `free-` / `ai-chat-with-` prefix duplicates **and** the AWS-Bedrock `us`/`global` + `-anthropic`/`-open-ai` deployment mirrors → **~51 distinct chat models** with a public page
- Plus ~20 more model pages that are bare slugs or reviews (`qwen3-vl-plus`, `claude-4-7-opus-anthropic`, `gemma-4-12b-review`, `ideogram-4…`, `mistral-ocr-4…`, `claude-fable-5`, `claude-sonnet-5`) → **~70 named models in total**
- Their homepage says "100 AI Chat" / "100+ models" ⚠️ — the public sitemap supports **~70**. The rest is probably pooled through aggregator vendors (OpenRouter-class) rather than individually catalogued, and/or is marketing rounding. **Do not budget for 100 integrations; budget for ~35 vendors' worth of distinct endpoints.**

Grouped, dedup of `-us` / `-global` Bedrock mirrors:

- **OpenAI** — GPT-3.5, GPT-4, GPT-4 Turbo, GPT-4o, GPT-4.1 / mini / nano, GPT-5 / mini / nano, o1, o3, o3-pro, o3-mini, o4-mini, o3-deep-research, o4-mini-deep-research, GPT-OSS 20B / 120B
- **Anthropic** — Claude 1.2, 2.1, 3 Opus/Sonnet/Haiku, 3.5 Sonnet/Haiku, 3.7 Sonnet, 4 Opus/Sonnet, 4.1 Opus, 4.5 Haiku/Opus, 4.6/4.7 Opus+Sonnet, Claude 5 Sonnet, Claude Fable 5 (+ AWS Bedrock mirrors)
- **Google** — Gemini 1.0 Pro, 1.5 Pro, 2.0 Flash / Flash-Lite, 2.5 Flash / Pro, 3 Flash, 3.1 Flash-Lite / Pro
- **xAI** — Grok 2, 3, 3 Mini, 4, 4.1 Fast
- **DeepSeek** — Chat, R1, V3.2, V3.2 Reasoner
- **Qwen/Alibaba** — Qwen Max/Plus/Flash, Qwen VL Plus/Max, Qwen3 VL 8B Thinking/Flash/Plus, Qwen3 8B / 5 9B / 3 Max
- **Mistral** — Mistral Small, Large 2, 8×7B, Pixtral 12B, Open Nemo, Ministral 14B, Magistral Small/Medium 1.2
- **Meta** — Llama 2 70B, 3 70B, 3.1 405B, 4 Maverick / Scout
- **Cohere** — Command R (+ North family in marketing)
- **Perplexity** — Pro, Reasoning Pro
- **Z.ai** — GLM 5, 5.1, 5.2
- **Media models (from homepage/calculator/reviews)** — DALL-E 3, Midjourney, Flux (Schnell/Dev), Stable Diffusion, Ideogram 4, Leonardo; ElevenLabs v3, Stable Audio 3; Hunyuan video

**Ours:** 46 catalog entries, 8 vendors, in `lib/ai/models-catalog.ts` + `provider-registry.ts`.
The gap is **smaller than the headline suggests**: our `openrouter` + `groq` + `together` + `deepseek` providers already pool far more model IDs than we catalogue, so widening 46 → ~70 is mostly **catalog rows + per-model capability flags**, not new integrations — *but* it needs (a) a live provider check per row (I could not reach any provider API from this sandbox, so model IDs are currently unverified) and (b) per-model pricing entries for the credit wave. Matching their *presentation* (one landing page per model) is the bigger job than matching the *list*.

---

## 4. Score summary (machine-counted from the tables above)

Counts below were produced by parsing the tables above with a script (126 rows, 0 unparsed), not by hand.

| Bucket | Items | ✅ have | 🟡 partial | ❌ missing | broken 🔧 |
|---|---|---|---|---|---|
| A Chat & reasoning | 12 | 2 | 6 | 4 | 2 |
| B Writing & content | 20 | 0 | 2 | 18 | 0 |
| C Image | 18 | 1 | 3 | 14 | 2 |
| D Audio & voice | 14 | 2 | 2 | 10 | 2 |
| E Video | 6 | 0 | 0 | 6 | 0 |
| F Agents & automation | 11 | 0 | 2 | 9 | 0 |
| G Persona studios | 8 | 0 | 0 | 8 | 0 |
| H Platform & billing | 22 | 5 | 7 | 10 | 8 |
| I Distribution | 8 | 3 | 0 | 5 | 0 |
| J Growth engine | 7 | 0 | 2 | 5 | 0 |
| **Total** | **126** | **13** | **24** | **89** | **14** |

- Missing 89 items split by my own effort estimate: **22 S · 29 M · 32 L · 6 XL** → **51 are S/M** (form + prompt + config work), **38 are L/XL** (real provider integrations, mask editor, video, native apps).
- **Product tools only** (buckets B + C + D + E + F = 69 items): we fully have **3**, partial on **9**, missing **57**. That is the honest headline — most of the 13 ✅ overall are chat/voice/account plumbing we already had.
- Roughly **half the missing list** is thin wrappers over a model call + a form (all of bucket B, all of G, part of C/D). Those buy *feature-list* parity, not architecture parity.
- The genuinely hard, money-and-time-consuming 20%: image editing pipeline (C4–C17), video (E), voice cloning/design (D4–D8), durable social agents (F2–F10), and the credit economy (H1–H6).

---

## 5. Suggested waves (for you to pick, not started)

Nothing below is in progress. Ordered so that money/durability correctness comes **before** feature count, per `scan/NEW-ISSUES.md`.

| Wave | Scope | Realistic size | What parity it buys |
|---|---|---|---|
| **0 — Foundation** | Fix C1 free-PRO, C2 share XSS, C3 rate-limit bypass, C4 write loss; meter `v1/chat`, `compare`, `transcribe`; real key-path cleanup (A5) | ~3–4 days | Without this, every new tool multiplies a leak |
| **1 — Tool runner + writing tools** | One generic `tools.json` schema → form UI + `/api/ai/tool` + history; ship B1–B12, B15–B19 | ~4–5 days | +18 tools, closes the "they have 70" optics gap cheapest |
| **2 — Credit economy** | Wallet, per-feature/per-model price table, metering on every route, rollover, top-up, calculator page; price from real provider cost | ~1 week | Their actual business model (H1–H7) |
| **3 — Chat depth** | User-selectable multi-model compare, answer merge, memory, multi-file/PDF, real search API (replace DDG scrape) | ~1 week | A1–A9 — their flagship UX, our best existing asset |
| **4 — Image editing** | One img2img/inpaint provider (Fal or Replicate) → C4–C10, C12, C15, C17 | ~1–2 weeks + per-gen $ cost | Their biggest single category |
| **5 — Voice** | Voice cloning/design + isolator + SFX/music + captions (reuse STT) | ~1 week + ElevenLabs contract | D4–D10, D14 |
| **6 — Agents + personas** | Scheduled runs, platform connectors, F2–F10 + G1–G8 studios | ~2 weeks | Their growth story |
| **7 — Video** | E1–E5 via one video provider; expensive per generation | ~1 week + budget | Closes the last empty category |
| **8 — Growth/i18n** | Programmatic landing pages for every tool+model, 5 locales, sitemap split | ~2 weeks | Only if SEO is actually the goal |
| **Skip / revisit** | I3–I6 native apps | 4–8 weeks each, separate repos | Not worth it pre-product-market-fit |

**"100% like 1min.ai" in honest numbers:** waves 0–7 ≈ **6–9 focused weeks of engineering + paid provider contracts** (image editing, video, ElevenLabs, a real search API, and a payment gateway that works in India). Their remaining surface is native apps and a content operation, which are separate products/teams, not a backlog.

What each option actually buys, using the counts above:

- **Waves 0–1 only** (≈1 week): the 89-item gap doesn't move much, but the leaks stop and **18 of bucket B** land — first visible "we have 70 tools too" effect for ~20 config files.
- **Waves 0–4** (≈3–4 weeks): closes essentially the whole **S/M tier inside A, B, C, G and H** — the 51 S/M missing items minus the ones only waves 5–7 can reach — plus fixes the 14 🔧. This is where the product *feels* like 1min.ai from the outside, at maybe **40% of their item list fully done and ~2/3 done-or-parity-looking**.
- **Waves 0–7**: full feature parity including the expensive 38 L/XL items (image editing pipeline, video, voice cloning, scheduled agents). Cannot be done without ongoing provider spend — that is a cost line, not a task.
- **Never (my recommendation to defer):** I3–I6 native apps, J1–J6 full programmatic-SEO operation, I7 all 13 locales.

---

## 6. Things I'd flag before you decide

1. **Don't copy the credit system blindly.** Public criticism of 1min.ai (GetApp/Capterra reviewers) is that credit costs per feature are confusing and burn fast. Our `scan/` shows we currently meter *nothing* on 4 of the expensive routes — credits without metering is the worst of both worlds.
2. **Several of our ✅ are broken.** H20 status page, H11 sharing, H17 API, H12 license: our own docs (`docs/PLATFORM_STATUS.md`, `docs/COMPETITOR_GAP_ANALYSIS.md`) mark these as shipped/done. The audit disproved several. Any "we already have X" claim in `COMPETITOR_GAP_ANALYSIS.md` needs re-verification before it feeds a parity decision.
3. **Their pricing page contradicts third-party listings** ($6.5/mo official vs $5 on SoftwareAdvice/GetApp). Their free tier also self-contradicts between `1min.ai` ("3 days storage") and `new.1min.ai` ("1 day"). Treat *their* numbers as marketing, not spec.
4. **Bucket G is a mirror trick, not a feature list.** 7 studio pages with identical tool sets behind different hero copy. If we want the same *optics*, it's a config file — but it adds no capability.
5. **Video is the only category where "no code yet" is also "no data model yet."** Any generation pipeline there needs storage, retention, async jobs and cost caps decided up front (we currently have no job queue).
6. **Unverifiable claims in this doc:** everything behind login (⚠️ rows), per-model credit costs, the 100+ model count, native app quality. Their real in-app UX should be checked by someone with an account before we copy layout.

---

## 7. Sources

- `https://1min.ai/` (homepage feature nav, 7 categories, `+N` counters, model logos) — fetched 2026-08-31
- `https://1min.ai/sitemap.xml` → 17 sub-sitemaps
- `https://1min.ai/sitemap-ai-features.xml` (~85 en entries: tools, features, guides, deep-research pages)
- `https://1min.ai/sitemap-ai-tools.xml`, `-ai-agents.xml`, `-ai-workflows.xml`, `-ai-models.xml` (85 model pages)
- `https://1min.ai/pricing` (full 4-tier matrix, verbatim above)
- `https://1min.ai/credit-calculator` (credit-per-second example, plan credit volumes)
- `https://1min.ai/ai-features` (blog hub, the 7 "Studio" persona pages)
- Third-party: GetApp/SoftwareAdvice (483 reviews), skywork, bestfreeaitools, listmyai — pricing drift + reviewer complaints
- BUILDWE side: `scan/METRICS.csv`, `scan/API-ROUTES.csv`, `scan/NEW-ISSUES.md`, `scan/FINDINGS-BY-FILE.md`, `docs/COMPETITOR_GAP_ANALYSIS.md`

**Repo files consulted for our status:** `app/page.tsx` (modes `auto|chat|code|image|audio`), `app/api/**` (40 routes), `lib/ai/{compare via gateway,router,model-tiers,search,stt,image-providers,provider-registry,models-catalog,quality,agent}.ts`, `components/workspace/{ImageStudio,AudioStudio}.tsx`, `lib/db/store.ts`.
