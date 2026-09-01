import { Bot, Code2, Image as ImageIcon, MessageSquare, Mic2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The five workspace modes, in one place.
 *
 * These lived as a local `const` inside app/page.tsx, but the composer is now its own
 * component (components/workspace/PromptBar.tsx) and Step 5's mode picker needs the same
 * list — a catalogue copied into a second file is the drift this repo keeps getting
 * audited for (the price table, the tool list). Single owner here; page.tsx imports it.
 */
export type Mode = "auto" | "chat" | "code" | "image" | "audio";

export interface ModeMeta {
  id: Mode;
  label: string;
  /**
   * LucideIcon, not ElementType: `MenuRow` and every other icon slot in lib/ui take this
   * type, and ElementType also accepts a raw string — so the catalogue could name an
   * element that exists in no JSX registry and still type-check.
   */
  icon: LucideIcon;
  headline: string;
  sub: string;
  power: string;
}

export const MODE_META: ModeMeta[] = [
  {
    id: "auto",
    label: "Auto",
    icon: Bot,
    headline: "Ask once. BUILDWE routes it.",
    sub: "One box for thinking, building, visuals, and voice.",
    power: "Smart routing",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    headline: "Think. Write. Understand.",
    sub: "Decide faster. Write sharper. Learn without noise.",
    power: "BUILDWE Chat",
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
    headline: "Build. Debug. Ship.",
    sub: "Scaffold, fix, and ship — without leaving the workspace.",
    power: "BUILDWE Code",
  },
  {
    id: "image",
    label: "Vision",
    icon: ImageIcon,
    headline: "Imagine. Create. Transform.",
    sub: "Brand frames, product shots, and scenes on demand.",
    power: "BUILDWE Vision",
  },
  {
    id: "audio",
    label: "Voice",
    icon: Mic2,
    headline: "Speak. Listen. Create.",
    sub: "Natural speech for briefs, stories, and product copy.",
    power: "BUILDWE Voice",
  },
];

export const modeMeta = (m: Mode): ModeMeta => MODE_META.find((x) => x.id === m)!;
