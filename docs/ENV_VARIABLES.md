# Environment Variables — Poori List

**Version:** 1.11.2 · 30 August 2026

Boss, SQL ho gaya ✅ — ab variables. Ye list **code se nikali hai**, guess nahi.
Har naam wahi hai jo code sach me padhta hai.

**Kahan daalna hai:** Vercel → Project → **Settings** → **Environment
Variables** → Add. Sab daal kar **Redeploy** dabana zaroori hai.

---

## 🔴 ZAROORI — ye 6 abhi daalo

Inke bina platform adhura rahega.

| # | Variable | Value | Kya hoga |
|---|---|---|---|
| 1 | `GROQ_API_KEY` | `gsk_...` (nayi wali) | **AI live** — chat + code kaam karenge |
| 2 | `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | Database + rate limit + storage |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` (Settings → API → **service_role**) | Wahi ↑ |
| 4 | `SESSION_SECRET` | `openssl rand -base64 48` | **Login security** |
| 5 | `BYOK_ENCRYPTION_SECRET` | `openssl rand -base64 48` (**alag** string) | User ki keys encrypt |
| 6 | `NEXT_PUBLIC_APP_URL` | `https://buildwe.online` | Sahi links, share, emails |

### ⚠️ #4 aur #5 par dhyan do

**Ye do na daale to app production me boot hi nahi hogi** — maine jaan-bujh kar
aisa kiya hai. Pehle inke bina app ek *public default key* use kar leti thi,
jisse koi bhi kisi ka bhi login forge kar sakta tha.

**Random string banane ka tarika** — terminal me:
```bash
openssl rand -base64 48
```
Do baar chalao. Dono string **alag** honi chahiye.

Terminal na ho to online: https://generate-secret.vercel.app/48

### ⚠️ #3 par dhyan do

Supabase me **do** keys dikhengi. `anon` **nahi** — **`service_role`** leni hai
(Reveal dabana padega). Ye poore database ka master password hai:
- ❌ frontend code me kabhi nahi
- ❌ git me kabhi nahi
- ✅ sirf Vercel ke env me

---

## 🟡 PAYMENTS — jab PRO bechna shuru karo

Abhi platform **demo mode** me hai, matlab PRO upgrade button asli paise nahi
leta. Asli payment chalu karne ke liye ye 4 chahiye:

Koi **demo/mock switch nahi hai** is repo me: keys na hone par checkout `503 CHECKOUT_UNAVAILABLE`
deta hai aur PRO ya credits kisi bhi haalat me nahi milte — ek flag jo "paid" bol de, wo
feature nahi bug hota (audit C1 isi liye gaya).

| Variable | Kahan milega |
|---|---|
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Razorpay → Settings → API Keys (`rzp_live_...`) |
| `RAZORPAY_KEY_SECRET` | Wahi page, secret wala |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks → banate waqt set karte ho |

**Webhook URL Razorpay me ye daalna:** `https://buildwe.online/api/checkout/webhook`

Price badalni ho to (optional):

| Variable | Default | Matlab |
|---|---|---|
| `RAZORPAY_PRO_AMOUNT_PAISE` | `50000` | ₹500 (paise me hai — 50000 = ₹500) |
| `RAZORPAY_PRO_CURRENCY` | `INR` | |
| `RAZORPAY_PRO_PLAN_NAME` | `BUILDWE PRO` | Checkout par dikhta naam |

---

## 🟢 OPTIONAL — aur zyada AI models

Ek bhi na daalo, sab chalta rahega. Har key sirf **aur models** kholti hai.

