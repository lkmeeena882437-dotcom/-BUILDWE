import { NextResponse } from "next/server";
import { PUBLIC_MODELS, liveModels } from "@/lib/ai/model-tiers";
import { MODEL_CATALOG } from "@/lib/ai/models-catalog";
import { availableProviders } from "@/lib/ai/provider-registry";
import { availableImageProviders } from "@/lib/ai/image-providers";

export const dynamic = "force-dynamic";

/**
 * Model discovery for the UI.
 *
 * `PUBLIC_MODELS` stays as-is: it is the white-labelled marketing ladder
 * shown on the pricing/about pages, deliberately branded rather than raw
 * vendor names.
 *
 * `selectable` is new and is what the studios should render instead of
 * hardcoded arrays. It reflects what is ACTUALLY callable on this deployment
 * right now, so the picker can never offer a model that will fail. Section 1
 * of the brief: models configurable from the backend, not hardcoded in UI.
 */
export async function GET() {
  const chatProviders = availableProviders();
  const imageProviders = availableImageProviders();
  const keyless = ["pollinations"];

  const reachable = (provider: string, kind: "image" | "other") =>
    keyless.includes(provider) ||
    (kind === "image" ? imageProviders : chatProviders).includes(provider);

  const selectable = (["chat", "code", "image", "audio"] as const).reduce(
    (acc, cap) => {
      acc[cap] = MODEL_CATALOG.filter((m) => m.capability === cap).map((m) => ({
        id: m.id,
        label: m.label,
        tiers: m.tiers,
        quality: m.quality,
        latency: m.latency,
        strengths: m.strengths,
        // available = this deployment can actually call it today
        available: reachable(m.provider, cap === "image" ? "image" : "other"),
      }));
      return acc;
    },
    {} as Record<
      string,
      {
        id: string;
        label: string;
        tiers: string[];
        quality: number;
        latency: string;
        strengths: string[];
        available: boolean;
      }[]
    >
  );

  return NextResponse.json({
    live: liveModels(),
    all: PUBLIC_MODELS,
    selectable,
    catalogSize: MODEL_CATALOG.length,
    llmLive: chatProviders.length > 0,
    note: "selectable[] reflects what this deployment can call right now.",
  });
}
