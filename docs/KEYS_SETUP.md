# Where to add real keys (you paste — never commit)

File: **`.env.local`** (already gitignored)

```bash
# Required for production-quality Chat + Code (free tiers OK)
GROQ_API_KEY=gsk_xxxxxxxx                 # https://console.groq.com
# OR
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx      # https://openrouter.ai

# Optional stronger models
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
FAL_KEY=                                  # optional paid image upgrade

# Session signing (change in production)
SESSION_SECRET=long-random-string-here

# Optional PRO billing later
NEXT_PUBLIC_RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

## What works without any paid key today

| Feature | Works? | How |
|---------|--------|-----|
| Image | Yes | BUILDWE Vision pipeline (no user-facing vendor) |
| Audio | Yes | BUILDWE Voice (device speech engine) |
| Chat/Code | Yes | Live if Groq/OpenRouter key set; otherwise premium offline assistant (no “demo/key” messaging) |
| Auth + history | Yes | Free local DB |

## After adding keys

```bash
# restart
npm run dev
curl -s localhost:3000/api/health
# capabilities.llmLive should be true when GROQ or OPENROUTER is set
```
