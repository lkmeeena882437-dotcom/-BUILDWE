# BUILDWE — Setup Guide (Boss ke liye)

**Version:** 1.11.0 · 30 August 2026

Boss ne poocha: *"mujhe ye radis wala samjh nahi aaya h — ye trial free h baaki
paid maang rha h. tum mujhe clear bolo kya or kaha krna h."*

Seedha jawab: **Redis ki zarurat hi nahi hai. Maine wo kaam Supabase se hi
kara diya hai.** Aapko sirf **2 cheezein** karni hain, dono free.

---

## ⚠️ Sabse pehle — ek security kaam (2 minute)

Boss, aapne Groq key aur Supabase link **chat me bhej diya**. Chat log kahin
bhi save ho sakta hai. Isliye:

### Groq key ko turant rotate karo

1. https://console.groq.com/keys kholo
2. Jo bhi Groq key chat, email, ya git me paste hui ho — usko **Delete** karo
3. **Create API Key** dabao → nayi key banegi
4. Nayi key **kahin chat me mat bhejna** — seedha `.env.local` / Vercel env me daalna
   (niche Step 2 me bataya hai)

**Maine aapki bheji hui key kahin bhi file me save nahi ki hai.** Repo bilkul
saaf hai — `.env.local` gitignored hai aur usme koi provider key nahi hai.

### Supabase key ke baare me

Aapne jo bheja wo sirf **dashboard ka link** hai, key nahi — wo theek hai,
public link se koi khatra nahi. Par jo **`service_role` key** aap aage niklaoge,
wo poore database ka master password hoti hai. Usko:
- ❌ chat me mat bhejna
- ❌ frontend code me mat daalna
- ✅ sirf hosting ke environment variables me daalna

---

## Redis ka jhamela — clear jawab

| Aapka sawaal | Jawab |
|---|---|
| "Redis trial free h, baaki paid maang rha h" | Bilkul sahi dekha. Upstash ka free tier chhota hai. |
| "To kya karein?" | **Kuch nahi. Redis chahiye hi nahi.** |
| "Phir rate limiting kaise hogi?" | Supabase ke Postgres se — jo aap waise bhi le rahe ho. |

**Maine kya kiya:** rate limiting ab ek atomic Postgres function se hoti hai
(`buildwe_rate_hit`). Ek hi SQL statement me count check aur increment dono
hote hain, isliye do request ek saath aayein tab bhi ginti sahi rehti hai —
bilkul wahi kaam jo Redis karta.

**Fayda:** ek hi service (Supabase), ek hi bill (₹0), ek hi jagah setup.

---

## Aapko sirf 2 kaam karne hain

### ✅ Step 1 — Supabase set up karo (5 minute, free)

1. https://supabase.com/dashboard kholo → apna BUILDWE project select karo

2. Left menu me **SQL Editor** → **New query**

3. Repo me file hai: **`supabase/schema.sql`** — uska **poora content copy**
   karke yahan paste karo

4. **Run** dabao

   Aakhir me ek list dikhegi:
   ```
   buildwe_kv
   buildwe_rate_limits
   ```
   Ye dikh gaya matlab kaam ho gaya. ✅

5. Ab **Settings → API** me jao aur do cheezein copy karo:

   | Kya | Kahan milega | Dikhta kaisa hai |
   |---|---|---|
   | Project URL | Settings → API → Project URL | `https://<your-project-ref>.supabase.co` |
   | service_role key | Settings → API → Project API keys → **service_role** (Reveal dabao) | `eyJhbGci...` (lamba) |

   ⚠️ **`anon` key nahi — `service_role` key.** Dono dikhti hain, `service_role`
   wali chahiye.

**Isse teen cheezein ek saath theek ho jayengi:**
- Database permanent ho jayega (abhi JSON file hai jo serverless pe udd sakti hai)
- Rate limiting durable ho jayegi (Redis ki zarurat khatam)
- Generated audio/images apne storage me save honge

---

### ✅ Step 2 — Hosting me environment variables daalo

Jahan bhi deploy kar rahe ho (Vercel / Netlify), wahan **Environment
Variables** me ye daalo:

```
GROQ_API_KEY               = <nayi key jo abhi banaoge>
NEXT_PUBLIC_SUPABASE_URL   = https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY  = <Settings → API → service_role>
SESSION_SECRET             = <koi bhi 40+ character ki random string>
BYOK_ENCRYPTION_SECRET     = <alag 40+ character ki random string>
```

**Random string kaise banayein** — terminal me:
```bash
openssl rand -base64 48
```
Do baar chalao, do alag-alag string milengi. Ek `SESSION_SECRET` me, doosri
`BYOK_ENCRYPTION_SECRET` me.

> **Zaroori:** ab agar production me ye do secrets missing hain to app **boot
> hi nahi hogi**. Ye maine jaan-bujh kar kiya hai — pehle wo chupchaap ek
> public default key use kar leta tha, jisse koi bhi kisi ka bhi session
> forge kar sakta tha.

**Vercel me kahan:** Project → Settings → Environment Variables → Add

Save karke **Redeploy** zaroor karna, warna purane env ke saath chalta rahega.

---

## Bas. Ho gaya.

