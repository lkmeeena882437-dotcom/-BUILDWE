/** Browser helpers for BUILDWE APIs */

import type { PreviewDto } from "@/lib/net/urls";

export type MeResponse = {
  userId: string;
  kind: "user" | "guest";
  user: null | {
    id: string;
    email: string;
    name: string;
    plan: "free" | "pro";
    skills: string[];
  };
  plan: "free" | "pro";
  name: string;
  usage: { chat: number; code: number; image: number; audio: number; day: string };
  limits: { chat: number; code: number; image: number; audio: number };
};

/**
 * Credit signals travel to the wallet UI as window events rather than imports,
 * so this module stays free of React. Two events exist:
 *   bw:credits:receipt   - a paid call succeeded and reports the new balance
 *   bw:credits:shortfall - the server refused for lack of credits (402), and
 *                          the wallet UI opens its top-up sheet
 */
function creditsEvent(name: string, detail: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* no CustomEvent - the UI simply stays as it is */
  }
}

/** Called on every paid response: keep the chip honest, surface the top-up. */
export function noteCredits(r: Response, j: unknown) {
  const o = (j || {}) as { code?: unknown; balance?: unknown; needed?: unknown; credits?: { balance?: unknown; charged?: unknown } };
  if (r.status === 402 && String(o.code || "") === "INSUFFICIENT_CREDITS") {
    creditsEvent("bw:credits:shortfall", {
      balance: Number(o.balance || 0),
      needed: Number(o.needed || 0),
    });
    return;
  }
  const rec = o.credits;
  if (rec && typeof rec.balance === "number") {
    creditsEvent("bw:credits:receipt", {
      balance: rec.balance,
      charged: Number(rec.charged || 0),
    });
  }
}

async function readJson(r: Response) {
  const text = await r.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: r.ok ? "Unexpected response" : `Request failed (${r.status})` };
  }
}

export async function fetchMe(): Promise<MeResponse> {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Session failed");
  return j;
}

export async function login(email: string, password: string) {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Login failed");
  return j;
}

export async function register(email: string, password: string, name?: string) {
  const r = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, name }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t create account");
  return j;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function fetchHistory() {
  const r = await fetch("/api/history", { credentials: "include" });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "History unavailable");
  return j as {
    conversations: {
      id: string;
      title: string;
      mode: string;
      updatedAt: string;
      preview: string;
      messageCount: number;
    }[];
    generations: unknown[];
  };
}

export async function loadConversation(id: string) {
  const r = await fetch("/api/history", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get", conversationId: id }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t open chat");
  return j.conversation;
}

export async function deleteHistory(id: string) {
  await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

/**
 * Metadata for one link, for the card under an answer.
 *
 * Unlike the rest of this module this never throws: a preview is decoration on a
 * message that is already on screen, and making a card's failure somebody else's
 * error state would be worse than no card. The server's refusal (an internal
 * address, a site that is down, a page that describes nothing) all land in the
 * same place — `null` — and the component removes itself.
 */
export async function fetchPreviewApi(
  url: string,
  signal?: AbortSignal
): Promise<PreviewDto | null> {
  try {
    const r = await fetch(`/api/preview?url=${encodeURIComponent(url)}`, {
      credentials: "include",
      signal,
    });
    const j = await readJson(r);
    if (!r.ok || j?.ok !== true || !j.preview) return null;
    return j.preview as PreviewDto;
  } catch {
    return null;
  }
}

export async function streamAI(
  endpoint: "/api/ai/chat" | "/api/ai/code",
  body: unknown,
  onEvent: (ev: {
    token?: string;
    done?: boolean;
    meta?: unknown;
    error?: string;
  }) => void,
  signal?: AbortSignal
) {
  const r = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!r.ok) {
    const j = await readJson(r);
    const err = new Error(j.error || `Something went wrong (${r.status})`) as Error & {
      code?: string;
      hint?: string;
    };
    if (j.code) err.code = j.code;
    if (j.hint) err.hint = j.hint;
    throw err;
  }

  if (!r.body) throw new Error("No response stream");

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() || "";
    for (const line of parts) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try {
        const json = JSON.parse(t.slice(5).trim());
        onEvent(json);
      } catch {
        /* ignore partial */
      }
    }
  }
}

