"use client";

/**
 * The lab's mount of the real sidebar account menu (components/workspace/ProfileFlyout.tsx),
 * with inert wiring: every row logs instead of opening a sheet, because the lab has no
 * session and no `setModal` to call.
 *
 * Two things are worth checking by hand here rather than in the app:
 * 1. The submenu's alignment. It is `position: fixed`, which only works because nothing above
 *    it establishes a containing block — the panel's entrance animation ends on
 *    `transform: none` for exactly this reason. If someone reintroduces a `scale(1)` there,
 *    this submenu visibly slides away from its row.
 * 2. The collapsed rail (72px). The trigger loses its labels there, so it must still have an
 *    accessible name, still be at least 40px on touch, and the panel must still open at a
 *    readable width instead of inheriting the rail's 52px.
 */
import { useState } from "react";
import clsx from "clsx";
import { ProfileFlyout } from "@/components/workspace/ProfileFlyout";
import type { ThemePref } from "@/lib/client/theme";
import { card, cardStyle, smallBtn, type Log } from "./kit";

export function ProfileFlyoutDemo({ log }: { log: Log }) {
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<ThemePref>("system");

  return (
    <section className={clsx(card, "rounded-[var(--radius)] border p-4")} style={cardStyle}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>
        0b · The sidebar account menu (real component, inert wiring)
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>
        Open it, arrow down to Theme, open the submenu. Rows log here; in the app each one
        launches a sheet that already exists. Watch the submenu&apos;s left edge: it is fixed to
        the viewport and should sit exactly beside its row.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div
          className="flex flex-col justify-end rounded-2xl border p-2.5 transition-[width] duration-200"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", width: collapsed ? 72 : 240 }}
        >
          <ProfileFlyout
            collapsed={collapsed}
            name="Asha Rathi"
            email="asha@example.com"
            plan="free"
            byokActive
            teamName="Design"
            themePref={theme}
            onTheme={(v) => {
              setTheme(v);
              log(`theme → ${v}`);
            }}
            onOpenProfile={() => log("row → profile sheet")}
            onOpenPlans={() => log("row → plans sheet")}
            onOpenTeams={() => log("row → teams sheet")}
            onOpenByok={() => log("row → BYOK sheet")}
            onSignOut={() => log("row → doLogout()")}
          />
        </div>
        <button
          type="button"
          className={clsx(smallBtn, "h-9 w-auto px-2.5 text-[11px] font-medium")}
          style={{ borderColor: "var(--border)", background: "transparent", color: "var(--muted)" }}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "expand rail" : "collapse rail"}
        </button>
      </div>
    </section>
  );
}
