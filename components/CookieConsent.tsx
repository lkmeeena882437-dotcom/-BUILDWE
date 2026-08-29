"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";

/** Small, honest cookie/consent notice — shown once, no tracking tricks. */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem("bw_consent")) {
        const t = setTimeout(() => setShow(true), 1200);
        return () => clearTimeout(t);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const close = () => {
    try {
      localStorage.setItem("bw_consent", "1");
    } catch {
      /* */
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="anim-rise fixed bottom-4 left-4 z-[70] max-w-sm rounded-2xl border p-4 shadow-xl" style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--ink)" }}>
      <div className="flex items-start gap-2.5">
        <Cookie className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
        <div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            We use essential cookies for login and sessions — no third-party ad trackers.
            See our{" "}
            <Link href="/privacy" className="font-semibold" style={{ color: "var(--accent)" }}>
              Privacy Policy
            </Link>
            .
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-3 py-1.5 text-[11px] font-semibold text-white"
              style={{ background: "var(--accent)" }}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
