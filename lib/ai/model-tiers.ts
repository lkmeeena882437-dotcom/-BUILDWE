/**
 * Model ladder shown in product UI.
 * Free = live now. Pro/Premium rows can be "coming_soon" until keys exist.
 */

export type ModelStatus = "live" | "coming_soon" | "pro";

export type PublicModel = {
  id: string;
  name: string;
  family: "chat" | "code" | "image" | "audio" | "router";
  blurb: string;
  status: ModelStatus;
  badge?: string;
};

export const PUBLIC_MODELS: PublicModel[] = [
  // Live free
  {
    id: "bw-ai",
    name: "BUILDWE AI",
    family: "chat",
    blurb: "Fast everyday reasoning, Hinglish-aware chat.",
    status: "live",
    badge: "Free",
  },
  {
    id: "bw-code",
    name: "BUILDWE Code",
    family: "code",
    blurb: "Scaffold, debug, and ship working code.",
    status: "live",
    badge: "Free",
  },
  {
    id: "bw-vision",
    name: "BUILDWE Vision",
    family: "image",
    blurb: "Text → image for brand, product, scenes.",
    status: "live",
    badge: "Free",
  },
  {
    id: "bw-voice",
    name: "BUILDWE Voice",
    family: "audio",
    blurb: "Natural speech from your script.",
    status: "live",
    badge: "Free",
  },
  {
    id: "bw-auto",
    name: "BUILDWE Auto",
    family: "router",
    blurb: "Routes one prompt to the right tool.",
    status: "live",
    badge: "Free",
  },
  // Coming soon / Pro seats (space reserved)
  {
    id: "bw-pro-reason",
    name: "BUILDWE Pro Reason",
    family: "chat",
    blurb: "Deeper multi-step reasoning for hard problems.",
    status: "coming_soon",
    badge: "PRO",
  },
  {
    id: "bw-pro-code",
    name: "BUILDWE Pro Code",
    family: "code",
    blurb: "Stronger refactors, larger codebases, reviews.",
    status: "coming_soon",
    badge: "PRO",
  },
  {
    id: "bw-gpt-seat",
    name: "GPT-class seat",
    family: "chat",
    blurb: "Optional premium chat seat when enabled.",
    status: "coming_soon",
    badge: "Soon",
  },
  {
    id: "bw-claude-seat",
    name: "Claude-class seat",
    family: "code",
    blurb: "Optional premium coding seat when enabled.",
    status: "coming_soon",
    badge: "Soon",
  },
  {
    id: "bw-vision-pro",
    name: "BUILDWE Vision Pro",
    family: "image",
    blurb: "Higher-fidelity brand and product renders.",
    status: "coming_soon",
    badge: "PRO",
  },
  {
    id: "bw-voice-studio",
    name: "BUILDWE Voice Studio",
    family: "audio",
    blurb: "Studio voices, clones, longer narration.",
    status: "coming_soon",
    badge: "Soon",
  },
  {
    id: "bw-web",
    name: "Live Web",
    family: "chat",
    blurb: "Ground answers with fresh web context.",
    status: "coming_soon",
    badge: "Soon",
  },
  {
    id: "bw-sight",
    name: "Sight (Vision QA)",
    family: "image",
    blurb: "Upload a photo and ask questions about it.",
    status: "coming_soon",
    badge: "Soon",
  },
];

export function modelsForFamily(family: PublicModel["family"]) {
  return PUBLIC_MODELS.filter((m) => m.family === family);
}

export function liveModels() {
  return PUBLIC_MODELS.filter((m) => m.status === "live");
}
