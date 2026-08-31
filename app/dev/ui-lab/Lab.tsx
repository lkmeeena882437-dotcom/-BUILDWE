"use client";

/**
 * The four shapes the primitives have to support, mounted for real:
 *
 *  A  a composer-style drop-up menu (mode="absolute", placement="above")
 *  B  a profile flyout anchored at the bottom of a CLIPPED box (mode="fixed":
 *     it must escape `overflow-hidden`, and a 12-row panel must clamp + scroll)
 *  C  a cascading submenu (placement="right") with Escape closing one level at a
 *     time and a click on the child not closing the parent
 *  D  the sliding segmented control, light and dark, plus a container that changes
 *     width on demand — the re-measure path (a collapsed sidebar is the real case)
 *
 * Each card prints what the DOM actually did into `data-testid="lab-log"`, so a
 * claim like "it flipped above" is readable, not something you have to eyeball.
 * `tests/ui.mjs` asserts this page's markup and the CSS that backs it.
 */
import { useRef, useState } from "react";
import {
  ChevronRight,
  Coins,
  Image as ImageIcon,
  KeyRound,
  Link2,
  LogOut,
  Mic,
  Monitor,
  Moon,
  Palette,
  Paperclip,
  Plus,
  Settings,
  Sun,
  Trash2,
  User,
  Users,
} from "lucide-react";
import clsx from "clsx";

/**
 * The demo lives in its own file so it can be split from the rest of the lab. A
 * `next/dynamic()` version of that was tried to keep /dev/ui-lab from pulling the
 * composer into a chunk shared with the landing page — measured, it changed nothing
 * for `/` (150 kB either way, because the +7 kB is `lib/ui` itself, which the pill now
 * imports) and it cost the lab its server render. So: the plain import, with the
 * measurement written down instead of the clever version.
 */
import { PromptBarDemo } from "./PromptBarDemo";
import {
  MenuDivider,
  MenuLabel,
  MenuRow,
  Popover,
  SegmentedControl,
  menuTriggerProps,
} from "@/lib/ui";
import { card, cardStyle, smallBtn, type Log } from "./kit";


export function Lab() {
  const [logMsg, setLogMsg] = useState("idle — open a menu");
  const log: Log = (m) => setLogMsg(m);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [plan, setPlan] = useState<"free" | "starter" | "pro" | "value">("pro");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-5">
        <p className="bw-eyebrow" style={{ color: "var(--accent)" }}>
          Step 1 · lib/ui primitives
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
          UI lab
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Nothing here is a feature: this page exists to prove the shared popover, menu and
          segmented control behave before the composer, the sidebar and the pricing page are
          rebuilt on top of them.
        </p>
      </header>

      <p
        data-testid="lab-log"
        className="mb-5 rounded-2xl border px-3 py-2 font-mono text-[12px]"
        style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--ink)" }}
        aria-live="polite"
      >
        {logMsg}
      </p>

      <div className="grid gap-4">
        <PromptBarDemo log={log} />
        <AttachDemo log={log} />
        <FlyoutDemo log={log} theme={theme} setTheme={setTheme} />
        <SegDemo log={log} plan={plan} setPlan={setPlan} />
      </div>

      <section className={clsx(card, "mt-4 rounded-[var(--radius)] border p-4")} style={cardStyle}>
        <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          Keyboard-only pass (do this once — it is the part an eyeball test never catches)
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-[13px]" style={{ color: "var(--muted)" }}>
          <li>Tab to a trigger, press Enter or Space, then ↓ ↓ Enter — a row must run.</li>
          <li>While a menu is open, press Tab at the last row: focus must stay inside the menu.</li>
          <li>Escape closes the menu and focus returns to the trigger that opened it.</li>
          <li>In card 2, open Theme and press Escape twice: once for the submenu, once for the menu.</li>
          <li>Scroll while a menu is open: the panel must follow its trigger, not the page.</li>
        </ol>
      </section>
    </main>
  );
}


