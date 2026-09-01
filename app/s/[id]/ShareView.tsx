"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { renderSafeMarkdown } from "@/lib/safe-md";
import { LinkPreviews } from "@/components/chat/LinkPreviews";

export type ShareDto = {
  title: string;
  mode: string;
  createdAt: string;
  views: number;
  /** True for a link made from one creation rather than a whole chat. */
  isArtifact: boolean;
  messages: {
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    sources?: { title: string; url: string; host: string }[];
  }[];
};

function md(text: string): string {
  return renderSafeMarkdown(text, { looseBreaks: true });
}

/**
 * The reader side of a share: the transcript, the cards under it, the count.
 *
 * The content itself is rendered on the server (see ./page.tsx), so this component only
 * adds the one thing a render cannot do — record the visit. That is a write, so it happens
 * in an effect on mount rather than in the RSC body, where a double render in development
 * would count one page open twice. A failed write leaves the stored count alone; nobody is
 * shown a number that was not really reached.
 */
export function ShareView({ share }: { share: ShareDto }) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    fetch("/api/share", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "view", id: window.location.pathname.split("/").pop() || "" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { views?: unknown } | null) => {
        if (!dead && typeof j?.views === "number") setViews(j.views);
      })
      .catch(() => {
        /* the view is optional furniture on a page whose content already rendered */
      });
    return () => {
      dead = true;
    };
  }, []);

  const shown = views ?? share.views;

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
            <div className="truncate text-sm font-semibold tracking-tight">{share.title}</div>
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>
              {share.isArtifact ? "Read-only creation · BUILDWE" : "Read-only share · BUILDWE"}
            </div>
          </div>
          {shown > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
              style={{ background: "var(--secondary)", color: "var(--muted)" }}
            >
              <Eye className="h-3 w-3" /> {shown}
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="space-y-4">
          {share.messages.map((m, i) => {
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
                    {/* Same cards as the app, same server-side read. A shared page is where a
                        bare link most needs context: the reader did not write the message. */}
                    {!isUser && (
                      <LinkPreviews text={m.content || ""} exclude={m.sources?.map((s) => s.url)} />
                    )}
                    {!isUser && !!m.sources?.length && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                        {m.sources.slice(0, 5).map((s, j) => (
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
      </div>
    </main>
  );
}
