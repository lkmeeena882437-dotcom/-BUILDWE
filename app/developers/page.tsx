"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Terminal, Plus, Copy, Check, Trash2, Loader2, KeyRound } from "lucide-react";

type DevKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string };

export default function DevelopersPage() {
  const [keys, setKeys] = useState<DevKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ secret: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [needAuth, setNeedAuth] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/dev/keys", { credentials: "include" });
      const j = await r.json();
      if (j.requireAuth) setNeedAuth(true);
      setKeys(j.keys || []);
    } catch {
      /* */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const r = await fetch("/api/dev/keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "My key" }),
      });
      const j = await r.json();
      if (r.ok) {
        setFresh({ secret: j.secret, name: j.key.name });
        setName("");
        load();
      }
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/dev/keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    setKeys((ks) => ks.filter((k) => k.id !== id));
  };

  const curl = `curl -X POST https://buildwe.online/api/v1/chat \\
  -H "Authorization: Bearer bw_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Explain recursion like I am 12"}'`;

  return (
    <div className="min-h-[100dvh]" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <header className="border-b" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-xs text-white" style={{ background: "var(--accent)" }}>B</span>
            BUILDWE · Developers
          </Link>
          <Link href="/" className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--ink)", color: "var(--bg)" }}>
            Open workspace
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <section>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Terminal className="h-6 w-6" style={{ color: "var(--accent)" }} /> Developer API
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Build on BUILDWE from your own apps, scripts, and bots. One endpoint, OpenAI-style messages,
            30 requests/min per key. Free tier uses the platform model pool — add your own key in
            Settings → API keys for BYOK power.
          </p>
        </section>

        {/* Keys */}
        <section className="rounded-3xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" style={{ color: "var(--accent)" }} />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Your API keys</h2>
          </div>

          {needAuth && (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              <Link href="/" className="font-semibold" style={{ color: "var(--accent)" }}>Log in</Link> from the workspace first, then manage keys here.
            </p>
          )}

          {fresh && (
            <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                “{fresh.name}” created — copy it now, it won’t be shown again:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl px-2.5 py-2 text-[12px]" style={{ background: "var(--bg)" }}>{fresh.secret}</code>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(fresh.secret).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                  style={{ background: "var(--accent)" }}
                  aria-label="Copy key"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name (e.g. my-bot)"
              className="h-10 flex-1 rounded-2xl border px-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            />
            <button
              type="button"
              onClick={create}
              disabled={creating || needAuth}
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl px-4 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create key
            </button>
          </div>

          <div className="mt-3 space-y-1.5">
            {loading && <p className="text-xs" style={{ color: "var(--soft)" }}>Loading…</p>}
            {!loading && !keys.length && !needAuth && (
              <p className="text-xs" style={{ color: "var(--soft)" }}>No keys yet — create your first one above.</p>
            )}
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-2xl border px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{k.name}</div>
                  <code className="text-[11px]" style={{ color: "var(--muted)" }}>{k.prefix}…{k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ""}</code>
                </div>
                <button type="button" onClick={() => revoke(k.id)} className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ color: "red" }} aria-label="Revoke">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Docs */}
        <section className="rounded-3xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider">POST /api/v1/chat</h2>
          <pre className="mt-3 overflow-x-auto rounded-2xl p-4 text-[12px] leading-relaxed" style={{ background: "var(--code-bg)", color: "var(--code-fg)" }}>
            <code>{curl}</code>
          </pre>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider">Body</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" style={{ color: "var(--muted)" }}>
            <li><code>prompt</code> — string, one-shot question (or)</li>
            <li><code>messages</code> — array of {"{role: user|assistant|system, content}"}, last 20 kept</li>
            <li><code>mode</code> — &quot;chat&quot; (default) | &quot;code&quot;</li>
          </ul>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider">Response</h3>
          <pre className="mt-1 overflow-x-auto rounded-2xl p-4 text-[12px]" style={{ background: "var(--code-bg)", color: "var(--code-fg)" }}>
            <code>{`{
  "ok": true,
  "model": "Llama 3.3 70B",
  "modelBrand": "BUILDWE AI",
  "live": true,
  "reply": "…",
  "usage": { "characters": 123, "counted": true }
}`}</code>
          </pre>
          <p className="mt-3 text-[11px]" style={{ color: "var(--soft)" }}>
            Limits: 30 req/min per key · 10 keys per account · keys are hashed (SHA-256) at rest — copy when created.
            <code>live</code> says a provider actually answered; when it is <code>false</code> the answer came from
            the offline fallback and <code>usage.counted</code> is false too — no quota is spent on a call that
            never left the box, and <code>model</code> then names the fallback, not a vendor row.
          </p>
        </section>
      </main>
    </div>
  );
}
