import { NextResponse } from "next/server";
import { PUBLIC_MODELS, liveModels } from "@/lib/ai/model-tiers";
import { hasProviderKey } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    live: liveModels(),
    all: PUBLIC_MODELS,
    llmLive: hasProviderKey("groq") || hasProviderKey("openrouter"),
    note: "Free models are live. PRO / premium seats show as Coming soon until enabled.",
  });
}
