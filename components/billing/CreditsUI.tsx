"use client";

/**
 * The credit wallet UI: one tiny store, a chip for the header and a sheet for
 * buying credits.
 *
 * Why a module store instead of context: the balance has to move in three
 * places at once (the header chip, the open sheet, and whatever just spent a
 * credit), and a generation that succeeds knows the new balance from its own
 * response frame. Drilling that through props would touch every runner in the
 * app for no benefit.
 *
 * The static half (cost table, pack prices, welcome grant) is passed in from
 * the server layout, so the UI can never quote a price the API disagrees with
 * — the same drift that audit A6 caught on the PRO price.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Coins, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";

export type PackPrice = {
  id: string;
  label: string;
  credits: number;
  paise: number;
  displayAmount: string;
};

export type CostTable = {
  chat: number;
  image: number;
  audio: number;
  transcribe: number;
  vision: number;
  agent: number;
  compareLane: number;
  tool: number;
};

export type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
};

type WalletState = {
  balance: number;
  welcome: number;
  welcomeAt: string | null;
  plan: string;
  proMonthly: number;
  signedIn: boolean;
  loaded: boolean;
  error: string;
  ledger: LedgerRow[];
};

type Statics = {
  costs: CostTable;
  packs: PackPrice[];
  welcome: number;
  proMonthly: number;
  /** the gateway's per-message ceiling, in characters; undefined until the wallet has loaded */
  limits?: { messageChars: number };
};

const state: WalletState = {
  balance: 0,
  welcome: 10,
  welcomeAt: null,
  plan: "free",
  proMonthly: 1000,
  signedIn: false,
  loaded: false,
  error: "",
  ledger: [],
};

let statics: Statics = {
  limits: undefined,
  costs: { chat: 0, image: 2, audio: 1, transcribe: 1, vision: 1, agent: 3, compareLane: 1, tool: 1 },
  packs: [],
  welcome: 10,
  proMonthly: 1000,
};

const subs = new Set<() => void>();
function emit() {
  for (const f of Array.from(subs)) f();
}

let inflight: Promise<void> | null = null;

/** Read the wallet from the server. Concurrent callers share one request. */
export async function loadWallet(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/credits", { credentials: "include" });
      const j = await res.json().catch(() => null);
      if (res.ok && j && typeof j.balance === "number") {
        state.balance = j.balance;
        state.welcome = Number(j.welcome ?? state.welcome);
        state.welcomeAt = j.welcomeAt || null;
        state.plan = String(j.plan || "free");
        state.proMonthly = Number(j.proMonthly ?? state.proMonthly);
        state.ledger = Array.isArray(j.ledger) ? j.ledger : [];
        state.signedIn = Boolean(j.signedIn);
        state.loaded = true;
        state.error = "";
        if (j.limits && typeof j.limits.messageChars === "number") {
          statics.limits = { messageChars: Number(j.limits.messageChars) };
        }
        if (j.costs && typeof j.costs.image === "number") {
          statics = {
            ...statics,
            costs: j.costs,
            packs: Array.isArray(j.costs.packs) ? j.costs.packs : statics.packs,
          };
        }
      } else {
        state.error = "Wallet unavailable";
        state.loaded = true;
      }
    } catch {
      state.error = "Wallet unavailable";
      state.loaded = true;
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

/** A runner just reported a new balance — show it without another request. */
export function applyCreditReceipt(balance: number) {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return;
  state.balance = balance;
  state.loaded = true;
  emit();
}

export function useWallet() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((x) => x + 1);
    subs.add(f);
    if (!state.loaded) void loadWallet();
    return () => {
      subs.delete(f);
    };
  }, []);
  return { ...state, costs: statics.costs, packs: statics.packs, limits: statics.limits };
}

/* ── open / close the sheet ─────────────────────────────────── */

let sheetOpen = false;
function setSheet(v: boolean) {
  sheetOpen = v;
  emit();
}
export function useSheetOpen() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((x) => x + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return sheetOpen;
}
export function openCredits() {
  setSheet(true);
  void loadWallet();
}

/* ── the chip in the workspace header ───────────────────────── */

