"use client";

/**
 * ProfileFlyout — the sidebar's account row, opened into the workspace's menu.
 *
 * WHY IT EXISTS
 * -------------
 * The bottom of the sidebar used to hold one button that did one thing: open the profile
 * sheet (an avatar, the email, plan, chats-today, Log out). Everything else a person needs
 * from an account menu — credits, plans, teams, own API keys, the theme — was scattered:
 * plans behind the ad slot's "Go Pro", settings as its own row, teams and BYOK two taps deep
 * inside the settings sheet. So the row that *names you* was the least useful thing in it.
 *
 * This makes that row a menu. It owns no screens: every row calls a `setModal(...)` or
 * `openCredits()` that already existed, so there is still exactly one profile sheet, one
 * plans sheet, one teams sheet, one BYOK panel. What is new is only the address book for
 * them, plus the live numbers (balance, plan, team, key status) that a menu can show and a
 * bare avatar cannot.
 *
 * WHY `mode="absolute"` FOR THE PANEL
 * -----------------------------------
 * The flyout sits inside the sidebar, whose only `overflow-hidden` ancestor is the
 * workspace root — the same box as the viewport. So a panel positioned `absolute` above the
 * trigger is not clipped by anything, and it keeps tracking the sidebar while the width
 * transition runs instead of needing to be re-measured. The *submenu* is the one that cannot
 * be absolute: `Popover`'s own panel is `overflow: hidden auto`, and a child placed outside
 * its parent's padding box would be cut off by the parent, not by the page — that is the
 * only reason the Theme submenu uses `mode="fixed"` (nothing between it and the viewport
 * sets `filter`/`backdrop-filter`/`transform`, so `fixed` really means "the viewport").
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - No dismiss or focus code of its own: `Popover` owns Escape, outside clicks, arrow keys
 *   (it calls `useMenuKeys` internally), focus return, and one-open-at-a-time between the
 *   two panels — `aria-controls` on this trigger is what makes the latter free.
 * - No hover-to-open submenu. Rows open on click/Enter and close on pick. Hover cascades
 *   need a leave-timer and a pointer-type check to stop them firing on touch, and the row
 *   already carries a chevron so it is discoverable; a misfiring hover on a tablet is worse.
 * - No second theme switcher. Both this submenu and the settings sheet render
 *   `THEME_ITEMS` from `lib/client/theme.ts`, and both call the page's one `setThemePref`.
 * - Nothing for signed-out users. The parent keeps its "Log in" button in that case; a menu
 *   of "Plans, Credits, Log out" with no account behind it is a dead end.
 */
import { useRef, useState } from "react";
import { ChevronRight, Coins, KeyRound, LogOut, Palette, Rocket, User, Users } from "lucide-react";
import clsx from "clsx";
import { MenuDivider, MenuRow, Popover, menuTriggerProps } from "@/lib/ui";
import { THEME_ITEMS, themeLabel, type ThemePref } from "@/lib/client/theme";
import { openCredits, useWallet } from "@/components/billing/CreditsUI";

/** Two ids, one contract each: `aria-controls` on a trigger is how `useDismiss` lets one menu be open at a time. */
export const PROFILE_MENU_ID = "bw-profile-menu";
export const PROFILE_THEME_MENU_ID = "bw-profile-theme-menu";

export interface ProfileFlyoutProps {
  /** The sidebar's collapsed state: 72px of icons, no labels. */
  collapsed?: boolean;
  name?: string;
  email?: string;
  plan: string;
  /** Whether a BYOK key is actually being used for requests — the server decides this, we only display it. */
  byokActive?: boolean;
  teamName?: string;
  themePref: ThemePref;
  onTheme: (p: ThemePref) => void;
  onOpenProfile: () => void;
  onOpenPlans: () => void;
  onOpenTeams: () => void;
  onOpenByok: () => void;
  onSignOut: () => void;
}

