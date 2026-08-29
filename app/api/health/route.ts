export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { APP, hasProviderKey } from "@/lib/config";
import { storageMode } from "@/lib/db/store";

export async function GET() {
  const llm = hasProviderKey("groq") || hasProviderKey("openrouter");
  return NextResponse.json({
    ok: true,
    app: APP.name,
    status: "operational",
    storage: storageMode(),
    capabilities: {
      chat: true,
      code: true,
      image: true,
      audio: true,
      llmLive: llm,
    },
    time: new Date().toISOString(),
  });
}
