"use client";

/**
 * CreationsPanel — the list of what a person actually made, and the four things worth
 * doing to it: name it, keep it, show it, remove it.
 *
 * WHY A PANEL AND WHY HERE
 * ------------------------
 * Every generation was already written to the store (image, audio, code, vision), and
 * `/api/ai/generations` already read them back — but only as fuel for two studios, which
 * each showed a slice of their own type. `code` generations were persisted and had no
 * reader at all: a session of building wrote rows nobody could open again. This is the
 * surface that was missing over the same rows, not a third copy of them.
 *
 * WHAT IS REAL HERE
 * -----------------
 * - Pin, rename and delete are three `fetch`es to the API that owns the rows. The list is
 *   re-read from the server after a write, so a row that was renamed by another tab or
 *   deleted by the retention cap cannot linger here as a comfortable lie.
 * - "Copy share link" asks the share API for the link; a creation with no file to open
 *   (audio made before media storage was configured) is *offered* as disabled with its
 *   reason on it, which is the honest version of a button that would fail.
 * - The audio row plays the stored file, not a placeholder tone, and pauses on unmount.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - No second store, no localStorage mirror: the server list is the only source, so a
 *   guest who signs in sees their migrated rows on the next open rather than a ghost list.
 * - No modal for rename. A row-wide input inside the row is the same trick the project
 *   chips use, and it keeps focus where the person put it.
 * - No grid/gallery toggle. Two layouts is two sets of bugs, and a list is the one that
 *   can show a title, a prompt, a date and a menu without cutting any of them off.
 */
import { EmptyState } from "@/components/workspace/EmptyState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Pause,
  Pencil,
  Pin,
  Play,
  Search,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Btn } from "@/lib/ui/Btn";
import { MenuDivider, MenuRow, Popover, SegmentedControl } from "@/lib/ui";
import {
  deleteArtifact as deleteArtifactApi,
  fetchArtifact,
  fetchArtifacts,
  shareArtifact,
  updateArtifact,
  type ArtifactItem,
} from "@/lib/client/api";

type Filter = "all" | ArtifactItem["type"];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "code", label: "Code" },
  // An answer saved out of a chat (UI step 13) — prose you kept, not a file a studio made.
  { value: "text", label: "Answers" },
];

const TYPE_LABEL: Record<ArtifactItem["type"], string> = {
  image: "Image",
  audio: "Audio",
  code: "Code",
  text: "Answer",
};

