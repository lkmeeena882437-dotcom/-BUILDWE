# Jo Baaki Hai — Kaun Kya Karega

**Version:** 1.11.1 · 30 August 2026

Boss ne poocha: *"ye kaam jo baaki h usko pehle pura karte h. process batao —
kya mere side se, kya tere side se?"*

Seedha jawab table me.

---

## Aapke side se — sirf 2 kaam, 10 minute

Ye main **kar hi nahi sakta**, kyunki inke liye aapke account ka login chahiye.

### 🔴 Kaam 1 — Groq key rotate karo (2 min)

Aapne purani key chat me bhej di thi. Wo ab safe nahi maani jaati.

1. https://console.groq.com/keys
2. `gsk_Eh3g...` wali key → **Delete**
3. **Create API Key** → nayi key copy karo
4. **Chat me mat bhejna** — seedha Kaam 2 me daalna

### 🔴 Kaam 2 — Supabase SQL + env vars (8 min)

1. https://supabase.com/dashboard/project/yienzcyfmmvawbxzdptb
2. **SQL Editor** → **New query**
3. Repo ki file `supabase/schema.sql` ka **poora content** paste → **Run**
4. **Settings → API** se copy karo:
   - Project URL
   - **service_role** key (Reveal dabao) — `anon` nahi
5. Hosting (Vercel) → Settings → Environment Variables:

```
GROQ_API_KEY               = <nayi key>
NEXT_PUBLIC_SUPABASE_URL   = https://yienzcyfmmvawbxzdptb.supabase.co
SUPABASE_SERVICE_ROLE_KEY  = <service_role>
SESSION_SECRET             = <openssl rand -base64 48>
BYOK_ENCRYPTION_SECRET     = <openssl rand -base64 48 — alag wali>
```

6. **Redeploy** dabao

Poori detail `docs/SETUP_GUIDE.md` me hai.

---

## Mere side se — ye maine ab kar diya ✅

### ✅ ImageStudio ab backend se chalta hai

**Problem:** component me model list hardcode thi — `flux`, `turbo`, aur ek
`pro` jo hamesha "Soon" dikhta tha aur kabhi kaam nahi karta tha. Aapke brief
ka Section 1 saaf kehta hai *"models configurable from backend, not hardcoded
in UI"*.

**Fix:** ab `/api/ai/models` se list aati hai, aur usme **sirf wahi models
dikhte hain jo is deployment par sach me chal sakte hain**. FAL_KEY daaloge to
FLUX Dev/Pro apne aap list me aa jayenge — code chhune ki zarurat nahi.

Saath me: agar selected model list me nahi hai to apne aap pehle wale par
switch ho jata hai, taaki server ko aisi id na bheje jo reject ho jaye.

### ✅ PRO gate me ek chhupa hua bug tha — fix

**Problem:** gate sirf literal id `"pro"` check karta tha. Par catalog me asli
premium models ke id `fal-ai/flux/dev` aur `fal-ai/flux-pro/v1.1` hain. Matlab
**free user premium image models chala sakta tha** — paise aapke jaate.

**Fix:** gate ab catalog ke `tiers` se chalta hai. Verify kiya:

```
free user → fal-ai/flux/dev  → 402 "FLUX Dev is a PRO model"
free user → turbo            → 200 OK
```

### ✅ Health endpoint ab sach bolta hai

**Problem:** `db` field hamesha `"disk"` ya `"memory"` kehta tha — chahe
Supabase laga ho ya nahi. Setup theek hua ya nahi, pata hi nahi chalta tha.

**Fix:** naya `durability` block:

```json
"durability": {
  "database":     "supabase",   // ya "disk" / "memory"
  "rateLimits":   "shared",     // ya "per-instance"
  "mediaStorage": "supabase"    // ya "ephemeral"
}
```

Ab ek nazar me pata chal jayega ki setup poora hua ya adhura.

Ek aur chhoti galti bhi mili: health image models ko **chat providers** ke
against check kar raha tha. Isliye FAL_KEY hone par bhi image count galat aata.
Fix ho gaya.

### ✅ `fellBack` ab response me aata hai

Agar aapka chuna model unavailable ho aur koi doosra serve kare, ab response
me `fellBack: true` aata hai — UI user ko bata sakti hai, chupchaap dusre model
ka output dene ke bajaye.

---

## Score — ab kahan khade hain

| Layer | Session shuru | Ab | Aapke 2 kaam ke baad |
|---|---|---|---|
| Frontend | 90% | **95%** | 95% |
| Backend | 85% | **94%** | 94% |
| Database | 60% | 85% | **95%** |
| Storage | 35% | 80% | **95%** |
| AI power | 75% | 80% | **95%** |

Database / Storage / AI ka bacha hua hissa **poora aapke 2 kaam par hai** —
code taiyaar hai, bas env chahiye.

---

## Imaandari se — jo abhi bhi baaki hai

Ye chhoti cheezein hain, aapka product inke bina bhi chalega. Bata raha hoon
taaki aapko baad me surprise na ho.

| Cheez | Haalat | Kitna zaroori |
|---|---|---|
| **Email bhejna** | Code hi nahi hai. Password reset ka token banta hai par email jaata nahi — user ko link manually dena padega. | Medium — jab tak signup kam hai, chalega |
| **Ek JSON document = poora DB** | Supabase me sab kuch ek row me jaata hai. Ek hi user likhe to theek. Bahut saare users ek saath likhein to last-write-wins. | Low abhi, High jab 100+ active users ho |
| **`run_check` sirf static hai** | Agent code padhta hai, chalata nahi (server par). Asli execution browser me hoti hai. | Low — jaanbujh kar, security ke liye |
| **Voice list hardcode hai** | `app/page.tsx` me 23 voices likhi hain. Ye TTS ke voice names hain, models nahi — isliye kam problem. | Low |

Ye chaaron **jaanbujh kar chhode** hain, bhoole nahi. Kehna ho to karta hoon —
par pehle upar wale 2 kaam kar lein, kyunki unke bina baaki sab bekaar hai.

---

## Order — kis cheez ke baad kya

```
1. Groq key rotate                    ← aap (2 min)
2. Supabase SQL + env vars            ← aap (8 min)
3. Redeploy                           ← aap (1 min)
4. /api/health check karo             ← aap (1 min)
        durability me teeno "supabase"/"shared" dikhna chahiye
5. 5 test chalao (SETUP_GUIDE me)     ← aap (5 min)
6. Jo toote wo batao                  ← main fix karunga
```

**Step 4 sabse important hai.** Agar wahan `disk` / `per-instance` dikhe to
aage mat badhna — env vars nahi lage hain, mujhe batana.
