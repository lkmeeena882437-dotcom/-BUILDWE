"use client";

/**
 * ModeMenu — the composer's one way to say what BUILDWE should be doing.
 *
 * WHY IT REPLACED THE FIVE CHIPS
 * ------------------------------
 * The chips showed every mode at once, which sounds like a virtue until you read what
 * each one actually said: four letters and an icon. `MODE_META` carries a real
 * description for every mode ("One box for thinking, building, visuals, and voice.")
 * and a strip of 11px buttons had nowhere to put it. Below `sm` the labels were hidden
 * entirely, so the most-used control in the product was five unidentified icons in an
 * overflow-x strip that scrolled under the thumb. The picker keeps the catalogue in the
 * same single owner (`lib/client/modes.ts` — still the only file that lists the modes)
 * and gives each one its sentence.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - No keyboard code. `Popover` wires ArrowUp/Down/Home/End, Escape, and focus return;
 *   a second implementation here would be the fourth one in this app.
 * - No streaming logic. Opening the menu changes nothing at all. The *pick* calls the
 *   page's `switchMode` via `onPick`, which is the function that aborts a running
 *   answer — that behaviour belongs to the page and predates this component.
 * - No re-picking the current mode. `switchMode` aborts whenever a stream is running,
 *   including for the mode you are already in, so selecting the ticked row used to
 *   cancel your own answer for nothing. The current row is `aria-disabled` with the
 *   reason on it, which also means a keyboard user can still land on it and read why.
 */
import { Fragment, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { Btn } from "@/lib/ui/Btn";
import { MenuDivider, MenuRow, Popover, menuTriggerProps } from "@/lib/ui";
import { MODE_META, modeMeta, type Mode } from "@/lib/client/modes";

/** Shared by the panel and the trigger's `aria-controls`; one place, no typo. */
export const MODE_MENU_ID = "bw-mode-menu";

export function ModeMenu({
  mode,
  onPick,
  className,
}: {
  mode: Mode;
  onPick: (m: Mode) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const active = modeMeta(mode);
  const ActiveIcon = active.icon;

  return (
    <div ref={anchorRef} className={clsx("relative flex min-w-0 shrink-0 items-center", className)}>
      <Btn
        variant="soft"
        size="sm"
        className="bw-mode__btn !h-8 !px-2.5 !text-[11px]"
        aria-label={`Mode: ${active.label}`}
        title={`${active.label} — ${active.sub}`}
        onClick={() => setOpen((v) => !v)}
        {...menuTriggerProps(open, MODE_MENU_ID)}
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {/* The label is what makes this control readable; below `sm` the icon plus the
            aria-label carry it, exactly as the chips did. */}
        <span className="hidden truncate sm:inline">{active.label}</span>
        <ChevronDown className="bw-mode__chev h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      </Btn>

      <Popover
        id={MODE_MENU_ID}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        mode="absolute"
        placement="above"
        align="start"
        width={276}
        label="Choose a mode"
      >
        {MODE_META.map((m, i) => {
          const on = m.id === mode;
          return (
            <Fragment key={m.id}>
              {/* Dividers only where a category ends: the router, then the text modes,
                  then the media ones. A menu with a rule under every row is a table. */}
              {(i === 1 || i === 3) && <MenuDivider />}
              <MenuRow
                dataAction={`mode-${m.id}`}
                icon={m.icon}
                title={m.label}
                hint={m.sub}
                selected={on}
                disabled={on}
                note="Already selected"
                onClick={() => {
                  setOpen(false);
                  // Defence, not the main gate: the row is inert above, but a caller who
                  // renders this enabled must not be able to kill a running answer by
                  // choosing the mode it is already in.
                  if (on) return;
                  onPick(m.id);
                }}
              />
            </Fragment>
          );
        })}
      </Popover>
    </div>
  );
}