export function WalletChip() {
  const w = useWallet();
  const open = useSheetOpen();
  const short = !w.loaded;
  return (
    <button
      type="button"
      onClick={openCredits}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Credits — what a generation costs and how to top up"
      className="inline-flex items-center gap-1.5 rounded-xl border border-[#E6E0D6] bg-[#FBFAF7] px-2.5 py-1.5 text-xs font-medium text-[#14110F] hover:border-[#C45C26]/40 hover:bg-[#F4EFE6]"
    >
      <Coins className="h-3.5 w-3.5 text-[#C45C26]" />
      {short ? (
        <span className="tabular-nums text-[#9C958C]">···</span>
      ) : (
        <span className="tabular-nums">{w.balance}</span>
      )}
      <span className="hidden text-[#6B6560] sm:inline">credits</span>
    </button>
  );
}

/* ── the sheet ──────────────────────────────────────────────── */

const REASONS: Record<string, string> = {
  welcome: "Welcome grant",
  "pro-monthly": "PRO monthly",
  "top-up": "Top-up",
  compare: "Model comparison",
  "compare-lane-refund": "Comparison: dead lanes refunded",
  image: "Image",
  "image-refund": "Image refund (provider returned nothing)",
  audio: "Voice",
  "audio-refund": "Voice refund",
  transcribe: "Transcription",
  "transcribe-refund": "Transcription refund",
  vision: "Image read",
  "vision-refund": "Image read refund",
  agent: "Agent run",
  "agent-refund": "Agent refund",
};