Ye 2 step ke baad:

| Cheez | Pehle | Ab |
|---|---|---|
| AI jawab | Offline mode | **Asli models — 5 chat + 3 code** |
| Database | JSON file, udd sakti thi | **Permanent Postgres** |
| Rate limit | Bypass ho sakti thi | **Durable, shared** |
| Audio | Refresh pe gayab | **Save rehta hai** |
| Images | Doosre ka link | **Apne storage me** |

---

## Optional — jab chaho tab (abhi zarurat nahi)

Har extra key sirf **aur zyada model** kholti hai. Ek bhi na daalo, tab bhi
sab chalta rahega.

| Key | Kya milega | Kharcha |
|---|---|---|
| `OPENROUTER_API_KEY` | Dusre vendor ka backup — Groq down ho to bhi chale | Free credits |
| `ANTHROPIC_API_KEY` | Claude — PRO writing ke liye sabse achha | Paid |
| `OPENAI_API_KEY` | GPT-4o + GPT-4o Vision + OpenAI TTS + DALL·E 3 | Paid |
| `GOOGLE_API_KEY` | Gemini — lambe documents ke liye | Free tier |
| `FAL_KEY` | FLUX Dev/Pro — behtar images | Paid |
| `MISTRAL_API_KEY` | Mistral Large 2 (chat backup/fallback) | Free tier |
| `DEEPSEEK_API_KEY` | DeepSeek Coder V2 (sasta coding) | Open-source (sasta) |
| `TOGETHER_API_KEY` | Qwen 2.5 Coder (edge-case coding) | Open-source (sasta) |
| `STABILITY_API_KEY` | Stable Diffusion 3 (images) | Paid |
| `GOAPI_API_KEY` | Midjourney v6.1 (images, via GoAPI) | Paid |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (best voice) | Paid |
| `PLAYHT_API_KEY` | PlayHT TTS (voice cloning) | Paid |
| `DEEPGRAM_API_KEY` | Deepgram Nova-2 (speech-to-text) | Paid/free credits |

---

## Setup theek hua ya nahi — kaise check karein

Deploy ke baad browser me kholo:

```
https://aapka-domain.com/api/health
```

**Sahi setup me aisa dikhega:**

```json
{
  "providers": {
    "configured": ["Groq"],
    "llm": "multi-provider"
  },
  "models": {
    "catalogSize": 28,
    "byCapability": [
      { "capability": "chat", "total": 9, "reachable": 5 },
      { "capability": "code", "total": 6, "reachable": 3 }
    ]
  },
  "durability": {
    "database": "supabase",
    "rateLimits": "shared",
    "mediaStorage": "supabase"
  }
}
```

**`durability` block sabse important hai** — ye teen line batati hain ki setup
poora hua ya adhura:

| Field | ✅ Sahi | ❌ Galat | Galat ho to |
|---|---|---|---|
| `database` | `supabase` | `disk` / `memory` | Env vars nahi lage, ya redeploy nahi kiya |
| `rateLimits` | `shared` | `per-instance` | Wahi — dono ek hi env se chalte hain |
| `mediaStorage` | `supabase` | `ephemeral` | SQL me bucket wala hissa nahi chala |

| Field | Sahi value | Galat ho to matlab |
|---|---|---|
| `providers.configured` | `["Groq"]` | Khaali `[]` = key nahi lagi ya galat hai |
| `chat.reachable` | `5` | `0` = koi chat model nahi mil raha |

Agar `configured` khaali hai to key galat hai ya redeploy nahi kiya.

## Chalne ke baad ye zaroor test karna

Boss, ye 5 cheezein khud check kar lena — 5 minute lagenge:

1. **Chat** — "Explain photosynthesis simply" pucho.
   Ab asli jawab aana chahiye. Offline mode wala "I can't verify that" **nahi**
   dikhna chahiye.

2. **Agent** — Code mode me jao, likho *"build a calculator app"*, phir
   **Agent** button dabao. Live steps dikhne chahiye: files dekhna → likhna →
   verify → fix. Aakhir me green "Verified" banner.

3. **Image** — koi bhi prompt se image banao. Progress bar dikhna chahiye.

4. **Voice** — audio banao, phir **page refresh karo**. Ab bhi chalna chahiye
   (pehle gayab ho jaata tha).

5. **Files tab** — Code canvas me Files tab kholo. Agent ne jo file banayi wo
   dikhni chahiye.

Koi bhi cheez galat lage to mujhe batana — main fix kar dunga.

---

## Imaandar baat

Main ye sab **is sandbox se test nahi kar sakta** — yahan se Groq, Supabase,
har provider ka network blocked hai. Maine jo test kiya:

- ✅ Poora routing logic (28 models, 8/8 sahi pick)
- ✅ Agent ka poora loop — ek nakli model banakar (toota code likha → pakda →
  fix hua → verify hua)
- ✅ 38/38 regression, build clean, TypeScript clean

Jo **test nahi kar saka**: asli Groq ka jawab kaisa aayega, asli latency.

Isliye Step 1 aur 2 ke baad upar wale 5 test aapko karne honge. Wahi batayenge
ki asli duniya me kaisa chal raha hai.
