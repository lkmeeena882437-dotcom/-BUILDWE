import { NextRequest, NextResponse } from "next/server";
import { TOOLS } from "@/lib/tools/registry";
import { AI_KEYS, hasProviderKey, TRUST_PROXY_HOPS, byokEncryptionConfigured, APP } from "@/lib/config";
import { storageMode, dbLockingAvailable } from "@/lib/db/store";
import { availableProviders } from "@/lib/ai/provider-registry";
import { availableImageProviders } from "@/lib/ai/image-providers";
import { MODEL_CATALOG } from "@/lib/ai/models-catalog";
import { durableRateLimitAvailable } from "@/lib/rate-limit/durable";
import { mediaStorageEnabled } from "@/lib/storage/media";

export const dynamic = "force-dynamic";

/**
 * Operational health for `/status` and for operators.
 *
 * WHY THIS WAS REWRITTEN (audits A13 + C-leak, 2026-08-31)
 * --------------------------------------------------------
 * `providers` used to be free prose — `{ image: "pollinations + fal + openai
 * …", audio: "pollinations-tts + browser fallback" }` — and the status page
 * turned that prose into a green/red badge by substring-matching the words
 * "offline"/"fallback". So 7 of 9 rows could never change colour no matter
 * what the server was actually doing, and `audio` was permanently stuck on
 * "Fallback active" because its description contained the word. A status page
 * that renders a string literal is worse than no status page.
 *
 * Now every row is a computed `{ ok, detail, evidence }` triple decided HERE,
 * where the real configuration is visible, and the page renders exactly these
 * rows. Keys are also no longer enumerated: the old response listed which
 * vendor credentials exist, which is a roadmap for an attacker.
 */

export type ServiceState = "live" | "degraded" | "unconfigured" | "down";
export type ServiceRow = {
  label: string;
  state: ServiceState;
  ok: boolean;
  detail: string;
  /** What was measured, so a reader can tell "off" from "untested". */
  evidence: string;
};

export type HealthResponse = {
  ok: boolean;
  app: string;
  services: Record<string, ServiceRow>;
  models: {
    catalogSize: number;
    byCapability: { capability: string; total: number; reachable: number }[];
  };
  db: string;
  durability: {
    database: string;
    rateLimits: string;
    mediaStorage: string;
    writeLocking: string;
  };
  time: string;
};

function row(
  label: string,
  state: ServiceState,
  detail: string,
  evidence: string
): ServiceRow {
  return {
    label,
    state,
    ok: state === "live",
    detail,
    evidence,
  };
}