export async function generateImage(
  prompt: string,
  aspect: string,
  opts?: { basePrompt?: string; modelId?: string }
) {
  const r = await fetch("/api/ai/image", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspect,
      basePrompt: opts?.basePrompt,
      modelId: opts?.modelId || "flux",
    }),
  });
  const j = await readJson(r);
  noteCredits(r, j);
  if (!r.ok) throw new Error(j.error || "Couldn’t create that image. Try again.");
  return j as {
    id: string;
    url: string;
    model: string;
    provider: string;
    promptUsed?: string;
    editMode?: string;
    userPrompt?: string;
  };
}

export async function generateAudio(text: string, voice: string, speed: number) {
  const r = await fetch("/api/ai/audio", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
  });
  const j = await readJson(r);
  noteCredits(r, j);
  if (!r.ok) throw new Error(j.error || "Couldn’t generate voice. Try again.");
  return j as {
    id: string;
    type: "mp3" | "browser-tts";
    audioUrl?: string;
    text: string;
    voice: string;
    speed: number;
    model: string;
    live: boolean;
  };
}

/* ── Verification (Update #1) ───────────────────────────── */

export async function verifyApi(text: string) {
  const r = await fetch("/api/ai/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Verification failed");
  return j as {
    ok: boolean;
    verdict: "verified" | "needs-verification" | "nothing-to-check";
    message: string;
    claims: {
      claim: string;
      kind: string;
      verdict: "verified" | "uncertain";
      source?: { title: string; url: string; host: string };
    }[];
  };
}

/* ── Multi-model comparison (Update #2 · P1 mix) ────────── */

/* ── Coding Agent ───────────────────────────────────────── */

export type AgentEvent =
  | { type: "meta"; projectId: string }
  | { type: "plan"; text: string }
  | { type: "step"; n: number; total: number; label: string }
  | { type: "tool"; tool: string; path?: string; ok: boolean; detail: string }
  | { type: "check"; ok: boolean; issues: string[]; path?: string }
  | { type: "message"; text: string }
  | { type: "done"; summary: string; filesChanged: string[]; verified: boolean }
  | { type: "error"; text: string }
  | {
      type: "result";
      ok: boolean;
      summary: string;
      filesChanged: string[];
      steps: number;
      verified: boolean;
      primaryFile?: { path: string; content: string; lang: string };
      credits?: { charged: number; balance: number };
    };

/**
 * Run the coding agent, streaming progress events as they happen.
 * Returns the final result event, or null if the run produced none.
 */
export async function runAgentApi(
  input: {
    goal: string;
    projectId?: string | null;
    canvasCode?: string;
    canvasLang?: string;
  },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal
): Promise<Extract<AgentEvent, { type: "result" }> | null> {
  const r = await fetch("/api/ai/agent", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  if (!r.ok || !r.body) {
    const j = await readJson(r);
    noteCredits(r, j);
    const err = new Error(j.error || "The agent couldn't start.") as Error & {
      code?: string;
      hint?: string;
    };
    if (j.code) err.code = j.code;
    if (j.hint) err.hint = j.hint;
    throw err;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: Extract<AgentEvent, { type: "result" }> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(t.slice(5).trim()) as AgentEvent;
        if (ev.type === "result") {
          final = ev;
          if (ev.credits && typeof ev.credits.balance === "number") {
            creditsEvent("bw:credits:receipt", ev.credits);
          }
        }
        onEvent(ev);
      } catch {
        /* skip malformed frame */
      }
    }
  }
  return final;
}

