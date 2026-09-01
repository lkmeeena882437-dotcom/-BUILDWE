"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle, KeyRound } from "lucide-react";

function ResetInner() {
  const params = useSearchParams();
  const [token, setToken] = useState(params.get("token") || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Reset failed");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mesh-bg flex min-h-[100dvh] items-center justify-center px-4" style={{ color: "var(--ink)" }}>
      <div className="anim-sheet w-full max-w-sm rounded-3xl border p-6" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Set a new password</h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Secure reset · link valid for 1 hour</p>
          </div>
        </div>

        {done ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: "var(--ok)" }} />
            <p className="text-sm font-medium">Password updated ✓</p>
            <Link href="/?auth=login" className="inline-flex h-10 items-center rounded-2xl px-4 text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
              Back to log in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Reset token (auto-filled from your link)"
              className="h-11 w-full rounded-2xl border px-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              minLength={8}
              className="h-11 w-full rounded-2xl border px-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
              required
            />
            {error && (
              <p className="flex items-start gap-1.5 text-xs" style={{ color: "var(--err)" }}>
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || password.length < 8 || !token}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Updating…" : "Update password"}
            </button>
            <p className="text-center text-[11px]" style={{ color: "var(--soft)" }}>
              Didn&apos;t request this? Ignore the link — your password stays unchanged.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh]" />}>
      <ResetInner />
    </Suspense>
  );
}