/** Only a real URL on an <img>/<a> src — the same rule the answer cards follow. */
function safeMediaUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function firstLine(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*`>_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function CreationsPanel({
  onOpenCode,
  onShowStudio,
  onOpenChat,
}: {
  /** Put the file in the canvas (page.tsx owns the canvas, its language and its versions). */
  onOpenCode: (code: string, lang: string) => void;
  /** Jump to the studio that can continue the work. */
  onShowStudio: (type: "image" | "audio") => void;
  /**
   * Back to the chat a saved answer came from. Optional because the panel is also used for rows
   * that never had a chat: a row without `meta.from` simply does not offer the action, which is
   * honest, rather than a menu item that goes nowhere.
   */
  onOpenChat?: (conversationId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ArtifactItem[] | null>(null);
  const [titleMax, setTitleMax] = useState(120);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadSeq = useRef(0);
  const editRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError("");
    try {
      const out = await fetchArtifacts(filter === "all" ? undefined : filter, 60);
      if (seq !== loadSeq.current) return;
      setItems(out.artifacts);
      setTitleMax(out.titleMax);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError((e as Error).message || "Could not load your creations.");
      setItems(null);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // One element at a time, and never left running when the sheet closes.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const shown = useMemo(() => {
    const list = items || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) =>
      `${a.title || ""} ${a.prompt}`.toLowerCase().includes(q)
    );
  }, [items, query]);

  const patch = useCallback(
    async (id: string, next: { title?: string | null; pinned?: boolean }) => {
      setBusyId(id);
      try {
        await updateArtifact(id, next);
        await load(); // the server's answer is the truth, including the cap's evictions
      } catch (e) {
        setError((e as Error).message || "That change could not be saved.");
      } finally {
        setBusyId("");
      }
    },
    [load]
  );

  const copy = useCallback(async (what: string, id: string) => {
    try {
      await navigator.clipboard.writeText(what);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
    } catch {
      setError("Your browser blocked the clipboard — select the text and copy it by hand.");
    }
  }, []);

  const doShare = useCallback(
    async (a: ArtifactItem) => {
      setBusyId(a.id);
      try {
        const { url } = await shareArtifact(a.id);
        await copy(`${window.location.origin}${url}`, a.id);
        await load();
      } catch (e) {
        setError((e as Error).message || "A share link could not be made for that creation.");
      } finally {
        setBusyId("");
      }
    },
    [copy, load]
  );

  const openCode = useCallback(
    async (a: ArtifactItem) => {
      setBusyId(a.id);
      try {
        // The list carries a trimmed body on purpose; opening needs the whole file.
        const full = await fetchArtifact(a.id);
        onOpenCode(String(full.outputText || "").trim(), "txt");
      } catch (e) {
        setError((e as Error).message || "That creation could not be opened.");
      } finally {
        setBusyId("");
      }
    },
    [onOpenCode]
  );

  const togglePlay = useCallback((a: ArtifactItem) => {
    const url = safeMediaUrl(a.outputUrl);
    if (!url) return;
    const el = audioRef.current;
    if (el && el.dataset.gen === a.id) {
      if (el.paused) {
        void el.play();
      } else {
        el.pause();
        setPlayingId(null);
      }
      return;
    }
    el?.pause();
    const next = new Audio(url);
    next.dataset.gen = a.id;
    next.onended = () => {
      audioRef.current = null;
      setPlayingId(null);
    };
    audioRef.current = next;
    setPlayingId(a.id);
    void next.play().catch(() => {
      audioRef.current = null;
      setPlayingId(null);
      setError("The browser refused to play that file. Open it in a new tab instead.");
    });
  }, []);

  const commitRename = useCallback(
    async (a: ArtifactItem) => {
      const value = draft.trim();
      setEditingId(null);
      if (value === (a.title || "")) return;
      await patch(a.id, { title: value || null });
    },
    [draft, patch]
  );

  const loading = items === null && !error;

  return (
    <div className="bw-creations" data-creations>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          ariaLabel="Filter creations by type"
          value={filter}
          onChange={(v) => setFilter(v)}
          items={FILTERS}
        />
        <div className="relative min-w-[8rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "var(--soft)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search creations"
            placeholder="Search"
            className="h-9 w-full rounded-xl pl-8 pr-2 text-xs outline-none"
            style={{ background: "var(--secondary)" }}
          />
        </div>
      </div>

      {!!items?.length && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--soft)" }}>
          {shown.length} of {items.length} shown · newest first, pinned on top ·{" "}
          <span title={`Titles are capped at ${titleMax} characters by the server`}>
            up to {titleMax} characters
          </span>
        </p>
      )}

      {error && (
        <div
          data-creations-error
          className="mt-2 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs"
          style={{ borderColor: "var(--err)", color: "var(--err)" }}
          role="alert"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <Btn variant="soft" size="sm" onClick={() => void load()}>
            Try again
          </Btn>
        </div>
      )}

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your creations…
        </p>
      )}

      {!loading && !error && !shown.length && (
        /* Which emptiness it is, in its own words: rows exist but none match the search is a
           different problem from an account that has made nothing, and the first one has a fix the
           panel can offer. `marker` renders `data-empty`, the handle the suite asserts on. */
        <EmptyState
          art="creations"
          marker="creations-empty"
          title={items?.length ? `Nothing matches “{query.trim()}”` : "Nothing here yet"}
          action={items?.length ? { label: "Clear the search", onClick: () => setQuery("") } : undefined}
        >
          {items?.length
            ? "That phrase is not in any title, prompt or answer inside this filter."
            : "An image, a voice clip or a code answer joins this list on its own, and any answer in a chat can be kept here from the row under it — there is nothing to switch on."}
        </EmptyState>
      )}

      <ul className="mt-3 space-y-1.5">
        {shown.map((a) => {
          const url = safeMediaUrl(a.outputUrl);
          const Icon = a.type === "image" ? ImageIcon : a.type === "audio" ? Volume2 : Code2;
          const busy = busyId === a.id;
          const open = menuId === a.id;
          const title = a.title || firstLine(a.prompt) || TYPE_LABEL[a.type];
          const bits = [
            TYPE_LABEL[a.type],
            a.pinned ? "pinned" : "",
            when(a.createdAt),
          ].filter(Boolean);
          return (
            <li
              key={a.id}
              data-artifact-row={a.id}
              className={clsx(
                "bw-side-item group flex items-start gap-2.5 rounded-2xl border px-2.5 py-2",
                busy && "opacity-60"
              )}
              style={{
                borderColor: a.pinned ? "var(--accent)" : "var(--border)",
                background: "var(--secondary)",
              }}
            >
              {a.type === "image" && url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-10 w-10 shrink-0 rounded-xl object-cover"
                  style={{ background: "var(--bg)" }}
                />
              ) : (
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: "var(--bg)", color: "var(--muted)" }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
              )}

              <div className="min-w-0 flex-1">
                {editingId === a.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={editRef}
                      value={draft}
                      maxLength={titleMax}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename(a);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      aria-label={`Title for ${title}`}
                      className="h-8 w-full rounded-lg px-2 text-xs outline-none"
                      style={{ background: "var(--bg)", color: "var(--ink)" }}
                    />
                    <Btn size="sm" onClick={() => void commitRename(a)}>
                      <Check className="h-3.5 w-3.5" />
                      <span className="sr-only">Save title</span>
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(null);
                        setDraft("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Cancel</span>
                    </Btn>
                  </div>
                ) : (
                  <p className="truncate text-xs font-medium" style={{ color: "var(--ink)" }}>
                    {title}
                  </p>
                )}
                <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--soft)" }}>
                  {bits.join(" · ")}
                  {a.shareId ? " · link on" : ""}
                </p>
              </div>

              {a.type === "audio" && url && (
                <button
                  type="button"
                  onClick={() => togglePlay(a)}
                  aria-label={playingId === a.id ? `Pause ${title}` : `Play ${title}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {playingId === a.id ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
              )}

              <RowMenu
                open={open}
                onToggle={() => setMenuId(open ? null : a.id)}
                artifact={a}
                hasUrl={Boolean(url)}
                onOpenChatRow={Boolean(onOpenChat)}
                onAction={(which) => {
                  setMenuId(null);
                  switch (which) {
                    case "openFile":
                      if (url) window.open(url, "_blank", "noopener,noreferrer");
                      return;
                    case "openCanvas":
                      void openCode(a);
                      return;
                    case "copyCode":
                      void (async () => {
                        setBusyId(a.id);
                        try {
                          const full = await fetchArtifact(a.id);
                          await copy(String(full.outputText || "").trim(), a.id);
                        } catch (e) {
                          setError((e as Error).message || "That creation could not be opened.");
                        } finally {
                          setBusyId("");
                        }
                      })();
                      return;
                    case "openChat": {
                      const from = (a.meta as { from?: { conversationId?: string } } | undefined)?.from;
                      if (from?.conversationId && onOpenChat) onOpenChat(from.conversationId);
                      return;
                    }
                    case "studio":
                      if (a.type === "image" || a.type === "audio") onShowStudio(a.type);
                      return;
                    case "pin":
                    case "unpin":
                      void patch(a.id, { pinned: which === "pin" });
                      return;
                    case "rename":
                      setEditingId(a.id);
                      setDraft(a.title || "");
                      return;
                    case "copyPrompt":
                      void copy(a.prompt || "", a.id);
                      return;
                    case "share":
                      void doShare(a);
                      return;
                    case "delete":
                      void (async () => {
                        setBusyId(a.id);
                        try {
                          await deleteArtifactApi(a.id);
                          await load();
                        } catch (e) {
                          setError((e as Error).message || "That creation could not be deleted.");
                        } finally {
                          setBusyId("");
                        }
                      })();
                      return;
                  }
                }}
              />
            </li>
          );
        })}
      </ul>

      {!!copiedId && (
        <p
          role="status"
          className="mt-2 flex items-center gap-1.5 text-[11px]"
          style={{ color: "var(--ok)" }}
        >
          <Check className="h-3 w-3" /> Copied.
        </p>
      )}
    </div>
  );
}

