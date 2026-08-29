"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

type PrintMsg = { role: "user" | "assistant"; content: string };

export default function PrintPage() {
  const [msgs, setMsgs] = useState<PrintMsg[]>([]);
  const [title, setTitle] = useState("BUILDWE chat");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("bw_print");
      if (raw) {
        const d = JSON.parse(raw) as { title?: string; messages: PrintMsg[] };
        setMsgs(d.messages || []);
        setTitle(d.title || "BUILDWE chat");
      }
    } catch {
      /* */
    }
  }, []);

  return (
    <main className="mx-auto max-w-2xl bg-white px-6 py-8 text-[#14110F]">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div className="text-sm font-semibold">{title}</div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#C45C26] px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
        </button>
      </div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-6 text-xs text-[#9C958C]">
        Exported from BUILDWE.ONLINE · {new Date().toLocaleString()}
      </p>
      <div className="space-y-4">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[92%] rounded-2xl px-4 py-2.5 text-left text-[13px] leading-relaxed ${
                m.role === "user"
                  ? "bg-[#F4F0E8]"
                  : "border border-[#E6E0D6]"
              }`}
            >
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-[#9C958C]">
                {m.role === "user" ? "You" : "BUILDWE"}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          </div>
        ))}
        {!msgs.length && (
          <p className="py-16 text-center text-sm text-[#9C958C]">
            Nothing to print — export a chat from Settings first.
          </p>
        )}
      </div>
      <p className="mt-10 text-center text-[10px] text-[#9C958C]">
        buildwe.online — Build anything. Create everything.
      </p>
    </main>
  );
}
