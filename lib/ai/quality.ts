/**
 * BUILDWE Response Quality Gate (Update #1 · P0)
 *
 * Light, honest post-generation checks. No fake confidence numbers.
 * Labels: "good" | "review" — surfaced to the user, never silently hidden.
 */

export type QualityResult = {
  label: "good" | "review";
  notes: string[];
  checks: {
    onTopic: boolean;
    formatOk: boolean;
    lengthOk: boolean;
  };
};

const STOP = new Set(
  "a,an,the,and,or,but,if,then,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,it,this,that,i,you,me,my,we,our,they,their,do,does,did,can,could,will,would,should,not,no,yes,what,which,who,when,where,why,how,make,create,build,please,give,want,need,ka,ki,ke,ko,se,mein,kya,hai,ho,mujhe,banao,karo,batao".split(
    ","
  )
);

function contentWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z\u0900-\u097F][a-z\u0900-\u097F'-]{2,}/g) || []).filter(
    (w) => !STOP.has(w)
  );
}

export function qualityGate(input: {
  prompt: string;
  answer: string;
  mode: "chat" | "code";
}): QualityResult {
  const { prompt, answer, mode } = input;
  const notes: string[] = [];

  // 1) On-topic: meaningful word overlap between ask and answer
  const pw = new Set(contentWords(prompt));
  const aw = contentWords(answer);
  const overlap = aw.filter((w) => pw.has(w)).length;
  const onTopic = pw.size === 0 || overlap >= Math.min(2, pw.size);
  if (!onTopic) notes.push("answer may not address your exact ask — tap Verify or rephrase");

  // 2) Format: code requested → code block present
  const wantsCode =
    mode === "code" ||
    /(code|function|component|script|html|css|react|python|api|bug|fix|program)/i.test(
      prompt
    );
  const hasCode = /```/.test(answer);
  const formatOk = !wantsCode || hasCode;
  if (!formatOk) notes.push("you asked for code but the answer has none — say “give me the code”");

  // 3) Length: short factual ask vs wall of text
  const words = (answer.match(/\S+/g) || []).length;
  const isSimpleAsk =
    prompt.trim().split(/\s+/).length <= 6 && /^what|who|when|where|how many|kitne|kab/i.test(prompt.trim());
  const lengthOk = !(isSimpleAsk && words > 450);
  if (!lengthOk) notes.push("longer than needed for a quick question — tap Shorten");

  const label: QualityResult["label"] = onTopic && formatOk && lengthOk ? "good" : "review";
  return { label, notes, checks: { onTopic, formatOk, lengthOk } };
}

/* ── Claim extraction for the Verify action ──────────────── */

export type Claim = { text: string; kind: "statistic" | "date" | "price" | "superlative" };

export function extractClaims(answer: string, max = 4): Claim[] {
  const sentences = answer
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 300);
  const claims: Claim[] = [];
  for (const s of sentences) {
    let kind: Claim["kind"] | null = null;
    if (/\d+(\.\d+)?\s*%|percent|percentage/i.test(s)) kind = "statistic";
    else if (/₹|\$|rs\.?\s?\d|price|cost|costs/i.test(s)) kind = "price";
    else if (/\b(19|20)\d{2}\b|\bjan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec/i.test(s)) kind = "date";
    else if (/\b(best|fastest|largest|most|first|only|number one|#1|biggest|cheapest)\b/i.test(s)) kind = "superlative";
    else if (/\b\d{2,}\b/.test(s)) kind = "statistic";
    if (kind) claims.push({ text: s, kind });
    if (claims.length >= max) break;
  }
  return claims;
}