export async function GET() {
  const live = availableProviders();
  const imageLive = availableImageProviders();
  // Pollinations needs no credential, so it counts as reachable but not as
  // "our configured provider" — the detail line has to say which it is.
  const keylessImage = ["pollinations"];
  const chatReady = live.length > 0;
  const sttReady = Boolean(AI_KEYS.deepgram || hasProviderKey("groq"));
  const ttsReady = Boolean(
    AI_KEYS.elevenlabs ||
      hasProviderKey("openai") ||
      hasProviderKey("groq") ||
      hasProviderKey("playht")
  );
  const searchReady = true; // keyless by design — the detail explains the risk
  const storage = storageMode();

  const services: Record<string, ServiceRow> = {
    llm: chatReady
      ? row(
          "Chat & Code models",
          "live",
          `${live.length} model provider${
            live.length === 1 ? "" : "s"
          } ready — vendor names are not published here on purpose.`,
          "credential present per vendor"
        )
      : row(
          "Chat & Code models",
          "unconfigured",
          "No provider credential is set, so answers come from the offline router instead of a real model.",
          "0 of the configured LLM vendors have a key"
        ),
    image:
      imageLive.length > 0
        ? row(
            "Image generation",
            "live",
            `${imageLive.length} image provider${
              imageLive.length === 1 ? "" : "s"
            } ready`,
            "credential present per vendor"
          )
        : row(
            "Image generation",
            "degraded",
            `Only keyless generation (${keylessImage.join(", ")}) is available — quality and volume are not ours to control.`,
            "0 keyed image providers"
          ),
    audio: ttsReady
      ? row("Voice generation", "live", "A speech provider is configured.", "TTS credential present")
      : row(
          "Voice generation",
          "degraded",
          "No TTS credential is set, so voice output falls back to the browser's own speech engine.",
          "no elevenlabs / openai / playht key"
        ),
    stt: sttReady
      ? row(
          "Speech to text",
          "live",
          "A transcription provider is configured.",
          "deepgram or groq credential present"
        )
      : row(
          "Speech to text",
          "unconfigured",
          "Transcription is not connected, so recordings are stored but not turned into text.",
          "no deepgram / groq key"
        ),
    webSearch: searchReady
      ? row(
          "Web search",
          "degraded",
          "Results come from keyless DuckDuckGo HTML — works today, can break without warning, and snippets are short.",
          "no search API credential"
        )
      : row("Web search", "unconfigured", "Web search is off.", "disabled"),
    devApi: row(
      "Developer API",
      chatReady ? "live" : "degraded",
      "/api/v1/chat issues against the same quota as the web app.",
      chatReady ? "shared with app quota" : "no live model behind it"
    ),
    byok: byokEncryptionConfigured()
      ? row(
          "Key encryption",
          "live",
          "User keys are encrypted with a deployment secret.",
          "BYOK_ENCRYPTION_SECRET or SESSION_SECRET set"
        )
      : row(
          "Key encryption",
          "down",
          "No encryption secret is configured, so saved API keys cannot be trusted to stay private.",
          "missing BYOK_ENCRYPTION_SECRET"
        ),
    agent: row(
      "Coding agent",
      chatReady ? "live" : "unconfigured",
      chatReady
        ? "Multi-step agent runs against a live model."
        : "The agent needs a live model; it will not fabricate a plan offline.",
      chatReady ? "llm reachable" : "no llm credential"
    ),
    tools: row(
      `Writing tools (${TOOLS.length})`,
      chatReady ? "live" : "unconfigured",
      chatReady
        ? "Every tool runs the same runner: server-built prompt, quota first, output graded against its own contract, one corrective pass at most."
        : "Tools refuse to run without a live model — a template dressed up as an AI answer is not shipping, ever.",
      chatReady ? `${TOOLS.length} specs registered` : "no llm credential"
    ),
    storage:
      storage === "supabase"
        ? row("Persistence", "live", "Database mirror is configured.", "supabase")
        : storage === "disk"
          ? row(
              "Persistence",
              "degraded",
              "Data lives in a local JSON file — fine on a VPS, lost on serverless.",
              "disk"
            )
          : row(
              "Persistence",
              "down",
              "Nothing is writable: accounts and history disappear when the process restarts.",
              "memory"
            ),
    rateLimits: durableRateLimitAvailable()
      ? row("Rate limiting", "live", "Counters are shared across instances.", "durable store")
      : row(
          "Rate limiting",
          "degraded",
          "Per-instance counters: limits reset on cold starts and multiply across instances.",
          "in-memory"
        ),
    mediaStorage: mediaStorageEnabled()
      ? row("Media storage", "live", "Generated files go to object storage.", "supabase storage")
      : row(
          "Media storage",
          "degraded",
          "Generated files live in a temp directory and will vanish; download them promptly.",
          "ephemeral"
        ),
    identity:
      TRUST_PROXY_HOPS > 0
        ? row(
            "Client identity",
            "live",
            `Forwarded headers are read through ${TRUST_PROXY_HOPS} trusted hop${
              TRUST_PROXY_HOPS === 1 ? "" : "s"
            }.`,
            "TRUST_PROXY_HOPS"
          )
        : row(
            "Client identity",
            "degraded",
            "No trusted proxy is declared, so anonymous traffic is throttled as one shared bucket. Set TRUST_PROXY_HOPS=1 behind your proxy.",
            "x-forwarded-for ignored"
          ),
    writeLocking: dbLockingAvailable
      ? row("Store writes", "live", "Writes are serialised across processes.", "lock file")
      : row(
          "Store writes",
          "degraded",
          "The lock file could not be taken, so concurrent writers fall back to merge-only conflict handling.",
          "lock unavailable"
        ),
  };

  const byCapability = (["chat", "code", "image", "audio", "stt", "vision"] as const).map(
    (cap) => {
      // Only count what can actually serve the capability: an image provider
      // says nothing about speech-to-text, which is what the old blanket
      // "as configured" string used to hide.
      const reachable =
        cap === "image"
          ? [...imageLive, ...keylessImage]
          : cap === "stt"
            ? live
            : [...live, ...keylessImage];
      const all = MODEL_CATALOG.filter((m) => m.capability === cap);
      const usable = all.filter((m) => reachable.includes(m.provider));
      return { capability: cap, total: all.length, reachable: usable.length };
    }
  );

  const rows = Object.values(services);
  const down = rows.filter((r) => r.state === "down").length;

  return NextResponse.json<HealthResponse>({
    ok: down === 0,
    app: APP.name,
    services,
    models: { catalogSize: MODEL_CATALOG.length, byCapability },
    db: storage,
    durability: {
      database: storage,
      rateLimits: durableRateLimitAvailable() ? "shared" : "per-instance",
      mediaStorage: mediaStorageEnabled() ? "supabase" : "ephemeral",
      writeLocking: dbLockingAvailable ? "cross-process" : "merge-only",
    },
    time: new Date().toISOString(),
  });
}
