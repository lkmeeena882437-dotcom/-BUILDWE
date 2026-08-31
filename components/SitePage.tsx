import Link from "next/link";
import type { ReactNode } from "react";

/** Shared shell for public trust/docs pages — consistent header + footer. */
export function SitePage({
  eyebrow,
  title,
  lede,
  children,
  wide,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-[100dvh] bg-[#F7F4EE] text-[#14110F]">
      <header className="border-b border-[#E6E0D6] bg-[#FBFAF7]/95 backdrop-blur">
        <div className={`mx-auto flex h-14 max-w-4xl items-center justify-between px-4`}>
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#14110F] text-xs text-[#F7F4EE]">B</span>
            BUILDWE
          </Link>
          <div className="flex items-center gap-4 text-sm text-[#6B6560]">
            <Link href="/how-it-works" className="hidden hover:text-[#14110F] sm:inline">How it works</Link>
            <Link href="/tools" className="hover:text-[#14110F]">Tools</Link>
            <Link href="/pricing" className="hidden hover:text-[#14110F] sm:inline">Pricing</Link>
            <Link href="/help" className="hidden hover:text-[#14110F] sm:inline">Help</Link>
            <Link href="/" className="rounded-xl bg-[#14110F] px-3 py-1.5 font-medium text-[#F7F4EE]">Open workspace</Link>
          </div>
        </div>
      </header>

      <main className={`mx-auto px-4 py-10 sm:py-14 ${wide ? "max-w-4xl" : "max-w-3xl"}`}>
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-wider text-[#C45C26]">{eyebrow}</p>
        )}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {lede && <p className="mt-3 text-[15px] leading-relaxed text-[#6B6560]">{lede}</p>}
        <div className="mt-8 space-y-10">{children}</div>
      </main>

      <footer className="border-t border-[#E6E0D6]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-xs text-[#9C958C]">
          <span className="font-semibold text-[#14110F]">BUILDWE.ONLINE</span>
          <Link href="/about" className="hover:text-[#14110F]">About</Link>
          <Link href="/how-it-works" className="hover:text-[#14110F]">How it works</Link>
          <Link href="/tools" className="hover:text-[#14110F]">Tools</Link>
          <Link href="/studios" className="hover:text-[#14110F]">Studios</Link>
          <Link href="/security" className="hover:text-[#14110F]">Security</Link>
          <Link href="/pricing" className="hover:text-[#14110F]">Pricing</Link>
          <Link href="/status" className="hover:text-[#14110F]">Status</Link>
          <Link href="/help" className="hover:text-[#14110F]">Help</Link>
          <Link href="/contact" className="hover:text-[#14110F]">Contact</Link>
          <Link href="/privacy" className="hover:text-[#14110F]">Privacy</Link>
          <Link href="/terms" className="hover:text-[#14110F]">Terms</Link>
          <Link href="/acceptable-use" className="hover:text-[#14110F]">Acceptable use</Link>
          <Link href="/developers" className="hover:text-[#14110F]">Developers</Link>
        </div>
      </footer>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-[#333]">{children}</div>
    </section>
  );
}
