import { NextResponse } from "next/server";
import { PUBLIC_MODELS, liveModels } from "@/lib/ai/model-tiers";
import { MODEL_CATALOG, publicModelLabel } from "@/lib/ai/models-catalog";
import { availableProviders } from "@/lib/ai/provider-registry";
import { availableImageProviders } from "@/lib/ai/image-providers";

export const dynamic = "force-dynamic";

/** One row of `selectable`: a real model, whether this deployment can call it, and what it is
 *  branded as. `lib/client/api.ts` mirrors this; `/api/ai/models` is the only place it is built. */
type SelectableRow = {
  id: string;
  label: string;
  brand: string;
  provider: string;
  tiers: string[];
  quality: number;
  latency: string;
  strengths: string[];
  available: boolean;
  whyNot?: string;
};

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

  const CAPS = ["chat", "code", "image", "audio", "stt", "vision"] as const;
  // `router` is a capability in the catalog — the internal model that picks the others — and it is
  // deliberately not a seat anyone can choose. Named here rather than left out silently, so a new
  // capability has to be declared one way or the other (tests/tools.mjs checks that).
  const INTERNAL_CAPS = ["router"] as const;

  const selectable = CAPS.reduce(
    (acc, cap) => {
      acc[cap] = MODEL_CATALOG.filter((m) => m.capability === cap).map((m) => {
        const available = reachable(m.provider, cap === "image" ? "image" : "other");
        return {
          id: m.id,
          label: m.label,
          // The brand the product would show for this row, from the same lookup the gateway uses —
          // so the sheet can say "this real model is what BUILDWE Code means" instead of a second,
          // hand-maintained list of names that drifts the first time a row is added.
          brand: publicModelLabel(m.id, cap),
          provider: m.provider,
          tiers: m.tiers,
          quality: m.quality,
          latency: m.latency,
          strengths: m.strengths,
          // available = this deployment can actually call it today
          available,
          // ...and what is missing when it cannot, because "unavailable" with no reason is a dead
          // row, and this app has made a study of those.
          ...(!available ? { whyNot: `No ${m.provider} key on this deployment` } : {}),
        };
      });
      return acc;
    },
    {} as Record<string, SelectableRow[]>
  );

  // Per-capability counts, so a caller can say "4 of 9 chat models are callable here" without
  // re-deriving that arithmetic from a list it fetched.
  const ready = CAPS.reduce((acc, cap) => {
    const rows = selectable[cap] || [];
    acc[cap] = { total: rows.length, ready: rows.filter((r) => r.available).length };
    return acc;
  }, {} as Record<string, { total: number; ready: number }>);

  return NextResponse.json({
    live: liveModels(),
    all: PUBLIC_MODELS,
    selectable,
    ready,
    internal: INTERNAL_CAPS,
    catalogSize: MODEL_CATALOG.length,
    llmLive: chatProviders.length > 0,
    note: "selectable[] reflects what this deployment can call right now.",
  });
}
