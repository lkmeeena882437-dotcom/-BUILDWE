import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_MODELS, liveModels } from "@/lib/ai/model-tiers";
import {
  MODEL_CATALOG,
  publicModelLabel,
  isKeylessProvider,
  isProviderImplemented,
} from "@/lib/ai/models-catalog";
import { availableFor } from "@/lib/ai/adapter";
import { getSessionFromRequest } from "@/lib/auth/session";
import { byokAccepted, userProviderKeys } from "@/lib/ai/byok";

export const runtime = "nodejs";
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
  /** True when this vendor needs no platform key. Safe to show; not an env name. */
  keyless: boolean;
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
 *
 * "Callable right now" counts the caller's own key too: a BYOK account can reach
 * OpenRouter on a deployment that has no OpenRouter key, and marking that row
 * unavailable would send the reader to Settings for something they already did.
 * The answer is therefore per-session, which is why the response says `no-store`.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const userKeys = session.kind === "user" ? userProviderKeys(session.userId) : undefined;
  const chatProviders = availableFor("chat", userKeys);

  const CAPS = ["chat", "code", "image", "audio", "stt", "vision"] as const;
  const reachable = (provider: string, cap: (typeof CAPS)[number]) =>
    availableFor(cap, userKeys).includes(provider);
  // `router` is a capability in the catalog — the internal model that picks the others — and it is
  // deliberately not a seat anyone can choose. Named here rather than left out silently, so a new
  // capability has to be declared one way or the other (tests/tools.mjs checks that).
  const INTERNAL_CAPS = ["router", "agent"] as const;

  const selectable = CAPS.reduce(
    (acc, cap) => {
      acc[cap] = MODEL_CATALOG.filter((m) => m.capability === cap).map((m) => {
        const implemented = isProviderImplemented(m.provider, cap);
        const available = implemented && reachable(m.provider, cap);
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
          keyless: isKeylessProvider(m.provider),
          // ...and what is missing when it cannot, because "unavailable" with no reason is a dead
          // row, and this app has made a study of those. When a user key would be enough, the row
          // says so and where to put it — the difference between a dead row and a task.
          // Unimplemented vendors (no adapter) are not a missing-key problem.
          ...(!available
            ? {
                whyNot: !implemented
                  ? "Not enabled on this deployment"
                  : byokAccepted(m.provider)
                    ? `No ${m.provider} key here — add yours in Settings → API keys`
                    : `No ${m.provider} key on this deployment`,
              }
            : {}),
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

  const res = NextResponse.json({
    live: liveModels(),
    all: PUBLIC_MODELS,
    selectable,
    ready,
    internal: INTERNAL_CAPS,
    catalogSize: MODEL_CATALOG.length,
    llmLive: chatProviders.length > 0,
    byokActive: Boolean(userKeys),
    note: "selectable[] reflects what this deployment — or your own key — can call right now.",
  });
  // Per-session since a BYOK key changes every `available` flag on this page. A shared cache
  // entry would show one reader another reader's readiness.
  res.headers.set("Cache-Control", "no-store");
  return res;
}