export async function codeActionApi(
  code: string,
  lang: string,
  action: "fix" | "optimize" | "refactor" | "test"
) {
  const r = await fetch("/api/ai/code-action", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, lang, action }),
  });
  const j = await readJson(r);
  if (!r.ok) {
    const err = new Error(j.error || "Action failed") as Error & {
      code?: string;
      hint?: string;
    };
    if (j.code) err.code = j.code;
    if (j.hint) err.hint = j.hint;
    throw err;
  }
  return j as {
    ok: boolean;
    available?: boolean;
    message?: string;
    action?: string;
    title?: string;
    code?: string;
    notes?: string;
    raw?: string;
  };
}


export async function compareApi(prompt: string) {
  const r = await fetch("/api/ai/compare", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const j = await readJson(r);
  noteCredits(r, j);
  if (!r.ok) throw new Error(j.error || "Comparison failed");
  return j as {
    ok: boolean;
    available: boolean;
    complexity: string;
    lanes: { label: string; model: string; live: boolean; reply: string }[];
    synthesis: string;
  };
}

/* ── BYOK (bring your own key) ──────────────────────────── */

export async function fetchByok() {
  const r = await fetch("/api/user/keys", { credentials: "include" });
  const j = await readJson(r);
  return j as {
    requireAuth?: boolean;
    keys: { groq: string | null; openrouter: string | null };
    active: boolean;
  };
}

export async function saveByok(keys: { groq?: string; openrouter?: string }) {
  const r = await fetch("/api/user/keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(keys),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t save keys");
  return j as { keys: { groq: string | null; openrouter: string | null }; active: boolean };
}

/* ── Developer API keys ─────────────────────────────────── */

export async function fetchDevKeys() {
  const r = await fetch("/api/dev/keys", { credentials: "include" });
  const j = await readJson(r);
  return j as {
    requireAuth?: boolean;
    keys: { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string }[];
  };
}

export async function createDevKey(name: string) {
  const r = await fetch("/api/dev/keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t create key");
  return j as { key: { id: string; name: string; prefix: string }; secret: string };
}

export async function revokeDevKey(id: string) {
  await fetch(`/api/dev/keys?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function detectAuto(prompt: string) {
  const r = await fetch("/api/ai/auto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const j = await readJson(r);
  return j as { mode: string };
}

/* ── Web search ─────────────────────────────────────────── */

export async function webSearchApi(query: string) {
  const r = await fetch("/api/ai/search", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Search failed");
  return j as {
    ok: boolean;
    results: { title: string; url: string; snippet: string; host: string }[];
    status?: "ok" | "empty" | "unreachable" | "blocked" | "timeout";
    /** User-safe explanation when results are empty. */
    reason?: string;
  };
}

/* ── Speech-to-Text (Voice: Listen) ─────────────────────── */

/**
 * Transcribe an audio Blob (from a MediaRecorder stream or a file). Returns
 * the transcript plus which provider/model served it. `live:false` means no
 * STT provider is configured — the message is honest, not fabricated.
 */
export async function transcribeAudio(
  audio: Blob,
  filename?: string
): Promise<{ ok: boolean; text: string; model: string; provider: string; live: boolean }> {
  const form = new FormData();
  form.append("audio", audio, filename || "recording.webm");
  if (filename) form.append("filename", filename);
  const r = await fetch("/api/ai/transcribe", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const j = await readJson(r);
  noteCredits(r, j);
  if (!r.ok) throw new Error(j.error || "Couldn't transcribe that audio");
  return j;
}

/* ── Vision ─────────────────────────────────────────────── */

export async function visionApi(imageDataUrl: string, prompt: string) {
  const r = await fetch("/api/ai/vision", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl, prompt }),
  });
  const j = await readJson(r);
  noteCredits(r, j);
  if (!r.ok) throw new Error(j.error || "Couldn't analyze that image");
  return j as { ok: boolean; text: string; model: string; live: boolean };
}

/* ── File analysis ──────────────────────────────────────── */

export async function analyzeFileApi(name: string, text: string) {
  const r = await fetch("/api/ai/file", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn't analyze that file");
  return j as { ok: boolean; name: string; summary: string };
}

/* ── Share links ────────────────────────────────────────── */

export async function createShare(conversationId: string) {
  const r = await fetch("/api/share", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn't create share link");
  return j as { ok: boolean; id: string; url: string };
}

/* ── Projects ───────────────────────────────────────────── */

export async function fetchProjects() {
  const r = await fetch("/api/projects", { credentials: "include" });
  const j = await readJson(r);
  return j as { projects: { id: string; name: string; createdAt: string }[] };
}

export async function createProject(name: string) {
  const r = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", name }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn't create project");
  return j as { project: { id: string; name: string } };
}

export async function assignProject(conversationId: string, projectId: string | null) {
  const r = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "assign", conversationId, projectId }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn't move chat");
  return j;
}

export async function deleteProjectApi(id: string) {
  await fetch(`/api/projects?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

/* ── Teams (workspaces) ─────────────────────────────────── */

export type TeamView = {
  id: string;
  name: string;
  ownerId: string;
  memberCount: number;
  myRole: "owner" | "member";
  createdAt: string;
};

export async function fetchTeams() {
  const r = await fetch("/api/teams", { credentials: "include" });
  const j = await readJson(r);
  return j as { teams: TeamView[] };
}

export async function createTeam(name: string) {
  const r = await fetch("/api/teams", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", name }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t create team");
  return j as { team: TeamView };
}

export async function teamInvite(teamId: string) {
  const r = await fetch("/api/teams", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "invite", teamId }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t get invite code");
  return j as { code: string };
}

export async function joinTeam(code: string) {
  const r = await fetch("/api/teams", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "join", code }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t join team");
  return j as { team: TeamView };
}

export async function leaveTeamApi(teamId: string) {
  const r = await fetch("/api/teams", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "leave", teamId }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t leave team");
  return j as { ok: boolean; dissolved: boolean };
}

export async function assignTeam(conversationId: string, teamId: string | null) {
  const r = await fetch("/api/teams", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "assign", conversationId, teamId }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t move chat");
  return j;
}

export async function sendFeedback(kind: "up" | "down", note?: string) {
  const r = await fetch("/api/ai/feedback", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, note }),
  });
  return readJson(r);
}