/** Card 1 — a drop-up attachment menu, the exact shape the composer's `+` will use. */
function AttachDemo({ log }: { log: Log }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const rows = [
    { icon: ImageIcon, title: "Upload image", hint: "Reads it with vision", action: "upload-image" },
    { icon: Paperclip, title: "Attach text / CSV", hint: "Summarised, not pasted whole", action: "attach-file" },
    { icon: Link2, title: "Paste a link", hint: "Shows a preview card", action: "paste-link" },
    { icon: Mic, title: "Record voice note", hint: "Transcribed on the server", action: "record-voice" },
  ];

  return (
    <section className={clsx(card, "rounded-[var(--radius)] border p-4")} style={cardStyle}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>
        1 · Drop-up menu from a composer button
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>
        mode=&quot;absolute&quot;, placement=&quot;above&quot;. One row is intentionally disabled with a
        reason instead of being a silent dead button.
      </p>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            ref={ref}
            type="button"
            aria-label="Add"
            {...menuTriggerProps(open, "lab-attach")}
            onClick={() => setOpen((v) => !v)}
            className={smallBtn}
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--muted)" }}
          >
            <Plus className="h-4 w-4" />
          </button>
          <Popover
            id="lab-attach"
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={ref}
            mode="absolute"
            placement="above"
            align="start"
            width={252}
            label="Attach"
          >
            <MenuLabel>Attach</MenuLabel>
            {rows.map((r) => (
              <MenuRow
                key={r.action}
                dataAction={r.action}
                icon={r.icon}
                title={r.title}
                hint={r.hint}
                onClick={() => {
                  log(`ran ${r.action}`);
                  setOpen(false);
                }}
              />
            ))}
            <MenuDivider />
            <MenuRow dataAction="clear-attachment" icon={Trash2} title="Clear attachment" disabled note="Nothing attached" />
          </Popover>
        </div>

        <div
          className="flex h-11 flex-1 items-center rounded-full border px-3 text-[13px]"
          style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--soft)" }}
        >
          the real pill lands in Step 2 — this row only shows the menu&apos;s anchor geometry
        </div>
      </div>
      <GeometryButton target="#lab-attach" log={log} />
    </section>
  );
}

