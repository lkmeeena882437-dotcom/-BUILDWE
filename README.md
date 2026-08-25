# BUILDWE.ONLINE

**Build anything. Create everything.**

Next.js 14 + Tailwind AI workspace: **Auto · Chat · Code · Image · Audio**

## Quick start

```bash
cp .env.example .env.local   # fill keys later
npm install
npm run dev
```

Open http://localhost:3000

## Pages

| Route | Purpose |
|-------|---------|
| `/` | App dashboard |
| `/about` | Product, AI models, rules, policy links |
| `/pricing` | Free vs PRO comparison |
| `/privacy` | Privacy Policy |
| `/terms` | Terms + AI acceptable use |
| `docs/AI_BACKEND.md` | How auto model routing works |
| `/api/checkout/order` | Create Razorpay order (demo-safe) |
| `/api/checkout/verify` | Verify payment signature (demo-safe) |

## Env keys (replace later)

See **`.env.example`**. Important groups:

- `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `FAL_KEY`, … — AI providers (server only)
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — payments
- `FREE_*_LIMIT` / `PRO_*_LIMIT` — plan limits
- `AI_*_MODEL` — model IDs per tier

`NEXT_PUBLIC_DEMO_MODE=true` keeps safe demo AI + demo checkout without real charges.

## AI architecture

```
lib/ai/rules.ts      → intent, system prompts, plan rules
lib/ai/gateway.ts    → provider calls (demo until keys set)
lib/config.ts        → all env reads
lib/payments/razorpay.ts → order + verify stubs
```

**How routing works**

1. User plan = `free` by default  
2. **Auto** mode → `detectIntent()` → chat | code | image | audio  
3. Server prefers: user BYOK → PRO models → FREE models → demo fallback  
4. Limits enforced server-side (UI hides free image/audio counters)

## PRO checkout flow

1. User clicks **Switch to PRO**  
2. Must be logged in  
3. Checkout sheet: amount · UPI/Card/NetBank · agree Terms/Privacy  
4. `POST /api/checkout/order` → order id  
5. (Prod) Razorpay Checkout.js  
6. `POST /api/checkout/verify` → set `plan=pro`  

## Scripts

- `npm run dev` — 0.0.0.0:3000  
- `npm run build`  
- `npm start`  
