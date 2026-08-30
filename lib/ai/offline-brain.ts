/**
 * BUILDWE Offline Brain — genuinely useful answers with no provider key.
 *
 * WHY THIS EXISTS
 * ---------------
 * The old `smartOfflineChat()` echoed the user's own prompt back and asked
 * what they wanted. Real transcript from testing:
 *
 *   user: "Explain photosynthesis simply"
 *   bot:  "Tumne kaha: 'Explain photosynthesis simply' — Seedha bolo result
 *          kya chahiye — explanation, plan, draft, ya code"
 *
 *   user: "What is 2+2?"
 *   bot:  "Got 'What is 2+2?'. What do you need — answer, draft, code…"
 *
 * The user had already said exactly what they wanted. That is not an AI, it
 * is a parrot — and it is the single biggest reason the product didn't feel
 * like a real AI platform.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * Offline mode can't invent world knowledge, and it must never pretend to.
 * But a lot of real asks CAN be answered honestly without a model:
 *
 *   - arithmetic and unit conversions → computed exactly
 *   - "what can you do" / greetings → answered properly
 *   - writing tasks → a real usable structure, not a question back
 *   - code asks → actual working starter code, not "tell me more"
 *   - factual questions → honest "I can't verify that offline" + what IS
 *     possible, instead of bouncing the question back
 *
 * Rules kept: never bluff, never fake knowledge, never name vendors/keys.
 */

export type OfflineReply = { text: string; handled: boolean };

/* ── Language ─────────────────────────────────────────────── */

const HINGLISH_RE =
  /\b(kya|hai|hain|ho|kaise|kese|kyu|kyun|mujhe|tum|tumhe|bhai|yaar|karo|kro|kar|banao|bana|likho|batao|chahiye|nahi|haan|acha|theek|samajh|matlab|abhi|please karo)\b/i;

function isHinglish(text: string): boolean {
  return HINGLISH_RE.test(text);
}

/* ── 1. Arithmetic — actually compute it ──────────────────── */

/**
 * Safely evaluate a plain arithmetic expression. No eval, no identifiers:
 * the string is tokenised and parsed, so nothing executable can slip in.
 */
function tryArithmetic(raw: string): string | null {
  const cleaned = raw
    .replace(/what(?:'?s| is)|calculate|compute|solve|kitna|hota hai|=|\?/gi, " ")
    .replace(/[×✕]/g, "*")
    .replace(/[÷]/g, "/")
    .trim();

  if (!/^[\d\s+\-*/().%^]+$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned) || !/[+\-*/%^]/.test(cleaned)) return null;

  const tokens = cleaned.match(/\d+\.?\d*|[+\-*/()%^]/g);
  if (!tokens || tokens.length > 60) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      v = eat() === "+" ? v + parseTerm() : v - parseTerm();
    }
    return v;
  }
  function parseTerm(): number {
    let v = parsePow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = eat();
      const r = parsePow();
      if ((op === "/" || op === "%") && r === 0) throw new Error("div0");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function parsePow(): number {
    const base = parseFactor();
    if (peek() === "^") {
      eat();
      return Math.pow(base, parsePow());
    }
    return base;
  }
  function parseFactor(): number {
    if (peek() === "-") {
      eat();
      return -parseFactor();
    }
    if (peek() === "(") {
      eat();
      const v = parseExpr();
      if (peek() === ")") eat();
      return v;
    }
    const t = eat();
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error("bad");
    return n;
  }

  try {
    const result = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(result)) return null;
    const pretty = Number.isInteger(result)
      ? String(result)
      : String(Number(result.toFixed(10)));
    return `**${pretty}**`;
  } catch {
    return null;
  }
}

/* ── 2. Unit / base conversions ───────────────────────────── */

