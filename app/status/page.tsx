"use client";

import { useEffect, useState } from "react";
import { SitePage } from "@/components/SitePage";
import { Loader2 } from "lucide-react";

/**
 * The page renders `health.services` as-is — no label table of its own, no
 * guessing. /status used to keep a local `LABELS` map and derive the badge
 * from `!String(v).includes("offline")`, which meant a row's colour was a
 * property of a prose sentence (audit A13): seven rows were permanently green,
 * audio was permanently amber, `vision` had a label with no row, and the
 * internal list of configured providers was shown to visitors as a row.
 */

type ServiceState = "live" | "degraded" | "unconfigured" | "down";
type ServiceRow = {
  label: string;
  state: ServiceState;
  ok: boolean;
  detail: string;
  evidence: string;
};
type Health = {
  ok: boolean;
  app: string;
  services: Record<string, ServiceRow>;
  models: {
    catalogSize: number;
    byCapability: { capability: string; total: number; reachable: number }[];
  };
  db: string;
  durability: Record<string, string>;
  time: string;
};

const BADGE: Record<ServiceState, { text: string; cls: string }> = {
  live: { text: "● Live", cls: "bw-badge-ok" },
  degraded: { text: "● Degraded", cls: "bw-badge-warn" },
  unconfigured: { text: "● Not connected", cls: "bw-badge-warn" },
  down: { text: "● Down", cls: "bw-badge-warn" },
};

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/health")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => {
          setHealth(j);
          setFailed(false);
        })
        .catch(() => {
          setHealth(null);
          setFailed(true);
        })
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const rows = health ? Object.entries(health.services) : [];
  const counts = rows.reduce(
    (acc, [, r]) => {
      acc[r.state] = (acc[r.state] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <SitePage
      eyebrow="Trust"
      title="Service status"
      lede="Live from the platform itself — refreshed every 30 seconds. Honest by design: we show degraded and missing integrations, not just green."
    >
      {loading && (
        <p className="flex items-center gap-2 text-sm text-[#6B6560]">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking services…
        </p>
      )}

      {!loading && failed && (
        <div className="rounded-3xl border border-[#c0392b]/30 bg-[#fdeae7] p-5">
          <div className="text-lg font-semibold">Status endpoint unreachable</div>
          <p className="mt-1 text-xs text-[#6B6560]">
            We could not read /api/health, so we are not showing you a green
            banner we have not earned. Retry by reloading; if it persists, the
            platform itself is likely impaired too.
          </p>
        </div>
      )}

      {health && (
        <>
          <div
            className={`rounded-3xl border p-5 ${
              health.ok
                ? "border-[#1f7a3d]/30 bg-[#e3f2e7]"
                : "border-[#c0392b]/30 bg-[#fdeae7]"
            }`}
          >
            <div className="text-lg font-semibold">
              {health.ok
                ? counts.degraded || counts.unconfigured
                  ? "Operational — some features are limited"
                  : "All systems operational"
                : "Not fully operational"}
            </div>
            <p className="mt-1 text-xs text-[#6B6560]">
              {rows.length} services · {counts.live || 0} live ·{" "}
              {counts.degraded || 0} degraded · {counts.unconfigured || 0} not
              connected · {counts.down || 0} down · Storage: {health.db} ·
              Checked {new Date(health.time).toLocaleTimeString()}
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-[#E6E0D6] bg-white">
            {rows.map(([key, r]) => (
              <div
                key={key}
                className="flex items-start justify-between gap-4 border-b border-[#E6E0D6] px-5 py-3.5 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="mt-0.5 text-xs text-[#6B6560]">{r.detail}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-[#9C958C]">
                    measured: {r.evidence}
                  </div>
                </div>
                <span className={`bw-badge shrink-0 ${BADGE[r.state].cls}`}>
                  {BADGE[r.state].text}
                </span>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-3xl border border-[#E6E0D6] bg-white">
            <div className="border-b border-[#E6E0D6] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#6B6560]">
              Callable models by capability ({health.models.catalogSize} catalogued)
            </div>
            {health.models.byCapability.map((c) => (
              <div
                key={c.capability}
                className="flex items-center justify-between border-b border-[#E6E0D6] px-5 py-2.5 text-sm last:border-0"
              >
                <span className="capitalize">{c.capability}</span>
                <span
                  className={
                    c.reachable > 0
                      ? "text-[#1f7a3d]"
                      : "text-[#9C958C]"
                  }
                >
                  {c.reachable} of {c.total} reachable
                </span>
              </div>
            ))}
          </div>

          <p className="text-xs text-[#9C958C]">
            “Not connected” means the feature is present in the product but has
            no credential behind it on this server — we keep it visible instead
            of hiding it. Issues?{" "}
            <a href="/contact" className="underline">
              Tell us
            </a>
            .
          </p>
        </>
      )}
    </SitePage>
  );
}
