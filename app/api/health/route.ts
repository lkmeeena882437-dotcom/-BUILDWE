import { NextResponse } from "next/server";
import { APP } from "@/lib/config";
import { storageMode } from "@/lib/db/store";
import { availableProviders, providerLabel } from "@/lib/ai/provider-registry";
import { availableImageProviders } from "@/lib/ai/image-providers";
import { MODEL_CATALOG } from "@/lib/ai/models-catalog";
import { durableRateLimitAvailable } from "@/lib/rate-limit/durable";
import { mediaStorageEnabled } from "@/lib/storage/media";

export const dynamic = "force-dynamic";

/**
 * Operational health. Now reports the whole provider fleet rather than a
 * single "is Groq up" boolean, because routing spans several vendors and an
 * operator needs to see which ones are actually configured.
 */
export async function GET() {
  const live = availableProviders();
  const imageLive = availableImageProviders();
  const keyless = ["pollinations"];

  // How many models are actually callable per capability right now. Image
  // models resolve against the image provider set (fal/HF), not the chat one.
  const byCapability = (["chat", "code", "image", "audio"] as const).map((cap) => {
    const reachable =
      cap === "image" ? [...imageLive, ...keyless] : [...live, ...keyless];
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
    // Durability at a glance. Every one of these degrades safely when
    // unconfigured, so this reports what you HAVE rather than what failed.
    durability: {
      database: storageMode(),
      rateLimits: durableRateLimitAvailable() ? "shared" : "per-instance",
      mediaStorage: mediaStorageEnabled() ? "supabase" : "ephemeral",
    },
    time: new Date().toISOString(),
  });
}
