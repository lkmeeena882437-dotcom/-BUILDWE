"use client";

import { MenuDivider, MenuLabel, MenuRow, Popover, menuTriggerProps } from "@/lib/ui";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FolderOpen,
  Layers,
  Loader2,
  RotateCcw,
  Share2,
  ShieldCheck,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useRef, useState } from "react";

/**
 * What you can do to one answer.
 *
 * WHY THIS IS A COMPONENT AND NOT FOURTEEN BUTTONS IN THE PAGE
 * ------------------------------------------------------------
 * The strip under an answer had grown to 16 controls in a row at 10-11px — copy, regenerate,
 * edit prompt, 👍, 👎, seven one-word transform chips, verify, use-as-prompt, download — and a
 * row you have to decode before you can use it is not a row of actions, it is a shrug. Now the
 * five things a person reaches for on every answer are visible, and the rest live in a menu that
 * is labelled, arrow-key navigable, and clamped to the viewport (`mode="fixed"`, because the
 * answer list scrolls and an absolutely positioned panel gets cut off by it).
 *
 * NOTHING HERE IS NEW POWER — with two exceptions, which are why the file exists at all:
 * **Share this answer** (`POST /api/share` with a `messageId`) publishes the question and that
 * reply as one page, `/s/<id>` rendering it from the snapshot; and **Save to creations**
 * (`POST /api/ai/generations` with `action:"save-answer"`) promotes it into the list where naming,
 * pinning and deleting already work. Both reuse the routes and the panel from steps 10–11; neither
 * invents a second copy of anything.
 *
 * A row that cannot run right now says so in its own `note` instead of being a dead click — the
 * rule every menu in this workspace follows, and the reason `streaming` is passed in rather than
 * the buttons being quietly hidden.
 */

/** The rewrites the strip had — all seven, none added, none reworded. Instruction text is the server's prompt, so it is kept verbatim from the inline
 *  strip this replaces — a "refactor" that softens an instruction changes what the model does. */
export const TRANSFORMS: { label: string; instruction: string }[] = [
  ["Simplify", "Rewrite your previous answer in simple, beginner-friendly language — keep every fact."],
  ["Shorten", "Rewrite your previous answer much shorter — only the essentials, keep it accurate."],
  ["Expand", "Expand your previous answer with more detail and useful examples — keep it accurate."],
  ["Example", "Give one concrete example for your previous answer."],
  [
    "Document",
    "Turn your previous answer into a clean shareable document: a clear title, short intro, well-organised sections with headings, and a one-line summary at the end. Keep every fact exactly as stated.",
  ],
  [
    "Table",
    "Turn your previous answer into a markdown table with clear column headers — one row per item. Keep every fact exactly as stated, and add a one-line note under the table.",
  ],
  [
    "Report",
    "Turn your previous answer into a short professional report: Title, Key findings (bullets), Details, Risks or caveats, and Recommended next steps. Keep every fact exactly as stated.",
  ],
].map(([label, instruction]) => ({ label, instruction }));

export type MessageActionHandlers = {
  copy: () => void;
  copied: boolean;
  verify: () => void;
  verifying: boolean;
  hasVerdict: boolean;
  share: () => void;
  sharing: boolean;
  save: () => void;
  saving: boolean;
  /** Saved during this session — the row then opens the panel instead of saving again. */
  saved: boolean;
  openCreations: () => void;
  regenerate: () => void;
  editPrompt: () => void;
  useAsPrompt: () => void;
  download: () => void;
  feedback: (vote: "up" | "down") => void;
  transform: (instruction: string) => void;
  /** Only these wait for the stream; the rest work mid-answer or are instant. */
  blocked: boolean;
  blockedNote: string;
};

export const MESSAGE_ACTIONS_MENU_ID = "bw-msg-more";

