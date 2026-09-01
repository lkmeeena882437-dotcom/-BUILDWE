/**
 * groupHistory — how the sidebar's chat list is bucketed.
 *
 * Pure and dependency-free on purpose: `tests/ui.mjs` compiles this exact file and runs it,
 * so the rule that matters most ("no chat may disappear") is tested as real code rather than
 * as a screenshot. Nothing here knows about React.
 *
 * THE RULES, and why each one is what it is
 * -----------------------------------------
 * 1. A chat goes to its **project** first, then its **team**, then the `Chats` bucket.
 *    Project wins because it is the narrower bucket and the one the user typed a name for.
 * 2. A `projectId` that no longer names an existing project does NOT hide the chat — it lands
 *    in `Chats`. This is a live case, not a hypothetical: deleting a project keeps its chats
 *    (the page unsets the current project and refreshes), so a partition keyed blindly on
 *    `h.projectId` would invent group headers for ghosts and, if the caller then only rendered
 *    known projects, quietly drop those conversations from the sidebar. Losing someone's chat
 *    to a UI refactor is the one failure mode this file exists to prevent.
 * 3. Every item is placed by an `else`, never by a filter. A `list.filter(pred)` chain adds
 *    up to "some items belong to no group" the moment a predicate is edited.
 * 4. Empty groups are omitted. A header reading "0" is noise, and the chips above the list are
 *    where an empty project is managed.
 * 5. Order: projects (in the caller's order), then teams, then `Chats` last; items keep the
 *    order they arrived in, which is the server's newest-first.
 */

export interface HistLike {
  id: string;
  projectId?: string | null;
  teamId?: string | null;
}

export interface NamedEntity {
  id: string;
  name: string;
}

export type HistoryGroupKind = "project" | "team" | "chat";

export interface HistoryGroup<T> {
  /** Stable key for React and for per-group collapse state. */
  key: string;
  label: string;
  kind: HistoryGroupKind;
  items: T[];
}

/** The label of the catch-all bucket. Exported so the test can assert it exists exactly once. */
export const LOOSE_GROUP_LABEL = "Chats";

export function groupHistory<T extends HistLike>(
  items: T[],
  { projects, teams }: { projects: NamedEntity[]; teams: NamedEntity[] }
): HistoryGroup<T>[] {
  const knownProjects = new Set(projects.map((p) => p.id));
  const knownTeams = new Set(teams.map((t) => t.id));

  const inProject = new Map<string, T[]>();
  const inTeam = new Map<string, T[]>();
  const loose: T[] = [];

  for (const it of items) {
    if (it.projectId && knownProjects.has(it.projectId)) {
      const list = inProject.get(it.projectId);
      if (list) list.push(it);
      else inProject.set(it.projectId, [it]);
    } else if (it.teamId && knownTeams.has(it.teamId)) {
      const list = inTeam.get(it.teamId);
      if (list) list.push(it);
      else inTeam.set(it.teamId, [it]);
    } else {
      // Includes the deleted-project case above, and any chat with no bucket at all.
      loose.push(it);
    }
  }

  const groups: HistoryGroup<T>[] = [];
  for (const p of projects) {
    const list = inProject.get(p.id);
    if (list && list.length) groups.push({ key: `project:${p.id}`, label: p.name, kind: "project", items: list });
  }
  for (const t of teams) {
    const list = inTeam.get(t.id);
    if (list && list.length) groups.push({ key: `team:${t.id}`, label: t.name, kind: "team", items: list });
  }
  if (loose.length) groups.push({ key: "chats", label: LOOSE_GROUP_LABEL, kind: "chat", items: loose });
  return groups;
}
