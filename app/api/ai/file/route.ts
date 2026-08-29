import { NextRequest, NextResponse } from "next/server";
import { attachGuestCookie, getSessionFromRequest } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * File analysis — free, deterministic, no LLM key needed.
 * Client sends extracted text (text/csv/md/json/code…), we return
 * a compact statistical summary that gets injected into the chat prompt.
 */

const STOPWORDS = new Set(
  ("a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,it,its,this,that,these,those,i,you,he,she,we,they,them,his,her,their,our,your,my,me,us,not,no,yes,do,does,did,so,such,than,too,very,can,will,just,should,now,what,which,who,whom,when,where,why,how,all,any,both,each,few,more,most,other,some,only,own,same,s,t,d,ll,m,o,re,ve,y,ain,aren,couldn,didn,doesn,hadn,hasn,haven,isn,mightn,mustn,shouldn,wasn,weren,won,wouldn,hai,hain,ka,ki,ke,kar,karna,ko,se,mein,me,ye,wo,hoga,hui,hua,nahin,kya").split(
    ","
  )
);

type CsvColumn = {
  name: string;
  type: "number" | "text";
  filled: number;
  empty: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  samples: string[];
};

function analyzeCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delimiter = (lines[0].match(/;/g)?.length || 0) > (lines[0].match(/,/g)?.length || 0) ? ";" : ",";
  const split = (line: string) =>
    line
      .split(delimiter)
      .map((c) => c.trim().replace(/^"(.*)"$/, "$1"));

  const header = split(lines[0]);
  const dataLines = lines.slice(1, 2001);
  const cols: CsvColumn[] = header.map((name) => ({
    name: name || "(unnamed)",
    type: "text",
    filled: 0,
    empty: 0,
    unique: 0,
    samples: [],
  }));

  const uniques: Set<string>[] = header.map(() => new Set());
  const numeric: number[][] = header.map(() => []);

  dataLines.forEach((line, li) => {
    const cells = split(line);
    header.forEach((_, ci) => {
      const raw = cells[ci] ?? "";
      const col = cols[ci];
      if (!raw) {
        col.empty++;
        return;
      }
      col.filled++;
      uniques[ci].add(raw.toLowerCase());
      const n = Number(raw.replace(/[₹$,%\s]/g, ""));
      if (raw !== "" && Number.isFinite(n) && /^-?[\d.,]+$/.test(raw)) {
        col.type = "number";
        numeric[ci].push(n);
      } else if (col.samples.length < 3 && li < 5) {
        col.samples.push(raw.slice(0, 40));
      }
    });
  });

  cols.forEach((col, ci) => {
    col.unique = uniques[ci].size;
    const nums = numeric[ci];
    if (col.type === "number" && nums.length) {
      col.min = Math.min(...nums.slice(0, 1000));
      col.max = Math.max(...nums.slice(0, 1000));
      col.mean = Number(
        (nums.slice(0, 1000).reduce((a, b) => a + b, 0) / nums.length).toFixed(2)
      );
    }
  });

  return { rows: dataLines.length, columnsShown: cols.length, delimiter, cols };
}

function analyzeText(text: string) {
  const words = text.toLowerCase().match(/[a-z\u0900-\u097F][a-z\u0900-\u097F'-]{2,}/g) || [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w, n]) => `${w} (${n})`);
  return {
    lines: text.split(/\r?\n/).length,
    words: (text.match(/\S+/g) || []).length,
    chars: text.length,
    topKeywords: top,
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const ip = clientIp(req);
    const rl = rateLimit(`ai:file:${session.userId}:${ip}`, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests — wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const name = String(body?.name || "file");
    const text = String(body?.text || "");
    if (!text.trim()) {
      return NextResponse.json(
        { error: "Empty file — nothing to analyze." },
        { status: 400 }
      );
    }
    if (text.length > 200_000) {
      return NextResponse.json(
        { error: "File too large — keep under ~200 KB of text." },
        { status: 413 }
      );
    }

    const isCsv = /\.(csv|tsv)$/i.test(name) || /^\s*[^,\n]+,[^,\n]+/.test(text.split(/\r?\n/)[0] || "");
    let summary: string;
    let stats: Record<string, unknown>;

    if (isCsv) {
      const csv = analyzeCsv(text);
      if (csv) {
        const colLines = csv.cols
          .slice(0, 20)
          .map((c) =>
            [
              `  • ${c.name}: ${c.type}`,
              c.type === "number" && c.mean !== undefined
                ? ` min ${c.min}, max ${c.max}, avg ${c.mean}`
                : ` — e.g. ${c.samples.slice(0, 2).join(" / ") || "text"}`,
              ` (${c.unique} unique)`,
            ].join("")
          );
        summary = [
          `FILE ANALYSIS — ${name} (CSV table)`,
          `Rows: ${csv.rows} · Columns: ${csv.columnsShown} · Delimiter: "${csv.delimiter}"`,
          "Columns:",
          ...colLines,
          "Use these stats to answer the user's question about this data precisely.",
        ].join("\n");
        stats = { kind: "csv", rows: csv.rows, columns: csv.cols };
      } else {
        stats = { kind: "text" };
        summary = `FILE ANALYSIS — ${name}: CSV-like but too few rows to tabulate.`;
      }
    } else {
      const t = analyzeText(text);
      stats = { kind: "text", ...t };
      summary = [
        `FILE ANALYSIS — ${name}`,
        `Lines: ${t.lines} · Words: ${t.words} · Characters: ${t.chars}`,
        t.topKeywords.length ? `Frequent terms: ${t.topKeywords.join(", ")}` : "",
        "Excerpt (first 1200 chars):",
        text.slice(0, 1200),
      ]
        .filter(Boolean)
        .join("\n");
    }

    const res = NextResponse.json({ ok: true, name, stats, summary });
    attachGuestCookie(res, session.userId);
    return res;
  } catch (e) {
    console.error("[bw] file route", e);
    return NextResponse.json(
      { error: "Couldn't analyze that file." },
      { status: 500 }
    );
  }
}
