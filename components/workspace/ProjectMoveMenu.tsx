"use client";

/**
 * ProjectMoveMenu — the canvas header's "which project is this chat in, and which team can
 * see it" popover.
 *
 * WHY IT LEFT app/page.tsx
 * -----------------------
 * This was the last hand-rolled overlay in the workspace: a full-screen invisible
 * `<button>` to catch outside clicks, an absolutely positioned box, and no Escape, no
 * arrow keys, no focus return — dismissal by mouse only. `Popover` already does all of that
 * and is what every other menu in the app uses, so the fix was to move the surface onto the
 * shared primitive. The primitive lives in the component, not in `page.tsx`, because that
 * file is allowed exactly two imports from `lib/ui` (a test enforces it) — the page keeps
 * its own surface count low and the menu brings what it needs.
 *
 * THE NAME FIELD, AND WHY THERE IS NO window.prompt
 * ------------------------------------------------
 * Creating a project used to open the browser's own prompt dialog. A native dialog is
 * outside the app's focus management, cannot be styled, cannot show the store's own length
 * rule, and — the actual reason this matters — cannot keep what the person typed when the
 * request fails: a failed `window.prompt` flow loses the name. Here the input is inside the
 * popover, the field keeps its text on failure so the person can fix and resubmit, and the
 * limit comes from the server (`nameMax`) instead of being copied into a `maxLength`.
 */
import { useEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, Users, UserPlus } from "lucide-react";
import { Btn } from "@/lib/ui/Btn";
import { MenuDivider, MenuLabel, MenuRow, Popover, menuTriggerProps } from "@/lib/ui";

export const PROJECT_MENU_ID = "bw-project-menu";

export function ProjectMoveMenu({
  projects,
  teams,
  projectId,
  teamId,
  nameMax,
  onAssignProject,
  onAssignTeam,
  onCreateProject,
  onOpenTeams,
}: {
  projects: { id: string; name: string }[];
  teams: { id: string; name: string; memberCount: number }[];
  projectId: string | null;
  teamId: string | null;
  /** The store's cap, read from /api/projects. 0 means the server did not say. */
  nameMax: number;
  onAssignProject: (id: string | null) => void;
  onAssignTeam: (id: string | null) => void;
  /** Resolves when the project exists; a rejection leaves the typed name in the field. */
  onCreateProject: (name: string) => Promise<void> | void;
  onOpenTeams: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const close = () => {
    setOpen(false);
    setAdding(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreateProject(trimmed);
      setName("");
      setAdding(false);
      // Left open on purpose after a success: the checkmark has moved to the new project,
      // which is the confirmation. A native dialog could not show that.
    } catch {
      /* the page reports it in its own error strip; the text stays put to be fixed */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={anchorRef} className="relative">
      <Btn
        variant="icon"
        size="sm"
        aria-label={projectId ? "Move to project — a project is selected" : "Move to project"}
        title={projectId ? projects.find((p) => p.id === projectId)?.name || "Move to project" : "Move to project"}
        onClick={() => setOpen((v) => !v)}
        {...menuTriggerProps(open, PROJECT_MENU_ID)}
        style={projectId ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
      >
        <FolderOpen className="h-4 w-4" />
      </Btn>

      <Popover
        id={PROJECT_MENU_ID}
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        mode="absolute"
        placement="below"
        align="end"
        width={236}
        dark={false}
        keyboard={!adding}
        label="Move this chat"
      >
        {adding ? (
          <div className="p-2">
            <MenuLabel>New project</MenuLabel>
            <div className="mt-1 flex gap-1.5">
              <input
                ref={inputRef}
                value={name}
                {...(nameMax ? { maxLength: nameMax } : {})}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
                aria-label="Project name"
                placeholder="Startup site, DSA prep…"
                className="h-9 min-w-0 flex-1 rounded-xl border px-2 text-xs outline-none"
                style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--ink)" }}
              />
              <Btn size="sm" onClick={() => void submit()} disabled={!name.trim() || busy}>
                {busy ? "Saving…" : "Create"}
              </Btn>
            </div>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setName("");
              }}
              className="mt-1.5 text-[11px] font-semibold"
              style={{ color: "var(--muted)" }}
            >
              ← Back to the list
            </button>
          </div>
        ) : (
          <>
            <MenuLabel>Move chat to</MenuLabel>
            <MenuRow
              icon={FolderOpen}
              title="No project"
              selected={!projectId}
              onClick={() => {
                close();
                onAssignProject(null);
              }}
            />
            {projects.map((p) => (
              <MenuRow
                key={p.id}
                icon={FolderOpen}
                title={p.name}
                selected={projectId === p.id}
                onClick={() => {
                  close();
                  onAssignProject(p.id);
                }}
              />
            ))}
            <MenuRow
              icon={FolderPlus}
              title="New project"
              hint="A folder for chats and its files"
              onClick={() => setAdding(true)}
            />
            <MenuDivider />
            <MenuLabel>Shared with team</MenuLabel>
            {teams.length ? (
              <>
                <MenuRow
                  icon={Users}
                  title="Not shared"
                  selected={!teamId}
                  onClick={() => {
                    close();
                    onAssignTeam(null);
                  }}
                />
                {teams.map((t) => (
                  <MenuRow
                    key={t.id}
                    icon={Users}
                    title={t.name}
                    selected={teamId === t.id}
                    right={<span className="text-[10px]" style={{ color: "var(--soft)" }}>{t.memberCount}</span>}
                    onClick={() => {
                      close();
                      onAssignTeam(t.id);
                    }}
                  />
                ))}
              </>
            ) : (
              <MenuRow
                icon={UserPlus}
                title="Create / join a team"
                onClick={() => {
                  close();
                  onOpenTeams();
                }}
              />
            )}
          </>
        )}
      </Popover>
    </div>
  );
}