function labelForReason(reason: string): string {
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith("tool:noop-refund")) return "Tool: nothing to do (refunded)";
  if (reason.startsWith("tool:correction-refund")) return "Tool: correction refunded";
  if (reason.startsWith("tool:quota-refund")) return "Tool: daily limit (refunded)";
  if (reason.startsWith("tool:")) {
    const rest = reason.slice(5).replace(/:/g, " · ").replace(/-/g, " ");
    return `Tool: ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  }
  return reason.replace(/-/g, " ");
}

function when(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function CreditsSheet() {
  const w = useWallet();
  const open = useSheetOpen();

  // The client API layer reports credit events; a 402 from any studio opens
  // this sheet, so nobody is left holding an error with no way forward.
  useEffect(() => {
    const onShort = () => {
      setSheet(true);
      void loadWallet();
    };
    const onReceipt = (e: Event) => {
      const d = (e as CustomEvent<{ balance?: number }>).detail;
      if (d && typeof d.balance === "number") applyCreditReceipt(d.balance);
    };
    window.addEventListener("bw:credits:shortfall", onShort);
    window.addEventListener("bw:credits:receipt", onReceipt);
    return () => {
      window.removeEventListener("bw:credits:shortfall", onShort);
      window.removeEventListener("bw:credits:receipt", onReceipt);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Credits"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => setSheet(false)}
        className="absolute inset-0 bg-[#14110F]/35"
      />
      <div className="relative flex h-full w-full max-w-[430px] flex-col overflow-y-auto border-l border-[#E6E0D6] bg-[#FBFAF7] p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#14110F]">Credits</h2>
            <p className="mt-0.5 text-xs text-[#6B6560]">
              One wallet for every generation. Nothing is charged when a run
              fails.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSheet(false)}
            className="rounded-lg p-1.5 text-[#6B6560] hover:bg-[#EFEAE1] hover:text-[#14110F]"
            aria-label="Close credits"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[#E6E0D6] bg-white p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#9C958C]">
                Balance
              </p>
              <p className="text-3xl font-semibold tabular-nums text-[#14110F]">
                {w.loaded ? w.balance : "—"}
              </p>
            </div>
            <p className="text-[11px] text-[#6B6560]">
              {w.plan === "pro" ? (
                <span className="inline-flex items-center gap-1 text-[#C45C26]">
                  <Check className="h-3 w-3" /> PRO: {w.proMonthly}/month
                </span>
              ) : (
                <>
                  {w.welcome} free at signup
                </>
              )}
            </p>
          </div>
        </div>

        <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-[#9C958C]">
          What costs what
        </h3>
        {!w.loaded && (
          <p className="mt-2 rounded-xl border border-dashed border-[#E6E0D6] p-3 text-xs text-[#6B6560]">
            Reading the price list from the server…
          </p>
        )}
        <ul className={w.loaded ? "mt-2 space-y-1 text-sm" : "hidden"}>
          {[
            ["Chat", w.costs.chat],
            ["Any tool (blog, email, reel script…)", w.costs.tool],
            ["Heavy tool (long, multi-section)", 2],
            ["Image", w.costs.image],
            ["Voice-over", w.costs.audio],
            ["Transcription", w.costs.transcribe],
            ["Read an image", w.costs.vision],
            ["Each live lane in a comparison", w.costs.compareLane],
            ["Agent run (multi-file code job)", w.costs.agent],
          ].map(([label, n]) => (
            <li
              key={String(label)}
              className="flex items-center justify-between rounded-lg bg-[#F4EFE6]/60 px-2.5 py-1.5"
            >
              <span className="text-[#3A3630]">{label}</span>
              <span className="font-medium tabular-nums text-[#14110F]">
                {Number(n) === 0 ? "free" : `${n} credit${Number(n) === 1 ? "" : "s"}`}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-[#9C958C]">
          Top up
        </h3>
        <CreditPacksBlock />

        {w.ledger.length > 0 && (
          <>
            <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-[#9C958C]">
              Recent activity
            </h3>
            <ul className="mt-2 divide-y divide-[#EFEAE1] rounded-xl border border-[#E6E0D6] bg-white text-sm">
              {w.ledger.slice(0, 12).map((row) => (
                <li key={row.id} className="flex items-center justify-between px-3 py-2">
                  <span className="truncate pr-2 text-[#3A3630]">
                    {labelForReason(row.reason)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className={row.delta > 0 ? "text-[#2F6B4F]" : "text-[#8C2F22]"}>
                      {row.delta > 0 ? `+${row.delta}` : row.delta}
                    </span>
                    <span className="ml-2 text-[11px] text-[#9C958C]">
                      {when(row.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-auto pt-5 text-[11px] leading-relaxed text-[#9C958C]">
          Credits never expire while your account is open. A pack is a
          one-time purchase, not a subscription — PRO is separate and adds{" "}
          {w.proMonthly} credits every month.
        </p>
      </div>
    </div>
  );
}

/**
 * The pack list, shared by the sheet and /pricing so the two can never show a
 * different price than the order endpoint charges: every number here arrives
 * from the server (GET /api/credits), and a purchase goes through
 * POST /api/checkout/order + the signature check in /api/checkout/verify.
 */
export function CreditPacksBlock({
  onBuy,
}: {
  onBuy?: (packId: string) => Promise<{ granted?: boolean; note?: string }>;
}) {
  const w = useWallet();
  const buy = useBuyPack();
  const pay = onBuy || buy;
  return (
    <div className="space-y-2">
      {w.packs.length === 0 && (
        <p className="rounded-xl border border-dashed border-[#E6E0D6] p-3 text-xs text-[#6B6560]">
          Pack prices are loading from the server…
        </p>
      )}
      {w.packs.map((p) => (
        <PackRow key={p.id} pack={p} onBuy={() => pay(p.id)} signedIn={w.signedIn} />
      ))}
      {!w.signedIn && w.packs.length > 0 && (
        <p className="text-[11px] text-[#6B6560]">
          Top-ups need an account — the wallet has to survive a cleared
          cookie, or your credits would vanish with it.
        </p>
      )}
    </div>
  );
}

/**
 * Buy a pack: server-side order, real Razorpay, server-side signature check.
 * Shared by the sheet and /pricing so one implementation owns the money path.
 */
export function useBuyPack() {
  const router = useRouter();
  const w = useWallet();
  return useCallback(
    async (packId: string) => {
      const r = await startPackCheckout(packId, w.signedIn, router);
      if (r.granted) void loadWallet();
      return r;
    },
    [router, w.signedIn]
  );
}

function PackRow({
  pack,
  onBuy,
  signedIn,
}: {
  pack: PackPrice;
  onBuy: () => Promise<{ note?: string; granted?: boolean }>;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const perCredit = pack.paise / 100 / pack.credits;
  // Currency symbol taken from the server's own display string, so nothing is
  // hard-coded here that could disagree with what is charged.
  const sym = pack.displayAmount.replace(/[0-9.,\s]/g, "") || "";

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E6E0D6] bg-white px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#14110F]">
          {pack.credits} credits{" "}
          <span className="text-[#C45C26]">· {pack.displayAmount}</span>
        </p>
        <p className="truncate text-[11px] text-[#6B6560]">
          {pack.label} · {sym}
          {perCredit.toFixed(2)} per credit
        </p>
      </div>
      <div className="shrink-0 text-right">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote("");
            const r = await onBuy();
            setBusy(false);
            if (r.granted) setDone(true);
            if (r.note) setNote(r.note);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#C45C26] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#A84B1C] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {done ? <Check className="h-3.5 w-3.5" /> : null}
          {busy ? "Opening…" : done ? "Credited" : signedIn ? "Buy" : "Log in & buy"}
        </button>
        {note && <p className="mt-1 max-w-[190px] text-[10px] text-[#8C2F22]">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Real Razorpay checkout for a pack. Mirrors components/billing/UpgradeButton
 * exactly: the server creates the order, the browser never decides a price,
 * and the signature is verified server-side before a single credit is minted.
 * A demo order (no live keys) is refused by the server, and we say so here
 * instead of showing a fake success.
 */
async function startPackCheckout(
  packId: string,
  signedIn: boolean,
  router: ReturnType<typeof useRouter>
): Promise<{ granted?: boolean; note?: string }> {
  try {
    if (!signedIn) {
      router.push("/");
      return {
        note: "Create a free account first — then top up in one tap.",
      };
    }
    const orderR = await fetch("/api/checkout/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pack: packId }),
    });
    const orderJ = await orderR.json().catch(() => ({}));
    if (!orderR.ok) {
      return {
        note:
          orderJ.code === "CHECKOUT_UNAVAILABLE"
            ? "Payments aren't enabled on this server yet, so packs can't be bought right now."
            : String(orderJ.error || "Couldn't start checkout."),
      };
    }
    const { order, keyId, demo } = orderJ as {
      order: { id: string; amount: number; currency: string };
      keyId: string;
      demo: boolean;
      credits: number;
    };
    if (demo) {
      return {
        note:
          "Demo order created, but no credits were added: demo orders cannot be redeemed. Add real Razorpay keys to sell packs.",
      };
    }
    if (!keyId) return { note: "Payments aren't configured on this server." };

    const loaded = await new Promise<boolean>((resolve) => {
      if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
    const RZ = (
      window as unknown as {
        Razorpay?: new (o: Record<string, unknown>) => { open: () => void };
      }
    ).Razorpay;
    if (!loaded || !RZ) return { note: "Couldn't load the payment window. Check your connection." };

    const verify = async (payload: Record<string, string>) => {
      const r = await fetch("/api/checkout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(String(j.error || "Verification failed"));
      return j as { credits?: number; granted?: boolean };
    };

    return await new Promise((resolve) => {
      const rzp = new RZ({
        key: keyId,
        amount: order.amount,
        currency: order.currency,
        name: "BUILDWE.ONLINE",
        description: `BUILDWE credits — ${orderJ.credits ?? ""} credit pack`,
        order_id: order.id,
        theme: { color: "#C45C26" },
        handler: async (response: Record<string, string>) => {
          try {
            const j = await verify(response);
            resolve({
              granted: Boolean(j.granted),
              note: j.granted
                ? `${j.credits ?? orderJ.credits ?? ""} credits added.`
                : "Payment captured — the wallet will update in a moment.",
            });
          } catch (e) {
            resolve({ note: (e as Error).message });
          }
        },
        modal: {
          ondismiss: () => resolve({ note: "Checkout closed — nothing was charged." }),
        },
      });
      rzp.open();
    });
  } catch (e) {
    return { note: (e as Error).message || "Checkout failed. Try again." };
  }
}

/** Lets any runner surface the sheet when a 402 INSUFFICIENT_CREDITS lands. */
export function creditsErrorFrom(body: unknown): { message: string; needed: number; balance: number } | null {
  const j = body as { code?: string; error?: string; needed?: number; balance?: number } | null;
  if (!j || j.code !== "INSUFFICIENT_CREDITS") return null;
  return {
    message: String(j.error || "Out of credits."),
    needed: Number(j.needed || 0),
    balance: Number(j.balance || 0),
  };
}
