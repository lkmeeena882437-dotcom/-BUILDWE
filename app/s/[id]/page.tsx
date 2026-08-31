"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Eye, ArrowLeft, Loader2 } from "lucide-react";
import { renderSafeMarkdown } from "@/lib/safe-md";

type SharedMsg = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: { title: string; url: string; host: string }[];
};

type ShareData = {
  title: string;
  mode: string;
  createdAt: string;
  views: number;
  messages: SharedMsg[];
};

function md(text: string): string {
  return renderSafeMarkdown(text, { looseBreaks: true });
}

export default function SharePage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = params instanceof Promise ? use(params) : params;
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/share?id=${encodeURIComponent(resolved.id)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Share not found");
        setData(j);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [resolved.id]);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header
        className="sticky top-0 z-10 border-b backdrop-blur-md"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            aria-label="Back to BUILDWE"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">
              {data?.title || "Shared chat"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>
              Read-only share · BUILDWE
            </div>
          </div>
          {data && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
              style={{ background: "var(--secondary)", color: "var(--muted)" }}
            >
              <Eye className="h-3 w-3" /> {data.views + 1}
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm" style={{ color: "var(--muted)" }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Opening shared chat…
          </div>
        )}
        {error && (
          <div className="rounded-3xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <p className="text-sm font-medium">{error}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              This link may have been deleted or never existed.
            </p>
            <Link href="/" className="mt-4 inline-block text-sm font-semibold" style={{ color: "var(--accent)" }}>
              Build your own free workspace →
            </Link>
          </div>
        )}
        {data && (
          <div className="space-y-4">
            {data.messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[min(100%,36rem)]">
                    {!isUser && (
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
                          style={{ background: "var(--accent)" }}
                        >
                          B
                        </span>
                        BUILDWE
                      </div>
                    )}
                    <div
                      className={`rounded-3xl px-4 py-3 text-[15px] leading-relaxed ${isUser ? "rounded-br-md" : "rounded-bl-md border"}`}
                      style={
                        isUser
                          ? { background: "var(--ink)", color: "var(--bg)" }
                          : { background: "var(--card)", borderColor: "var(--border)" }
                      }
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <div className="prose-bw" dangerouslySetInnerHTML={{ __html: md(m.content || "") }} />
                      )}
                      {!isUser && !!m.sources?.length && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                          {m.sources.slice(0, 5).map((s: { title: string; url: string; host: string }, j: number) => (
                            <a
                              key={j}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{ background: "var(--secondary)", color: "var(--muted)" }}
                            >
                              [{j + 1}] {s.host}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="pt-6 text-center text-[11px]" style={{ color: "var(--soft)" }}>
              Shared via{" "}
              <Link href="/" className="font-semibold" style={{ color: "var(--accent)" }}>
                BUILDWE.ONLINE
              </Link>{" "}
              — Build anything. Create everything.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
