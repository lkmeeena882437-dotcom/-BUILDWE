import type { Metadata } from "next";

/**
 * Branded 404.
 *
 * The default Next.js "404: This page could not be found." renders outside the
 * product's visual language and gives a visitor no route back. Shared links
 * and old tool URLs are the most common way someone lands here, so it should
 * look like the same product and point somewhere useful.
 */

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const LINKS = [
  { href: "/", label: "Workspace" },
  { href: "/tools", label: "Tools" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export default function NotFound() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-widest opacity-60">
          404
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-3 text-sm opacity-70">
          The link may be out of date, or the page may have moved. Nothing is
          wrong with your account.
        </p>

        <a
          href="/"
          className="mt-7 inline-block rounded-xl px-5 py-2.5 text-sm font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition"
        >
          Back to BuildWe
        </a>

        <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 justify-center text-sm">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="opacity-70 hover:opacity-100 underline underline-offset-4">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}
