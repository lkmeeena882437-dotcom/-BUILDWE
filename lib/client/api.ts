/** Browser helpers for BUILDWE APIs */

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
    throw new Error(j.error || `Something went wrong (${r.status})`);
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
  if (!r.ok) throw new Error(j.error || "Couldn’t generate voice. Try again.");
  return j as {
    id: string;
    type: "browser-tts";
    text: string;
    voice: string;
    speed: number;
    model: string;
  };
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
  };
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
