import { NextResponse } from "next/server";
import { AI_KEYS, APP } from "@/lib/config";
import { storageMode } from "@/lib/db/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const llmLive = Boolean(AI_KEYS.groq || AI_KEYS.openrouter);
  return NextResponse.json({
    ok: true,
    app: APP.name,
    demoMode: APP.demoMode,
    providers: {
      llm: llmLive ? (AI_KEYS.groq ? "groq" : "openrouter") : "offline-smart-demo",
      image: "pollinations",
      audio: "browser-tts",
      vision: AI_KEYS.groq ? "groq-vision" : "preview-fallback",
      webSearch: "duckduckgo",
    },
    db: storageMode(),
    time: new Date().toISOString(),
  });
}
