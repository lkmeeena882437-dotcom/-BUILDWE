"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

function VerifyInner() {
  const params = useSearchParams();
  const [state, setState] = useState<"checking" | "ok" | "fail">("checking");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const token = params.get("token") || "";
    fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) {
          setEmail(j.email || "");
          setState("ok");
        } else {
          setState("fail");
        }
      })
      .catch(() => setState("fail"));
  }, [params]);

  return (
    <div className="mesh-bg flex min-h-[100dvh] items-center justify-center px-4" style={{ color: "var(--ink)" }}>
      <div className="anim-sheet w-full max-w-sm rounded-3xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        {state === "checking" && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin" style={{ color: "var(--accent)" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>Verifying your email…</p>
          </>
        )}
        {state === "ok" && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: "var(--ok)" }} />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">Email verified ✓</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{email}</p>
            <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-2xl px-4 text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
              Open BUILDWE
            </Link>
          </>
        )}
        {state === "fail" && (
          <>
            <XCircle className="mx-auto h-10 w-10" style={{ color: "var(--err)" }} />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">Link invalid or expired</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Request a fresh link from Settings.</p>
            <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-2xl border px-4 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
              Back home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh]" />}>
      <VerifyInner />
    </Suspense>
  );
}
