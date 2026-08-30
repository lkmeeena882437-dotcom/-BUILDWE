import { NextResponse } from "next/server";
import { APP } from "@/lib/config";
import { storageMode } from "@/lib/db/store";
import { availableProviders, providerLabel } from "@/lib/ai/provider-registry";
import { MODEL_CATALOG } from "@/lib/ai/models-catalog";

export const dynamic = "force-dynamic";

/**
 * Operational health. Now reports the whole provider fleet rather than a
 * single "is Groq up" boolean, because routing spans several vendors and an
 * operator needs to see which ones are actually configured.
 */
export async function GET() {
  const live = availableProviders();
  const keyless = ["pollinations"];
  const reachable = [...live, ...keyless];

  // How many models are actually callable per capability right now.
  const byCapability = (["chat", "code", "image", "audio"] as const).map((cap) => {
    const all = MODEL_CATALOG.filter((m) => m.capability === cap);
    const usable = all.filter((m) => reachable.includes(m.provider));
    return { capability: cap, total: all.length, reachable: usable.length };
  });

  const llmLive = byCapability.find((c) => c.capability === "chat")!.reachable > 0;

  return NextResponse.json({
    ok: true,
    app: APP.name,
    demoMode: APP.demoMode,
    providers: {
      configured: live.map(providerLabel),
      llm: llmLive ? "multi-provider" : "offline-smart-demo",
      image: "pollinations",
      audio: "pollinations-tts + browser fallback",
      webSearch: "duckduckgo",
      devApi: "/api/v1/chat",
      byok: "aes-256-gcm",
      agent: "/api/ai/agent",
    },
    models: {
      catalogSize: MODEL_CATALOG.length,
      byCapability,
    },
    db: storageMode(),
    time: new Date().toISOString(),
  });
}
