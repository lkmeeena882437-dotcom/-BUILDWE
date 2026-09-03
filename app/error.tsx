"use client";

/**
 * Root error boundary.
 *
 * Without this file a render crash anywhere in the tree falls through to
 * Next's built-in error screen — unstyled, off-brand, and on a production
 * build it says nothing a user can act on. This keeps a failure inside the
 * product's own shell and offers the two things that actually help: try
 * again, or go home.
 *
 * The error message itself is deliberately NOT rendered. In a production
 * build React already redacts it, but a digest is enough for an operator to
 * correlate with server logs without showing users an internal string.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[bw] render error", error?.digest || error?.message);
  }, [error]);

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-widest opacity-60">
          BUILDWE
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Something broke on this page
        </h1>
        <p className="mt-3 text-sm opacity-70">
          Your work is saved. This was a display error, not a lost conversation
          — reloading usually clears it.
        </p>

        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-xl px-5 py-2.5 text-sm font-medium border border-black/15 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/10 transition"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-xl px-5 py-2.5 text-sm font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition"
          >
            Back to BuildWe
          </a>
        </div>

        {error?.digest ? (
          <p className="mt-6 text-[11px] opacity-40">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