export function MessageActions({ handlers }: { handlers: MessageActionHandlers }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const h = handlers;

  /* Every row closes the menu on the way out: a row that acts and leaves the list hanging is a row
     you have to click twice to get rid of. The popover would also close on the outside pointerdown
     that follows, but that is a race with whatever the click opens (a sheet, a download), and a
     menu should not depend on the timing of the thing it just launched. */
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="mt-1 flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Copy this answer"
        title="Copy this answer"
        onClick={h.copy}
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ color: h.copied ? "var(--accent)" : "var(--muted)" }}
      >
        {h.copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>

      <button
        type="button"
        aria-label={h.hasVerdict ? "Verify again" : "Verify claims"}
        title={h.hasVerdict ? "Verify again against live sources" : "Verify — check facts against live sources"}
        disabled={h.verifying}
        onClick={h.verify}
        className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-50"
        style={{ color: "var(--muted)" }}
      >
        {h.verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
      </button>

      <button
        type="button"
        aria-label="Share this answer"
        title="Copy a public link to this answer on its own"
        disabled={h.sharing}
        onClick={h.share}
        className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-50"
        style={{ color: "var(--muted)" }}
      >
        {h.sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Share2 className="h-3.5 w-3.5" aria-hidden />}
      </button>

      <button
        type="button"
        aria-label="Good reply"
        title="This was useful"
        onClick={() => h.feedback("up")}
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ color: "var(--muted)" }}
      >
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Bad reply"
        title="This missed"
        onClick={() => h.feedback("down")}
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ color: "var(--muted)" }}
      >
        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
      </button>

      <span className="mx-1 h-3 w-px" style={{ background: "var(--border)" }} aria-hidden />

      <button
        ref={trigger}
        type="button"
        data-action="message-more"
        aria-label="More actions for this answer"
        className="flex h-7 items-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold"
        style={{ color: "var(--muted)", background: open ? "var(--secondary)" : "transparent" }}
        onClick={() => setOpen((v) => !v)}
        {...menuTriggerProps(open, open ? MESSAGE_ACTIONS_MENU_ID : undefined)}
      >
        More
        <ChevronDown className={open ? "h-3 w-3 rotate-180 transition-transform" : "h-3 w-3 transition-transform"} aria-hidden />
      </button>

      <Popover
        id={MESSAGE_ACTIONS_MENU_ID}
        label="More actions for this answer"
        dark={false}
        mode="fixed"
        anchorRef={trigger}
        placement="above"
        align="start"
        width={272}
        maxHeight={340}
        open={open}
        onClose={() => setOpen(false)}
      >
        <MenuRow
          dataAction="message-regenerate"
          icon={RotateCcw}
          title="Regenerate"
          hint="Throw this answer away and ask again"
          disabled={h.blocked}
          note={h.blocked ? h.blockedNote : undefined}
          onClick={act(h.regenerate)}
        />
        <MenuRow
          dataAction="message-edit-prompt"
          icon={SquarePen}
          title="Edit the question"
          hint="Put the question back in the composer"
          onClick={act(h.editPrompt)}
        />
        <MenuRow
          dataAction="message-use-as-prompt"
          icon={SquarePen}
          title="Use this answer as the next prompt"
          hint="Answer feeds the next question"
          onClick={act(h.useAsPrompt)}
        />
        <MenuDivider />
        {h.saved ? (
          <MenuRow dataAction="message-open-creations" icon={FolderOpen} title="Open in creations" hint="Named, pinned and shareable from there" onClick={act(h.openCreations)} />
        ) : (
          <MenuRow
            dataAction="message-save"
            icon={Layers}
            title="Save to creations"
            hint="Keep this answer out of the chat"
            disabled={h.saving}
            note={h.saving ? "Saving…" : undefined}
            onClick={act(h.save)}
          />
        )}
        <MenuRow dataAction="message-share" icon={Share2} title="Copy the answer's link"
          hint="The question and this reply, as one page"
          disabled={h.sharing}
          note={h.sharing ? "Minting the link…" : undefined}
          onClick={act(h.share)}
        />
        <MenuRow dataAction="message-download" icon={Download} title="Download as .txt" hint="For a folder this app never saw" onClick={act(h.download)} />
        <MenuDivider />
        <MenuLabel>Rewrite this answer</MenuLabel>
        {TRANSFORMS.map((t) => (
          <MenuRow
            key={t.label}
            dataAction={`message-transform-${t.label.toLowerCase()}`}
            title={t.label}
            hint={t.instruction.length > 64 ? `${t.instruction.slice(0, 61)}…` : t.instruction}
            disabled={h.blocked}
            note={h.blocked ? h.blockedNote : undefined}
            onClick={act(() => h.transform(t.instruction))}
          />
        ))}
      </Popover>
    </div>
  );
}