export async function fetchModels() {
  const r = await fetch("/api/ai/models");
  return readJson(r) as Promise<{
    live: { id: string; name: string; blurb: string; status: string; badge?: string; family: string }[];
    all: { id: string; name: string; blurb: string; status: string; badge?: string; family: string }[];
    llmLive: boolean;
  }>;
}

export async function fetchSkills() {
  const r = await fetch("/api/user/skills", { credentials: "include" });
  return readJson(r) as Promise<{ skills: string[]; requireAuth?: boolean }>;
}

export async function saveSkills(skills: string[]) {
  const r = await fetch("/api/user/skills", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn’t save skills");
  return j as { skills: string[] };
}

/* ── Generation history (Update #1 §4.5) ──────────────────── */

export type GenerationItem = {
  id: string;
  type: "image" | "audio" | "code";
  prompt: string;
  outputUrl?: string;
  outputText?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

/**
 * Past image/audio/code generations for the signed-in user or guest.
 * Image and audio results were always saved server-side but had no reader —
 * this makes "my previous creations" reachable from the UI.
 */
export async function fetchGenerations(
  type?: "image" | "audio" | "code",
  limit = 50
): Promise<GenerationItem[]> {
  const qs = new URLSearchParams();
  if (type) qs.set("type", type);
  qs.set("limit", String(limit));
  const r = await fetch(`/api/ai/generations?${qs.toString()}`, {
    credentials: "include",
  });
  const j = await readJson(r);
  if (!r.ok) return [];
  return (j.generations || []) as GenerationItem[];
}

/**
 * One creation, as the list shows it. Declared on its own rather than
 * `GenerationItem & {…}` because the raw shape has `outputUrl?: string` and this one
 * needs `string | null` — an intersection of the two collapses to a type nothing can
 * assign, which is how "optional or null" usually turns into a cast at the call site.
 */
export type ArtifactItem = {
  id: string;
  type: "image" | "audio" | "code";
  prompt: string;
  title: string | null;
  pinned: boolean;
  outputUrl: string | null;
  outputText?: string;
  meta?: Record<string, unknown>;
  /** Already has a public link — the menu says "Copy link" instead of "Share". */
  shareId: string | null;
  /** False when there is nothing a reader could open (audio made without media storage). */
  shareable: boolean;
  createdAt: string;
};

function failWith(j: unknown, fallback: string): never {
  const o = (j || {}) as { error?: unknown; code?: unknown };
  const e = new Error(String(o.error || fallback)) as Error & { code?: string };
  if (o.code) e.code = String(o.code);
  throw e;
}

/**
 * The curated list. Unlike fetchGenerations() this throws: a library that quietly
 * answers "nothing here yet" while the rows still exist teaches people their work is
 * gone, which is worse than a retry button.
 */
export async function fetchArtifacts(
  type?: ArtifactItem["type"],
  limit = 60
): Promise<{ artifacts: ArtifactItem[]; titleMax: number }> {
  const qs = new URLSearchParams({ view: "artifacts", limit: String(limit) });
  if (type) qs.set("type", type);
  const r = await fetch(`/api/ai/generations?${qs.toString()}`, { credentials: "include" });
  const j = await readJson(r);
  if (!r.ok) failWith(j, "Could not load your creations.");
  return {
    artifacts: (j.artifacts || []) as ArtifactItem[],
    titleMax: Number(j.titleMax) || 120,
  };
}

/** The whole row, untruncated — what "open in canvas" needs for a code artifact. */
export async function fetchArtifact(id: string): Promise<ArtifactItem> {
  const r = await fetch(`/api/ai/generations?id=${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const j = await readJson(r);
  if (!r.ok) failWith(j, "That creation could not be opened.");
  return j.artifact as ArtifactItem;
}

export async function updateArtifact(
  id: string,
  patch: { title?: string | null; pinned?: boolean }
): Promise<ArtifactItem> {
  const r = await fetch("/api/ai/generations", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  const j = await readJson(r);
  if (!r.ok) failWith(j, "That change could not be saved.");
  return j.artifact as ArtifactItem;
}

export async function deleteArtifact(id: string): Promise<void> {
  const r = await fetch(`/api/ai/generations?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const j = await readJson(r);
  if (!r.ok) failWith(j, "That creation could not be deleted.");
}

/** Public link for one creation. Repeating it refreshes the same link, never a new one. */
export async function shareArtifact(id: string): Promise<{ id: string; url: string }> {
  const r = await fetch("/api/share", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifactId: id }),
  });
  const j = await readJson(r);
  if (!r.ok) failWith(j, "A share link could not be made for that creation.");
  return { id: String(j.id), url: String(j.url) };
}

/* ── Project files — Coding Agent (Update #1 §3) ──────────── */

export type ProjectFileMeta = {
  id: string;
  path: string;
  lang: string;
  size: number;
  updatedAt: string;
};

export async function fetchProjectFiles(
  projectId: string
): Promise<ProjectFileMeta[]> {
  const r = await fetch(
    `/api/projects/files?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include" }
  );
  const j = await readJson(r);
  if (!r.ok) return [];
  return (j.files || []) as ProjectFileMeta[];
}

export async function readProjectFile(id: string) {
  const r = await fetch(`/api/projects/files?id=${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn't open that file");
  return j.file as ProjectFileMeta & { content: string; projectId: string };
}

/** Create or update a file by path (upsert). */
export async function saveProjectFileApi(input: {
  projectId: string;
  path: string;
  content: string;
  lang?: string;
}) {
  const r = await fetch("/api/projects/files", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await readJson(r);
  if (!r.ok) throw new Error(j.error || "Couldn't save that file");
  return j.file as ProjectFileMeta & { content: string };
}

export async function deleteProjectFileApi(id: string) {
  const r = await fetch(`/api/projects/files?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return r.ok;
}