| Variable | Kya milega | Kharcha |
|---|---|---|
| `OPENROUTER_API_KEY` | Backup vendor — Groq down ho to bhi chale | Free credits |
| `GOOGLE_API_KEY` | Gemini — lambe documents ke liye | **Free tier** |
| `ANTHROPIC_API_KEY` | Claude — PRO writing me sabse achha | Paid |
| `OPENAI_API_KEY` | GPT-4o + GPT-4o Vision + OpenAI TTS + DALL·E 3 | Paid |
| `FAL_KEY` | **FLUX Dev/Pro images** — daalte hi UI me apne aap dikhenge | Paid |
| `HF_TOKEN` | SDXL images, budget fallback | Free tier |
| `MISTRAL_API_KEY` | Mistral Large 2 (chat backup/fallback) | Free tier |
| `DEEPSEEK_API_KEY` | DeepSeek Coder V2 (sasta coding) | Open-source (sasta) |
| `TOGETHER_API_KEY` | Qwen 2.5 Coder (edge-case coding) | Open-source (sasta) |
| `STABILITY_API_KEY` | Stable Diffusion 3 (images) | Paid |
| `GOAPI_API_KEY` | Midjourney v6.1 (images, via GoAPI) | Paid |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (best voice) | Paid |
| `PLAYHT_API_KEY` | PlayHT TTS (voice cloning) | Paid |
| `DEEPGRAM_API_KEY` | Deepgram Nova-2 (speech-to-text) | Paid/free credits |

> `FAL_KEY` daalte hi Image Studio me naye models **khud** aa jayenge — code
> chhune ki zarurat nahi. Ye maine v1.11.1 me banaya tha. Same behavior har
> naye provider ke saath hai — key daalo, model router me apne aap aa jayega.

### Social login (optional)

| Variable | Kahan |
|---|---|
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth |
| `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | GitHub → Settings → Developer settings → OAuth Apps |

---

## ⚙️ Limits badalne ke liye (optional)

Free/PRO ki limits code me nahi, env me hain — jab chaho badal lo.

| Variable | Default | Matlab |
|---|---|---|
| `FREE_CODE_DAILY_LIMIT` | `15` | Free user roz 15 code generation |
| `FREE_IMAGE_DAILY_LIMIT` | `5` | Free user roz 5 image |
| `FREE_AUDIO_DAILY_LIMIT` | `5` | Free user roz 5 audio |
| `PRO_CODE_MONTHLY_LIMIT` | `500` | PRO mahine me 500 |
| `PRO_IMAGE_MONTHLY_LIMIT` | `999999` | PRO practically unlimited |
| `PRO_AUDIO_MONTHLY_LIMIT` | `999999` | Wahi |

Default model badalna ho to: `AI_CHAT_MODEL`, `AI_CODE_MODEL`,
`AI_IMAGE_MODEL`, `AI_AUDIO_MODEL` (aur inke `_PRO` version).

---

## ❌ Ye mat daalna

| Variable | Kyun nahi |
|---|---|
| `SHOW_DEV_LINKS` | Sirf local dev ke liye. Production me password-reset link screen par dikha dega. |
| `BUILDWE_DATA_DIR` | Local testing ke liye. Vercel par khud handle ho jata hai. |
| `BUILDWE_ALLOW_LEGACY_GUEST` | Purane guest cookies ke liye. Naye deploy me zarurat nahi. |

---

## Copy-paste ready — minimum setup

Vercel me ye 6 lines (values apni bharna):

```
GROQ_API_KEY=gsk_yahan_nayi_key
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role JWT — never commit this>
SESSION_SECRET=yahan_48_char_random
BYOK_ENCRYPTION_SECRET=yahan_alag_48_char_random
NEXT_PUBLIC_APP_URL=https://buildwe.online
```

**Redeploy dabana mat bhoolna.**

---

## Check karo sahi laga ya nahi

`https://buildwe.online/api/health` kholo:

```json
{
  "providers": { "configured": ["Groq"], "llm": "multi-provider" },
  "durability": {
    "database": "supabase",
    "rateLimits": "shared",
    "mediaStorage": "supabase"
  }
}
```

| Dikhe | Matlab |
|---|---|
| `configured: []` | Groq key nahi lagi — spelling check karo, redeploy karo |
| `database: "disk"` | Supabase ke 2 vars nahi lage |
| `rateLimits: "per-instance"` | Wahi ↑ |
| `mediaStorage: "ephemeral"` | SQL me bucket wala hissa nahi chala |

Teeno green ho gaye to **setup complete** ✅