/** Card 2 — fixed flyout inside a clipped, short box, with a cascading submenu. */
function FlyoutDemo({
  log,
  theme,
  setTheme,
}: {
  log: Log;
  theme: "system" | "light" | "dark";
  setTheme: (t: "system" | "light" | "dark") => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const themeRowRef = useRef<HTMLElement | null>(null);
  const longList = Array.from({ length: 12 }, (_, i) => `Chat ${i + 1} — pinned note about the ₹99 pack`);

  return (
    <section className={clsx(card, "rounded-[var(--radius)] border p-4")} style={cardStyle}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>
        2 · Profile flyout, dark surface, anchored at the bottom of a clipped box
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>
        The panel is <code>position: fixed</code>, so the <code>overflow: hidden</code> box cannot
        clip it — that is why the sidebar flyout can sit next to a scrolling history list. Theme
        opens a submenu to the right; Escape closes one level at a time. Now scroll this card near
        the bottom of the window and reopen: it flips above on its own.
      </p>
      <div className="relative h-[210px] overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
        <div className="h-[150px] overflow-y-auto px-3 py-2 text-[12px]" style={{ color: "var(--muted)" }}>
          {longList.map((t) => (
            <div key={t} className="border-b py-1.5" style={{ borderColor: "var(--border)" }}>
              {t}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 border-t p-2" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <button
            ref={ref}
            type="button"
            {...menuTriggerProps(open, "lab-profile")}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left"
            style={{ background: open ? "var(--secondary)" : "transparent" }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ background: "var(--ink)", color: "var(--bg)" }}
            >
              B
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                you@buildwe.app
              </span>
              <span className="block truncate text-[11px]" style={{ color: "var(--soft)" }}>
                Free · 7 credits left
              </span>
            </span>
            <ChevronRight className={clsx("h-4 w-4 transition-transform", open && "-rotate-90")} style={{ color: "var(--muted)" }} />
          </button>

          <Popover
            id="lab-profile"
            open={open}
            onClose={() => {
              setOpen(false);
              setSub(false);
            }}
            anchorRef={ref}
            mode="fixed"
            placement="above"
            align="start"
            width={256}
            maxHeight={280}
            allowSubmenus
            pause={sub}
            label="Account & workspace"
          >
            <MenuRow dataAction="account" icon={User} title="Account & plan" onClick={() => log("would open the plans sheet")} />
            <MenuRow dataAction="credits" icon={Coins} title="Credits" right="7" onClick={() => log("would open the credits sheet")} />
            <MenuRow dataAction="settings" icon={Settings} title="Settings" onClick={() => log("would open settings")} />
            <MenuRow dataAction="teams" icon={Users} title="Teams" onClick={() => log("would open teams")} />
            <MenuRow dataAction="byok" icon={KeyRound} title="API keys (BYOK)" onClick={() => log("would open the key vault")} />
            <MenuDivider />
            <MenuRow
              dataAction="theme"
              rowRef={themeRowRef}
              icon={Palette}
              title={`Theme · ${theme}`}
              right={<ChevronRight className="h-3.5 w-3.5" />}
              selected={false}
              onClick={() => setSub((v) => !v)}
            />
            <div className="relative">
              <Popover
                open={sub}
                onClose={() => setSub(false)}
                anchorRef={themeRowRef}
                mode="fixed"
                placement="right"
                align="start"
                width={170}
                submenu
                label="Theme"
              >
                {([
                  { v: "system", label: "System", icon: Monitor },
                  { v: "light", label: "Light", icon: Sun },
                  { v: "dark", label: "Dark", icon: Moon },
                ] as const).map((o) => (
                  <MenuRow
                    key={o.v}
                    dataAction={`theme-${o.v}`}
                    icon={o.icon}
                    title={o.label}
                    selected={theme === o.v}
                    onClick={() => {
                      setTheme(o.v);
                      log(`theme → ${o.v} (both levels close, focus back on the row)`);
                      setSub(false);
                      setOpen(false);
                    }}
                  />
                ))}
              </Popover>
            </div>
            <MenuDivider />
            <MenuRow dataAction="logout" icon={LogOut} title="Log out" danger onClick={() => log("would log out")} />
          </Popover>
        </div>
      </div>
      <GeometryButton target="#lab-profile" log={log} />
    </section>
  );
}

/** Card 3 — the segmented control, both surfaces, and a forced re-measure. */
function SegDemo({
  log,
  plan,
  setPlan,
}: {
  log: Log;
  plan: "free" | "starter" | "pro" | "value";
  setPlan: (p: "free" | "starter" | "pro" | "value") => void;
}) {
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const items = [
    { value: "free" as const, label: "Free" },
    { value: "starter" as const, label: "Starter ₹99" },
    { value: "pro" as const, label: "PRO" },
    { value: "value" as const, label: "Value ₹399" },
  ];
  return (
    <section className={clsx(card, "rounded-[var(--radius)] border p-4")} style={cardStyle}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>
        3 · Segmented control with a sliding indicator
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>
        Arrow keys move the choice (a segmented control activates on arrow, unlike a menu). The
        indicator is measured, not flex-guessed — press &quot;change width&quot; and it slides to the new
        geometry instead of landing off-centre, which is exactly what a collapsing sidebar does to
        the auth sheet&apos;s tabs.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div style={{ width: narrow ? 190 : "100%", maxWidth: narrow ? 190 : 420, transition: "width var(--dur-slow) var(--ease)" }}>
          <SegmentedControl ariaLabel="Plan" items={items} value={plan} onChange={(v) => { setPlan(v); log(`plan → ${v}`); }} full />
        </div>
        <button
          type="button"
          onClick={() => setNarrow((v) => !v)}
          className="h-9 rounded-2xl border px-3 text-[13px] font-medium"
          style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--ink)" }}
        >
          {narrow ? "wide" : "change width"}
        </button>
        <div className="relative">
          <button
            ref={ref}
            type="button"
            aria-label="Density"
            {...menuTriggerProps(open, "lab-seg-dark")}
            onClick={() => setOpen((v) => !v)}
            className={smallBtn}
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--muted)" }}
          >
            <SlidersIcon />
          </button>
          <Popover
            id="lab-seg-dark"
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={ref}
            mode="fixed"
            placement="below"
            width={230}
            role="group"
            keyboard={false}
            label="Density"
          >
            <div className="px-1 pb-1 pt-0.5">
              <p className="mb-2 text-[11px]" style={{ color: "var(--surface-dark-muted)" }}>
                the same control on a dark surface, inside a popover
              </p>
              <SegmentedControl
                ariaLabel="Density"
                size="sm"
                dark
                full
                value={narrow ? "compact" : "cosy"}
                onChange={(v) => { setNarrow(v === "compact"); log(`density → ${v}`); }}
                items={[
                  { value: "cosy" as const, label: "Cosy" },
                  { value: "compact" as const, label: "Compact" },
                ]}
              />
            </div>
          </Popover>
        </div>
      </div>
    </section>
  );
}

/** Prints the panel's real geometry so a claim about clamping/flipping is checkable. */
function GeometryButton({ target, log }: { target: string; log: Log }) {
  return (
    <button
      type="button"
      className="mt-3 h-8 rounded-xl border px-2.5 text-[11px] font-medium"
      style={{ borderColor: "var(--border)", background: "transparent", color: "var(--muted)" }}
      onClick={() => {
        const el = document.querySelector<HTMLElement>(target);
        const panel = el?.firstElementChild as HTMLElement | null;
        if (!el || !panel) {
          log(`${target}: not open — nothing to measure`);
          return;
        }
        const r = panel.getBoundingClientRect();
        log(
          `${target}: placement=${el.dataset.placement ?? "?"} top=${Math.round(r.top)} height=${Math.round(r.height)} ` +
            `maxH=${panel.style.maxHeight || "auto"} overflowsViewport=${r.bottom > window.innerHeight - 4 || r.top < 4} ` +
            `scrollable=${panel.scrollHeight > panel.clientHeight}`
        );
      }}
    >
      log geometry
    </button>
  );
}

function SlidersIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    </svg>
  );
}