export function ProfileFlyout({
  collapsed = false,
  name,
  email,
  plan,
  byokActive = false,
  teamName,
  themePref,
  onTheme,
  onOpenProfile,
  onOpenPlans,
  onOpenTeams,
  onOpenByok,
  onSignOut,
}: ProfileFlyoutProps) {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const themeRowRef = useRef<HTMLButtonElement | null>(null);
  const w = useWallet();

  const initial = (name || "U").slice(0, 1).toUpperCase();
  const isPro = plan === "pro";
  const firstPack = w.packs[0];
  const packHint = firstPack ? `${firstPack.credits} credits · ${firstPack.displayAmount}` : "Top up or upgrade";
  const balanceHint = !w.loaded
    ? "Loading your balance…"
    : `${w.balance ?? 0} credit${w.balance === 1 ? "" : "s"} left`;

  const close = () => {
    setThemeOpen(false);
    setOpen(false);
  };

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        data-action="profile-menu"
        aria-label={collapsed ? "Account menu" : undefined}
        title={collapsed ? "Account menu" : undefined}
        className={clsx(
          "bw-side-row flex w-full items-center gap-2.5 rounded-2xl py-2 text-sm",
          collapsed ? "justify-center" : "px-3"
        )}
        style={open ? { background: "var(--secondary)" } : undefined}
        onClick={() => setOpen((v) => !v)}
        {...menuTriggerProps(open, PROFILE_MENU_ID)}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          aria-hidden
        >
          {initial}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[12px] font-medium">{name}</span>
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>
              {isPro ? "PRO" : "Free"}
            </span>
          </span>
        )}
        {!collapsed && (
          <ChevronRight
            className="bw-side-row__chev h-4 w-4 shrink-0"
            style={{ color: "var(--soft)", transform: open ? "rotate(90deg)" : undefined }}
            aria-hidden
          />
        )}
      </button>

      <Popover
        id={PROFILE_MENU_ID}
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        mode="absolute"
        placement="above"
        align="start"
        width={collapsed ? 244 : "100%"}
        label="Account"
        pause={themeOpen}
        allowSubmenus
      >
        <MenuRow
          dataAction="profile-account"
          icon={User}
          title="Account & profile"
          hint={email || "Signed in"}
          onClick={() => {
            close();
            onOpenProfile();
          }}
        />
        <MenuRow
          dataAction="profile-credits"
          icon={Coins}
          title="Credits"
          hint={balanceHint}
          onClick={() => {
            close();
            openCredits();
          }}
        />
        <MenuRow
          dataAction="profile-plans"
          icon={Rocket}
          title={isPro ? "Your plan · PRO" : "Plans & top-ups"}
          hint={isPro ? "Thank you for being here" : packHint}
          onClick={() => {
            close();
            onOpenPlans();
          }}
        />
        <MenuRow
          dataAction="profile-teams"
          icon={Users}
          title="Teams"
          hint={teamName ? `In ${teamName}` : "No active team"}
          onClick={() => {
            close();
            onOpenTeams();
          }}
        />
        <MenuRow
          dataAction="profile-byok"
          icon={KeyRound}
          title="Your own API key"
          hint={byokActive ? "Active — requests use your key" : "Add one and requests stop spending credits"}
          right={byokActive ? <span style={{ color: "var(--ok)" }}>On</span> : undefined}
          onClick={() => {
            close();
            onOpenByok();
          }}
        />

        <MenuDivider />

        <MenuRow
          dataAction="profile-theme"
          icon={Palette}
          title="Theme"
          hint={`Now: ${themeLabel(themePref)}`}
          rowRef={themeRowRef}
          right={<ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--soft)" }} aria-hidden />}
          onClick={() => setThemeOpen((v) => !v)}
        />
        <Popover
          id={PROFILE_THEME_MENU_ID}
          open={themeOpen}
          onClose={() => setThemeOpen(false)}
          anchorRef={themeRowRef}
          mode="fixed"
          placement="right"
          align="start"
          width={168}
          label="Theme"
          submenu
        >
          {THEME_ITEMS.map((it) => (
            <MenuRow
              key={it.value}
              dataAction={`theme-${it.value}`}
              icon={it.icon}
              title={it.label}
              selected={themePref === it.value}
              onClick={() => {
                onTheme(it.value);
                setThemeOpen(false);
              }}
            />
          ))}
        </Popover>

        <MenuDivider />

        <MenuRow
          dataAction="profile-signout"
          icon={LogOut}
          title="Log out"
          danger
          onClick={() => {
            close();
            onSignOut();
          }}
        />
      </Popover>
    </div>
  );
}
