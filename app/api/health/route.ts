import { NextResponse } from "next/server";
import { APP, hasProviderKey } from "@/lib/config";

/** Ops health — does not advertise vendor brands to end users */
export async function GET() {
  const llm = hasProviderKey("groq") || hasProviderKey("openrouter");
  return NextResponse.json({
    ok: true,
    app: APP.name,
    status: "operational",
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
