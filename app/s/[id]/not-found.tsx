import Link from "next/link";

/**
 * The page a dead share link shows.
 *
 * This used to be a client-side box inside a 200 response, which meant every reader that
 * only looks at the status line — a crawler, a link checker, the unfurl card in the chat
 * where the link was pasted — was told the share still existed. Now the route answers 404
 * and this is what it renders, so the human still gets an explanation and a way in rather
 * than the framework's bare "404".
 */
export default function ShareNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div
        className="w-full max-w-md rounded-3xl border p-8 text-center"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          This shared link has no content
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          The share was deleted, or the link was mistyped. Nothing is held back here — the
          page is simply not there.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block text-sm font-semibold"
          style={{ color: "var(--accent)" }}
        >
          Build your own free workspace →
        </Link>
      </div>
    </main>
  );
}
