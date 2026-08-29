/**
 * Merge user edit instructions with the last image prompt
 * so "youtube thumbnail bana do" actually transforms the previous scene.
 */

const EDIT_RE =
  /\b(change|edit|resize|make|convert|turn|into|thumbnail|thumb|banner|same|usi|isko|esko|kr de|kar de|bana de|update|modify|crop|zoom|add|remove|fix|fix)\b/i;

export function isImageEditInstruction(text: string, hasBase: boolean) {
  if (!hasBase) return false;
  const t = text.trim();
  if (t.length < 120 && EDIT_RE.test(t)) return true;
  if (/youtube|yt\b|thumbnail|thumb|short|reel|poster|banner/i.test(t) && hasBase)
    return true;
  return false;
}

export function mergeImagePrompt(opts: {
  basePrompt?: string;
  userText: string;
  aspect?: string;
}): { prompt: string; mode: "create" | "edit" } {
  const user = opts.userText.replace(/\s+/g, " ").trim();
  const base = (opts.basePrompt || "").replace(/\s+/g, " ").trim();

  if (!base || !isImageEditInstruction(user, true)) {
    return { prompt: enhanceCreate(user, opts.aspect), mode: "create" };
  }

  const aspectHint =
    opts.aspect === "16:9"
      ? "widescreen 16:9 composition"
      : opts.aspect === "9:16"
        ? "vertical 9:16 mobile composition"
        : opts.aspect === "1:1"
          ? "square 1:1 composition"
          : `${opts.aspect || "1:1"} aspect ratio`;

  // Specialized transforms
  let transform = user;
  if (/youtube|yt\b|thumbnail|thumb/i.test(user)) {
    transform = `${user}. Restyle as a high-CTR YouTube thumbnail, bold readable text if any, high contrast face/subject, ${aspectHint}, 1280x720 style framing, dramatic lighting, no blurry text`;
  } else if (/banner|poster/i.test(user)) {
    transform = `${user}. Marketing banner layout, ${aspectHint}, clean hierarchy, punchy colors`;
  }

  const prompt = [
    "Edit and regenerate this scene with the following changes:",
    transform,
    "Keep the core subject and identity from the original concept unless asked to replace it.",
    `Original concept: ${base.slice(0, 500)}`,
    "Photorealistic or graphic as implied, sharp, high detail.",
  ].join(" ");

  return { prompt: prompt.slice(0, 900), mode: "edit" };
}

function enhanceCreate(user: string, aspect?: string) {
  const a =
    aspect === "16:9"
      ? "widescreen cinematic"
      : aspect === "9:16"
        ? "vertical mobile frame"
        : aspect === "1:1"
          ? "square balanced frame"
          : "well-composed frame";
  return `${user}. ${a}, highly detailed, sharp focus, premium lighting`.slice(
    0,
    700
  );
}