type RowAction =
  | "openFile"
  | "openCanvas"
  | "copyCode"
  | "openChat"
  | "copyPrompt"
  | "studio"
  | "pin"
  | "unpin"
  | "rename"
  | "share"
  | "delete";

/**
 * One row's actions. Built as a list of rows rather than nested ternaries: which actions
 * exist depends on what the *row has* (a stored file? a body? a link?), and that question
 * gets asked once here instead of at every JSX branch.
 */
function RowMenu({
  open,
  onToggle,
  artifact,
  hasUrl,
  onAction,
  onOpenChatRow,
}: {
  open: boolean;
  onToggle: () => void;
  artifact: ArtifactItem;
  hasUrl: boolean;
  onAction: (a: RowAction) => void;
  /** Present only when the panel was given a way back to a chat. */
  onOpenChatRow?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const isCode = artifact.type === "code";
  const isText = artifact.type === "text";
  const fromChat = (artifact.meta as { from?: { conversationId?: string } } | undefined)?.from?.conversationId;
  const label = artifact.title || firstLine(artifact.prompt) || "this creation";
  // A saved answer has no file, so its body is what is openable — the same rule code follows.
  const openable = isCode || isText ? Boolean(artifact.outputText) : hasUrl;

  return (
    <div
      ref={anchorRef}
      className="relative shrink-0"
      data-artifact-menu={artifact.id}
      data-open={open ? "true" : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "bw-side-hover flex h-7 w-7 items-center justify-center rounded-lg",
          open && "opacity-100"
        )}
        style={{ color: "var(--muted)" }}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      <Popover
        open={open}
        onClose={onToggle}
        anchorRef={anchorRef}
        mode="fixed"
        placement="left"
        align="end"
        width={236}
        label={`Actions for ${label}`}
      >
        {isCode ? (
          <MenuRow
            icon={Code2}
            title="Open in canvas"
            hint="The whole file, with a version pushed first"
            disabled={!openable}
            note="No code stored for that row"
            onClick={() => onAction("openCanvas")}
          />
        ) : (
          // Not `href` — MenuRow's anchor has no target, and an untargeted link to a media
          // file would navigate the workspace away and discard whatever is in the canvas. A
          // new tab from a click handler is the version of this that keeps the app alive.
          <MenuRow
            icon={ExternalLink}
            title="Open the file"
            disabled={!openable}
            note="No file stored for that row"
            onClick={() => onAction("openFile")}
          />
        )}
        {isCode && (
          <MenuRow
            icon={Copy}
            title="Copy the code"
            hint="Fetched whole, not the list preview"
            onClick={() => onAction("copyCode")}
          />
        )}
        {isText && (
          <MenuRow
            icon={Copy}
            title="Copy the answer"
            hint="Fetched whole, not the list preview"
            onClick={() => onAction("copyCode")}
          />
        )}
        {isText && fromChat && onOpenChatRow && (
          <MenuRow
            icon={MessageSquare}
            title="Open the chat it came from"
            hint="The answer stays kept here either way"
            onClick={() => onAction("openChat")}
          />
        )}
        {!isCode && !isText && (
          <MenuRow
            icon={artifact.type === "audio" ? Volume2 : ImageIcon}
            title={artifact.type === "audio" ? "Open the audio studio" : "Open the image studio"}
            hint="Continue it where it was made"
            onClick={() => onAction("studio")}
          />
        )}
        <MenuDivider />
        <MenuRow
          icon={Pin}
          title={artifact.pinned ? "Unpin" : "Pin to top"}
          hint={artifact.pinned ? "Back into date order" : undefined}
          onClick={() => onAction(artifact.pinned ? "unpin" : "pin")}
        />
        <MenuRow icon={Pencil} title="Rename" onClick={() => onAction("rename")} />
        <MenuRow icon={Copy} title="Copy the prompt" onClick={() => onAction("copyPrompt")} />
        <MenuDivider />
        <MenuRow
          icon={Link2}
          title={artifact.shareId ? "Copy share link" : "Create share link"}
          hint={
            artifact.shareId
              ? "Already public — this is the same link"
              : "A public page with just this"
          }
          disabled={!artifact.shareable && !artifact.shareId}
          note="Nothing stored to open yet"
          onClick={() => onAction("share")}
        />
        <MenuRow
          icon={Trash2}
          title="Delete"
          hint="Takes its share link with it"
          danger
          onClick={() => onAction("delete")}
        />
      </Popover>
    </div>
  );
}
