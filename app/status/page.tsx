"use client";

import { useEffect, useState } from "react";
import { SitePage } from "@/components/SitePage";
import { Loader2 } from "lucide-react";

type Health = {
  ok: boolean;
  demoMode: boolean;
  providers: Record<string, string>;
  db: string;
  time: string;
};

const LABELS: Record<string, string> = {
  llm: "Chat & Code models",
  image: "Image generation",
  audio: "Voice generation",
  vision: "Image understanding",
  webSearch: "Web search",
  devApi: "Developer API",
  byok: "Key encryption",
};

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((j) => setHealth(j))
        .catch(() => setHealth(null))
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const up = (v?: string) => Boolean(v && !String(v).includes("offline") && !String(v).includes("fallback"));

  return (
    <SitePage
      eyebrow="Trust"
      title="Service status"
      lede="Live from the platform itself — refreshed every 30 seconds. Honest by design: we show degraded states, not just green."
    >
      {loading && (
        <p className="flex items-center gap-2 text-sm text-[#6B6560]">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking services…
        </p>
      )}

      {health && (
        <>
          <div className={`rounded-3xl border p-5 ${health.ok ? "border-[#1f7a3d]/30 bg-[#e3f2e7]" : "border-[#c0392b]/30 bg-[#fdeae7]"}`}>
            <div className="text-lg font-semibold">
              {health.ok ? "All systems operational" : "Degraded — some services affected"}
            </div>
            <p className="mt-1 text-xs text-[#6B6560]">
              Storage: {health.db} · Checked {new Date(health.time).toLocaleTimeString()}
              {health.demoMode ? " · demo mode (no provider keys set — answers fall back to offline smart mode)" : ""}
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-[#E6E0D6] bg-white">
            {Object.entries(health.providers).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-[#E6E0D6] px-5 py-3.5 last:border-0">
                <div>
                  <div className="text-sm font-medium">{LABELS[k] || k}</div>
                  <div className="text-xs text-[#9C958C]">{v}</div>
                </div>
                <span
                  className={`bw-badge ${up(v) ? "bw-badge-ok" : "bw-badge-warn"}`}
                >
                  {up(v) ? "● Live" : "● Fallback active"}
                </span>
              </div>
            ))}
          </div>

          <p className="text-xs text-[#9C958C]">
            “Fallback active” means the feature still works through its backup path (e.g. browser voice
            instead of server audio, or offline answers instead of a provider). Issues?{" "}
            <a href="/contact" className="underline">Tell us</a>.
          </p>
        </>
      )}
    </SitePage>
  );
}
