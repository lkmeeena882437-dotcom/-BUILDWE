"use client";

import { MenuLabel, MenuRow, useMenuKeys } from "@/lib/ui";
import { fetchToolCatalogue } from "@/lib/client/api";
import { THEME_ITEMS } from "@/lib/client/theme";
import {
  buildRows,
  filterRows,
  sectionize,
  type PaletteRow,
  type PaletteSource,
} from "@/lib/client/palette";
import { Sheet } from "@/components/workspace/Sheet";
import {
  Columns2,
  FileCode2,
  Images,
  LayoutGrid,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * ⌘K — one field that reaches the whole workspace.
 *
 * WHY IT IS WORTH HAVING
 * ----------------------
 * Everything a palette would launch already exists and already works: nine sheets, five modes,
 * the conversations you were last in, 31 tools, the studios. What did not exist was a way to get
 * to any of them without first finding the right row in the right corner — and `GET /api/tools`
 * says in its own comment that it returns the catalogue as data so "the workspace launcher" can
 * render it, a component nobody had built, which left that route with zero readers.
 *
 * WHAT THIS DOES NOT DUPLICATE
 * ----------------------------
 * It owns no state and no form. A row either calls a handler `app/page.tsx` already has (new chat,
 * switch mode, open a sheet, set the theme, stop the run) or is a link to a page that already
 * renders (`/tools/[slug]`, `/studios/[slug]`) — with the same plain `<a>` the sidebar itself uses
 * for those two routes, not a router call that would need a second owner for the same navigation.
 * Tool *forms* in particular stay on their own page: rebuilding 31 field sets in here would be a
 * second copy of the registry's UI, which is the one thing this repo keeps having to delete.
 *
 * Ranking, caps and the row list live in `lib/client/palette.ts` (pure, and run by the suite). The
 * keyboard is `useMenuKeys` from `lib/ui` — arrows, Home/End, Tab wrap — and the focus handling is
 * `Sheet` from step 11, which is why this file is mostly markup.
 */

const ICONS = {
  new: Plus,
  stop: Square,
  mode: Sparkles,
  modal: LayoutGrid,
  theme: Settings,
  chat: MessageSquare,
  tool: Wrench,
  studio: Images,
} as const;

/** A few sheets earn a better icon than the generic grid. */
const MODAL_ICONS: Record<string, typeof LayoutGrid> = {
  compare: Columns2,
  teams: Users,
  profile: User,
  settings: Settings,
  skills: FileCode2,
};

export function CommandPalette({
  open,
  onClose,
  source,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** Everything the rows are built from is state the page already holds. */
  source: PaletteSource;
  /** One handler for every action, in the page, because the page owns the handlers. */
  onPick: (row: PaletteRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [catalogue, setCatalogue] = useState<{
    tools: PaletteSource["tools"];
    studios: PaletteSource["studios"];
  } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const asked = useRef(false);
  const menu = useMenuKeys(open);

  /* The catalogue is fetched once, on the first open — not on mount, because most sessions never
     press ⌘K, and a workspace that loads a 31-item menu it will not show is a slower workspace.
     A failure un-arms the flag, so the next open retries: "Tools and studios not loaded" is a
     state to escape from, not a verdict. */
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    fetchToolCatalogue()
      .then((c) => setCatalogue({ tools: c.tools, studios: c.studios }))
      .catch((e: Error) => {
        setListError(e.message);
        asked.current = false;
      });
  }, [open]);

  // A palette that still holds yesterday's query is worse than no palette.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { rows, hidden } = useMemo(
    () => filterRows(buildRows({ ...source, tools: catalogue?.tools, studios: catalogue?.studios }), query.trim()),
    [source, query, catalogue]
  );
  const sections = useMemo(() => sectionize(rows), [rows]);

  /* useMenuKeys hands back a RefObject<HTMLElement> and this element is a div, so the ref is
     assigned through a callback — the same shape lib/ui/MenuRow.tsx uses for its own rowRef. */
  const attachList = (node: HTMLDivElement | null) => {
    (menu.panelRef as React.MutableRefObject<HTMLElement | null>).current = node;
  };

  return (
    <Sheet title="Quick find" onClose={onClose} wide>
      <div
        // The keys are handled by the results list below, and the field is inside it in the tree:
        // ArrowDown from the field steps into the first row because the event bubbles there.
        onKeyDown={menu.onKeyDown}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--soft)" }} />
          <input
            // Sheet focuses this on open (data-autofocus), so the first keystroke is the query.
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter in the field means "the best match" — the whole reason to type.
              if (e.key === "Enter") {
                e.preventDefault();
                const top = rows[0];
                if (top) pick(top);
              }
            }}
            aria-label="Search chats, modes, sheets, tools and studios"
            aria-describedby="bw-palette-keys"
            placeholder="Find a chat, a mode, a tool…"
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full rounded-2xl pl-9 pr-3 text-sm outline-none"
            style={{ background: "var(--secondary)", color: "var(--ink)" }}
          />
        </div>
        <p id="bw-palette-keys" className="mt-2 text-[10px]" style={{ color: "var(--soft)" }}>
          <span className="font-mono">↑↓</span> move · <span className="font-mono">↵</span> open the top result ·{" "}
          <span className="font-mono">Esc</span> close
        </p>
      </div>

      <div ref={attachList} role="menu" aria-label="Results" className="mt-3 max-h-[46dvh] overflow-y-auto">
        {!rows.length && (
          <p className="px-1 py-3 text-xs" style={{ color: "var(--muted)" }}>
            {query.trim() ? (
              <>
                Nothing matches <span className="font-mono">{query.trim()}</span>. The sidebar still holds the
                full history — this is the jump list, and it also searches modes, sheets, tools and studios.
              </>
            ) : (
              "Nothing to open yet."
            )}
          </p>
        )}

        {sections.map((section) => (
          <div key={section.group} className="mb-1">
            <MenuLabel>{section.group}</MenuLabel>
            {section.rows.map((row) => {
              const Icon =
                row.kind === "theme"
                  ? THEME_ITEMS.find((i) => i.value === row.value)?.icon || ICONS.theme
                  : row.kind === "modal"
                    ? MODAL_ICONS[row.value] || ICONS.modal
                    : ICONS[row.kind];
              // Re-picking the live mode used to abort the answer in flight (step 5 found it in the
              // mode chip), so here the row says what is true instead of doing nothing with a tick.
              const isLiveMode = row.kind === "mode" && row.value === source.activeMode;
              return (
                <MenuRow
                  key={row.key}
                  dataAction={`palette:${row.kind}`}
                  icon={Icon}
                  title={row.title}
                  hint={row.hint}
                  href={row.href}
                  selected={isLiveMode}
                  disabled={isLiveMode}
                  note={isLiveMode ? "Already the mode you are in" : undefined}
                  onClick={row.href ? undefined : () => pick(row)}
                />
              );
            })}
          </div>
        ))}

        {/* The caps are visible, because a launcher that truncates quietly stops being trusted.
            With a query the number is "matches you outranked"; without one it is "rows this list is
            holding back" — two different sentences, so the line says which. */}
        {hidden > 0 && (
          <p className="px-1 py-2 text-[10px]" style={{ color: "var(--soft)" }}>
            {query.trim()
              ? `${hidden} more ${hidden === 1 ? "match" : "matches"} — keep typing to narrow it`
              : `${hidden} more ${hidden === 1 ? "row" : "rows"} here — type to search them all`}
          </p>
        )}

        {listError && (
          <MenuRow dataAction="palette:tools-error" icon={Wrench} title="Tools and studios not loaded" disabled note={listError} />
        )}
      </div>
    </Sheet>
  );

  function pick(row: PaletteRow) {
    onPick(row);
    onClose();
  }
}
