import { Monitor, Moon, Sun } from "lucide-react";
import type { SegmentedItem } from "@/lib/ui";

/**
 * The theme preference, and the one list of choices for it.
 *
 * Both this lives here because the profile flyout (components/workspace/ProfileFlyout.tsx)
 * needs the same three options as the settings sheet, and the two must not drift: a fourth
 * value added to one list and not the other is an option that half the app can't reach. The
 * list is `SegmentedItem`s so the sheet's control and the flyout's menu rows read from the
 * same array.
 */
export type ThemePref = "system" | "light" | "dark";

/** Optional on `SegmentedItem`, always present here: the settings-sheet control draws its
icon and the flyout's menu rows draw theirs from this same array. */
export const THEME_ITEMS: SegmentedItem<ThemePref>[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function themeLabel(pref: ThemePref): string {
  return THEME_ITEMS.find((i) => i.value === pref)?.label ?? pref;
}