const UNITS: Record<string, { base: number; kind: string }> = {
  km: { base: 1000, kind: "length" }, m: { base: 1, kind: "length" },
  cm: { base: 0.01, kind: "length" }, mm: { base: 0.001, kind: "length" },
  mile: { base: 1609.34, kind: "length" }, miles: { base: 1609.34, kind: "length" },
  ft: { base: 0.3048, kind: "length" }, feet: { base: 0.3048, kind: "length" },
  inch: { base: 0.0254, kind: "length" }, inches: { base: 0.0254, kind: "length" },
  kg: { base: 1000, kind: "mass" }, g: { base: 1, kind: "mass" },
  mg: { base: 0.001, kind: "mass" }, lb: { base: 453.592, kind: "mass" },
  lbs: { base: 453.592, kind: "mass" }, pound: { base: 453.592, kind: "mass" },
  hour: { base: 3600, kind: "time" }, hours: { base: 3600, kind: "time" },
  hr: { base: 3600, kind: "time" }, min: { base: 60, kind: "time" },
  minute: { base: 60, kind: "time" }, minutes: { base: 60, kind: "time" },
  sec: { base: 1, kind: "time" }, second: { base: 1, kind: "time" },
  seconds: { base: 1, kind: "time" }, day: { base: 86400, kind: "time" },
  days: { base: 86400, kind: "time" },
  gb: { base: 1024, kind: "data" }, mb: { base: 1, kind: "data" },
  kb: { base: 1 / 1024, kind: "data" }, tb: { base: 1024 * 1024, kind: "data" },
};

function tryConversion(raw: string): string | null {
  // Temperature first: "100 F to C" also matches the generic <num><unit> to
  // <unit> shape, so checking it second would swallow the match and bail.
  const t = raw.match(
    /(-?\d+\.?\d*)\s*°?\s*(c|f|celsius|fahrenheit)\b[^a-z]*(?:to|in|into)\s*°?\s*(c|f|celsius|fahrenheit)\b/i
  );
  if (t) {
    const val = Number(t[1]);
    const from = t[2].toLowerCase()[0];
    const to = t[3].toLowerCase()[0];
    if (from === to) return `**${val}°${to.toUpperCase()}**`;
    const out = from === "c" ? (val * 9) / 5 + 32 : ((val - 32) * 5) / 9;
    return `**${Number(out.toFixed(2))}°${to.toUpperCase()}**`;
  }

  const m = raw.match(
    /(-?\d+\.?\d*)\s*([a-zA-Z]+)\s*(?:to|in|into|me|mein)\s*([a-zA-Z]+)/i
  );
  if (!m) return null;

  const val = Number(m[1]);
  const from = UNITS[m[2].toLowerCase()];
  const to = UNITS[m[3].toLowerCase()];
  if (!from || !to || from.kind !== to.kind) return null;

  const out = (val * from.base) / to.base;
  const pretty = Number.isInteger(out) ? String(out) : String(Number(out.toFixed(6)));
  return `**${pretty} ${m[3].toLowerCase()}**`;
}

/* ── 3. Capability / identity questions ───────────────────── */

function tryCapability(p: string, hin: boolean): string | null {
  if (
    !/what can you do|who are you|kya kar sakte|kya kar sakta|tum kaun|aap kaun|your features|help me with what|capabilities/i.test(
      p
    ) &&
    // "kya tum code likh sakte ho" / "can you write code" — asking about the
    // tool itself, not asking for the work to be done yet.
    !/\b(kya\s+(tum|aap)|can you|are you able to)\b.*\b(kar|karte|kar sakte|likh|likhte|bana|banate|banao|write|make|build|do|help)\b/i.test(
      p
    )
  ) {
    return null;
  }
  return hin
    ? `Main **BUILDWE** hoon — ek hi jagah paanch tools:

**Chat** — sawaal, likhai, planning, samjhaana
**Code** — website/app banao, bug fix karo, code samjho (live preview ke saath)
**Image** — text se picture banao — abhi bhi chalu hai
**Voice** — script se audio banao — abhi bhi chalu hai
**Auto** — tum likho, main khud sahi tool chun lunga

Bas likho kya chahiye — main wahi karunga.`
    : `I'm **BUILDWE** — five tools in one place:

**Chat** — questions, writing, planning, explanations
**Code** — build sites/apps, fix bugs, understand code (with live preview)
**Image** — turn text into pictures — working right now
**Voice** — turn scripts into audio — working right now
**Auto** — just type, I'll pick the right tool

Tell me what you need and I'll do it.`;
}

/* ── 4. Greetings ─────────────────────────────────────────── */

