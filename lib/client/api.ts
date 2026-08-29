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

export async function fetchMe(): Promise<MeResponse> {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  if (!r.ok) throw new Error("session failed");
  return r.json();
}

export async function login(email: string, password: string) {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
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
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Register failed");
  return j;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function fetchHistory() {
  const r = await fetch("/api/history", { credentials: "include" });
  if (!r.ok) throw new Error("history failed");
  return r.json() as Promise<{
    conversations: {
      id: string;
      title: string;
      mode: string;
      updatedAt: string;
      preview: string;
      messageCount: number;
    }[];
    generations: unknown[];
  }>;
}

export async function loadConversation(id: string) {
  const r = await fetch("/api/history", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get", conversationId: id }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "load failed");
  return j.conversation;
}

export async function deleteHistory(id: string) {
  await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

/** SSE stream reader for chat/code */
export async function streamAI(
  endpoint: "/api/ai/chat" | "/api/ai/code",
  body: unknown,
  onEvent: (ev: { token?: string; done?: boolean; meta?: unknown; error?: string }) => void,
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
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }

  if (!r.body) throw new Error("No stream");

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
        /* */
      }
    }
  }
}

export async function generateImage(prompt: string, aspect: string) {
  const r = await fetch("/api/ai/image", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, aspect }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Couldn’t create that image. Try again.");
  return j as { id: string; url: string; model: string; provider: string };
}

export async function generateAudio(text: string, voice: string, speed: number) {
  const r = await fetch("/api/ai/audio", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Audio failed");
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
  return r.json() as Promise<{ mode: string }>;
}