function tryGreeting(p: string, hin: boolean): string | null {
  if (
    !/^\s*(hi+|hey+|hello+|hy+|yo|namaste|salaam|good (morning|afternoon|evening))\b/i.test(
      p
    ) &&
    !/^\s*(kaise ho|kese ho|kya haal|what'?s up|sup)\b/i.test(p)
  ) {
    return null;
  }
  return hin
    ? `Hey! 👋 Main BUILDWE hoon.\n\nChat, code, image, voice — sab ek jagah. Bolo kya banana hai?`
    : `Hey! 👋 I'm BUILDWE.\n\nChat, code, images, voice — all in one place. What are we building?`;
}

/* ── 5. Writing tasks — give real structure ───────────────── */

function tryWriting(raw: string, p: string, hin: boolean): string | null {
  const isWriting =
    /\b(write|draft|compose|create|make|likho|banao)\b/i.test(p) &&
    /\b(essay|blog|article|post|email|letter|caption|copy|script|story|poem|haiku|bio|description|summary|pitch|resume|cover letter)\b/i.test(
      p
    );
  if (!isWriting) return null;

  const kind =
    p.match(
      /\b(essay|blog|article|post|email|letter|caption|copy|script|story|poem|haiku|bio|description|summary|pitch|resume|cover letter)\b/i
    )?.[1] || "piece";
  const topic = raw
    .replace(
      /\b(write|draft|compose|create|make|likho|banao|a|an|the|about|on|for|me)\b/gi,
      " "
    )
    // strip every format word, not just the one we matched, so "blog post
    // about remote work" yields "remote work" and not "post remote work"
    .replace(
      /\b(essay|blog|article|post|email|letter|caption|copy|script|story|poem|haiku|bio|description|summary|pitch|resume|cover letter|piece)\b/gi,
      " "
    )
    .replace(new RegExp(`\\b${kind}\\b`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();

  const t = topic || (hin ? "tumhare topic" : "your topic");

  return hin
    ? `**${kind} — "${t}"** ka structure ready hai:

**1. Hook** — pehli line jo rok le (sawaal, surprising fact, ya bold statement)
**2. Context** — 2-3 line: yeh kyu matter karta hai
**3. Main body** — 3 points, har point ek example ke saath
**4. Turn** — ek counter-point ya nuance (isse writing genuine lagti hai)
**5. Close** — ek takeaway line jo yaad rahe

Word count guide: short 150–250 · standard 400–600 · detailed 800+

_Note: abhi full writing model connect nahi hai, isliye maine structure diya
jo turant use ho sake. Live model aate hi main pura draft likh dunga — koi
bhi point bolo, uspe expand kar dunga._`
    : `Here's a working structure for your **${kind}** on "${t}":

**1. Hook** — one line that stops the scroll (question, surprising fact, bold claim)
**2. Context** — 2-3 lines on why this matters now
**3. Main body** — 3 points, each with a concrete example
**4. Turn** — one counter-point or nuance (this is what makes writing feel real)
**5. Close** — a single takeaway they'll remember

Length guide: short 150–250 · standard 400–600 · detailed 800+

_Note: the full writing model isn't connected right now, so I've given you a
structure you can use immediately. Once it's live I'll write the full draft —
tell me any section and I'll expand it._`;
}

/* ── 6. Code asks — give real starter code ────────────────── */

const SNIPPETS: { match: RegExp; lang: string; code: string; note: string }[] = [
  {
    match: /\btodo\b|\btask list\b/i,
    lang: "html",
    note: "Working todo app — saves to localStorage, runs as a single file.",
    code: `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Todo</title>
  <style>
    body{font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px}
    .row{display:flex;gap:8px}
    input{flex:1;padding:10px;border:1px solid #ddd;border-radius:8px}
    button{padding:10px 16px;border:0;border-radius:8px;background:#C45C26;color:#fff;cursor:pointer}
    li{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee}
    li.done span{text-decoration:line-through;opacity:.5}
    ul{list-style:none;padding:0}
  </style>
</head>
<body>
  <h1>Todo</h1>
  <div class="row">
    <input id="t" placeholder="What needs doing?">
    <button onclick="add()">Add</button>
  </div>
  <ul id="list"></ul>
<script>
  let items = JSON.parse(localStorage.getItem('todos') || '[]');
  function save(){ localStorage.setItem('todos', JSON.stringify(items)); render(); }
  function add(){
    const el = document.getElementById('t');
    const text = el.value.trim();
    if(!text) return;
    items.push({ text, done:false });
    el.value = '';
    save();
  }
  function toggle(i){ items[i].done = !items[i].done; save(); }
  function del(i){ items.splice(i,1); save(); }
  function render(){
    document.getElementById('list').innerHTML = items.map((it,i) =>
      '<li class="'+(it.done?'done':'')+'">' +
      '<input type="checkbox" '+(it.done?'checked':'')+' onchange="toggle('+i+')">' +
      '<span></span>' +
      '<button onclick="del('+i+')" style="margin-left:auto;background:#eee;color:#333">x</button>' +
      '</li>'
    ).join('');
    document.querySelectorAll('#list span').forEach((s,i)=> s.textContent = items[i].text);
  }
  render();
</script>
</body>
</html>`,
  },
  {
    match: /\bcounter\b/i,
    lang: "html",
    note: "Counter with increment, decrement and reset.",
    code: `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Counter</title>
<style>
 body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
 #n{font-size:64px;font-weight:600}
 button{font-size:20px;padding:8px 20px;margin:4px;border:0;border-radius:8px;cursor:pointer;background:#C45C26;color:#fff}
</style></head>
<body>
  <div style="text-align:center">
    <div id="n">0</div>
    <button onclick="step(-1)">−</button>
    <button onclick="step(1)">+</button>
    <button onclick="reset()" style="background:#eee;color:#333">reset</button>
  </div>
<script>
  let n = 0;
  const el = document.getElementById('n');
  function step(d){ n += d; el.textContent = n; }
  function reset(){ n = 0; el.textContent = n; }
</script>
</body>
</html>`,
  },
  {
    match: /\blanding page\b|\bhero section\b/i,
    lang: "html",
    note: "Responsive landing page skeleton — swap the copy and colours.",
    code: `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Landing</title>
  <style>
    *{box-sizing:border-box} body{font-family:system-ui;margin:0;color:#1a1a1a}
    .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
    header{display:flex;justify-content:space-between;align-items:center;height:72px}
    .hero{text-align:center;padding:80px 0}
    .hero h1{font-size:clamp(32px,6vw,56px);margin:0 0 16px;letter-spacing:-.02em}
    .hero p{font-size:18px;color:#666;max-width:560px;margin:0 auto 32px}
    .btn{display:inline-block;padding:14px 28px;background:#C45C26;color:#fff;
         border-radius:12px;text-decoration:none;font-weight:500}
    .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));padding:60px 0}
    .card{border:1px solid #eee;border-radius:16px;padding:24px}
  </style>
</head>
<body>
  <div class="wrap">
    <header><strong>Brand</strong><a class="btn" href="#">Get started</a></header>
    <section class="hero">
      <h1>Your headline goes here</h1>
      <p>One clear sentence explaining what you do and who it's for.</p>
      <a class="btn" href="#">Start free</a>
    </section>
    <section class="grid">
      <div class="card"><h3>Feature one</h3><p>What it does for the user.</p></div>
      <div class="card"><h3>Feature two</h3><p>What it does for the user.</p></div>
      <div class="card"><h3>Feature three</h3><p>What it does for the user.</p></div>
    </section>
  </div>
</body>
</html>`,
  },
  {
    match: /\bcalculator\b/i,
    lang: "html",
    note: "Calculator with a keypad and keyboard support.",
    code: `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Calculator</title>
<style>
 body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f5f5f5}
 .calc{background:#fff;padding:16px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
 #d{width:100%;height:56px;font-size:28px;text-align:right;border:0;background:#fafafa;
    border-radius:10px;padding:0 12px;margin-bottom:12px}
 .keys{display:grid;grid-template-columns:repeat(4,64px);gap:8px}
 button{height:56px;font-size:18px;border:0;border-radius:10px;background:#eee;cursor:pointer}
 button.op{background:#C45C26;color:#fff}
</style></head>
<body>
 <div class="calc">
  <input id="d" readonly value="0">
  <div class="keys" id="k"></div>
 </div>
<script>
 const d = document.getElementById('d');
 let cur = '0';
 const keys = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];
 document.getElementById('k').innerHTML = keys.map(k =>
   '<button class="'+('/*-+='.includes(k)?'op':'')+'" data-k="'+k+'">'+k+'</button>').join('')
   + '<button data-k="C" style="grid-column:span 4">Clear</button>';
 document.getElementById('k').onclick = e => {
   const k = e.target.dataset.k; if(!k) return; press(k);
 };
 function press(k){
   if(k === 'C'){ cur = '0'; }
   else if(k === '='){
     try { cur = String(Function('"use strict";return (' + cur + ')')()); }
     catch { cur = 'Error'; }
   }
   else { cur = cur === '0' && !'/*-+.'.includes(k) ? k : cur + k; }
   d.value = cur;
 }
 document.onkeydown = e => {
   if('0123456789+-*/.'.includes(e.key)) press(e.key);
   if(e.key === 'Enter') press('=');
   if(e.key === 'Escape') press('C');
 };
</script>
</body>
</html>`,
  },
];

function tryCode(raw: string, p: string, hin: boolean): string | null {
  const wantsCode =
    /\b(make|build|create|write|code|banao|bana|likho)\b/i.test(p) &&
    /\b(app|page|site|website|component|function|script|game|form|tool|html|css|js|javascript|react|python)\b/i.test(
      p
    );
  if (!wantsCode) return null;

  const hit = SNIPPETS.find((s) => s.match.test(p));
  if (hit) {
    return hin
      ? `Yeh raha working code — **${hit.note}**

\`\`\`${hit.lang}
${hit.code}
\`\`\`

Canvas me **Run ▶** dabao, turant chalega. Kuch badalna ho — colour, feature,
layout — bolo, main edit kar dunga.`
      : `Here's working code — **${hit.note}**

\`\`\`${hit.lang}
${hit.code}
\`\`\`

Hit **Run ▶** in the canvas to see it live. Want it changed — colours,
features, layout — just say what and I'll edit it.`;
  }

  // No snippet match: give a real scaffold, not a question.
  return hin
    ? `Iske liye ek starter scaffold:

\`\`\`html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>App</title>
  <style>
    body{font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px}
    button{padding:10px 16px;border:0;border-radius:8px;background:#C45C26;color:#fff;cursor:pointer}
  </style>
</head>
<body>
  <h1>App</h1>
  <div id="app"></div>
<script>
  const state = {};
  function render(){
    document.getElementById('app').innerHTML = '<p>Yahan apna UI banao</p>';
  }
  render();
</script>
</body>
</html>
\`\`\`

Ismein state, render aur styling ka base ready hai — **Run ▶** karke dekho.
Exact feature bolo (jaise "3 fields ka form" ya "score wala quiz"), main
poora bana dunga.`
    : `Here's a starter scaffold you can run right now:

\`\`\`html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>App</title>
  <style>
    body{font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px}
    button{padding:10px 16px;border:0;border-radius:8px;background:#C45C26;color:#fff;cursor:pointer}
  </style>
</head>
<body>
  <h1>App</h1>
  <div id="app"></div>
<script>
  const state = {};
  function render(){
    document.getElementById('app').innerHTML = '<p>Build your UI here</p>';
  }
  render();
</script>
</body>
</html>
\`\`\`

State, render and styling are wired up — press **Run ▶** to see it. Tell me the
specific feature (e.g. "a form with 3 fields" or "a quiz with scoring") and
I'll build it out.`;
}

/* ── 7. Factual questions — honest, never bounce back ─────── */

function tryFactual(raw: string, p: string, hin: boolean): string | null {
  const isQuestion =
    /^(what|who|when|where|why|how|which|is|are|does|do|can|should|will)\b/i.test(
      p
    ) ||
    // "Explain photosynthesis simply" has no "?" and no wh-word, but it is
    // absolutely a question in intent — this was falling through before.
    /^(explain|describe|define|summarise|summarize|compare|tell me)\b/i.test(p) ||
    /\btell me about\b/i.test(p) ||
    /\?$/.test(raw.trim()) ||
    /\b(kya|kaun|kab|kahan|kyu|kyun|kaise|samjhao|batao)\b/i.test(p);
  if (!isQuestion) return null;

  const explain = /\b(explain|describe|tell me about|samjhao|batao|what is|what are)\b/i.test(p);

  const topic = raw
    .replace(
      /^(what|who|when|where|why|how|which|is|are|does|do|can|should|will|explain|describe|tell me about|simply|briefly)\b/gi,
      " "
    )
    .replace(/\b(is|are|the|a|an|to|me|about|kya|hai|batao|samjhao)\b/gi, " ")
    .replace(/[?.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const t = topic ? `"${topic}"` : hin ? "is topic" : "that";

  if (explain) {
    return hin
      ? `${t} samjhane ke liye mujhe live knowledge model chahiye — jo abhi connect nahi hai. Main galat ya adhoora jawab dekar tumhara time waste nahi karunga.

**Abhi bhi jo main kar sakta hoon:**
• 🌐 **Web search on karo** — composer me globe icon dabao. Main live sources se jawab laa kar denge, sources ke link ke saath.
• 🖼 **Image banao** — abhi chalu hai, bilkul free
• 🔊 **Voice banao** — abhi chalu hai, bilkul free
• 💻 **Code** — starter code + structure abhi de sakta hoon

Search on karke wahi sawaal dobara pucho — mostly jawab mil jaata hai.`
      : `To explain ${t} properly I need the live knowledge model, which isn't connected right now. I won't guess — a wrong answer is worse than no answer.

**What I can still do right now:**
• 🌐 **Turn on web search** — the globe icon in the composer. I'll pull live sources and answer with links.
• 🖼 **Generate images** — working, free
• 🔊 **Generate voice** — working, free
• 💻 **Code** — I can give you working starter code and structure

Try the same question with search on — that usually gets you a real answer.`;
  }

  return hin
    ? `Is sawaal ka pakka jawab dene ke liye live model chahiye, jo abhi connect nahi hai. Andaaza lagana theek nahi hoga.

**🌐 Web search on karke** yahi sawaal dobara pucho — main live sources se jawab dunga, links ke saath. Image aur voice abhi bhi poori tarah chalu hain.`
    : `I need the live model to answer that reliably, and it isn't connected right now. Guessing wouldn't be fair to you.

**🌐 Turn on web search** and ask again — I'll answer from live sources with links. Image and voice generation are fully working meanwhile.`;
}

/* ── Entry point ──────────────────────────────────────────── */

/**
 * Best honest offline answer. Order matters: exact computations first,
 * then intent-shaped help, then an honest fallback.
 */
export function offlineAnswer(
  prompt: string,
  mode: "chat" | "code" = "chat"
): OfflineReply {
  const raw = String(prompt || "").trim();
  if (!raw) {
    return {
      text: "Tell me what you need — an answer, some code, an image, or a voice clip.",
      handled: false,
    };
  }

  const p = raw.toLowerCase();
  const hin = isHinglish(raw);

  // 1. Exact math — we can be 100% right about this
  const math = tryArithmetic(raw);
  if (math) {
    return {
      text: hin ? `${math}\n\nAur kuch calculate karna ho to bolo.` : `${math}\n\nNeed anything else calculated?`,
      handled: true,
    };
  }

  // 2. Unit conversion — also exact
  const conv = tryConversion(raw);
  if (conv) {
    return {
      text: hin ? `${conv}\n\nAur koi conversion?` : `${conv}\n\nAnother conversion?`,
      handled: true,
    };
  }

  // 3. Greetings
  const greet = tryGreeting(p, hin);
  if (greet) return { text: greet, handled: true };

  // 4. Capability questions
  const cap = tryCapability(p, hin);
  if (cap) return { text: cap, handled: true };

  // 5. Code requests (always in code mode; on demand in chat)
  if (mode === "code") {
    const code = tryCode(raw, p, hin) || tryCode(raw, p + " app", hin);
    if (code) return { text: code, handled: true };
  } else {
    const code = tryCode(raw, p, hin);
    if (code) return { text: code, handled: true };
  }

  // 6. Writing tasks
  const writing = tryWriting(raw, p, hin);
  if (writing) return { text: writing, handled: true };

  // 7. Questions — honest, with a real path forward
  const factual = tryFactual(raw, p, hin);
  if (factual) return { text: factual, handled: true };

  // 8. Final fallback — still never echoes the prompt back as a question
  return {
    text: hin
      ? `Is request ke liye live model chahiye, jo abhi connect nahi hai — isliye main adhoora jawab nahi de raha.

**Abhi jo chalu hai:**
• 🌐 Web search (composer me globe icon) — live jawab + sources
• 🖼 Image generation — free
• 🔊 Voice generation — free
• 💻 Code — working starter code

Inme se kuch bhi bolo, turant kar dunga.`
      : `That needs the live model, which isn't connected right now — so I'd rather not give you half an answer.

**Working right now:**
• 🌐 Web search (globe icon in the composer) — live answers with sources
• 🖼 Image generation — free
• 🔊 Voice generation — free
• 💻 Code — working starter code

Say the word on any of these and I'll do it immediately.`,
    handled: false,
  };
}
