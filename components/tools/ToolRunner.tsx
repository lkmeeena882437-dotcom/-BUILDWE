"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PublicTool, ToolField, Values } from "@/lib/tools/types";
import { renderSafeMarkdown } from "@/lib/safe-md";
import { applyCreditReceipt, creditsErrorFrom, openCredits, useWallet } from "@/components/billing/CreditsUI";

/**
 * The tool form + runner.
 *
 * It renders itself entirely from the tool's spec, which is the point: the
 * same data that the server uses to validate and to build the prompt is what
 * produces these inputs, so a field cannot appear in the UI that the backend
 * ignores, and a backend rule cannot exist that the UI hides.
 *
 * The output panel reports what the runner actually did — which contract
 * checks passed, which failed, whether a correction pass ran, and the partial
 * state if you hit Stop. There is no optimistic "Done!" before the answer
 * exists.
 */

type Phase = "idle" | "sending" | "streaming" | "checking" | "done" | "stopped" | "error";

type RunError = {
  error: string;
  code?: string;
  hint?: string;
  fields?: string[];
  balance?: number;
  needed?: number;
};

export function ToolRunner({
  tool,
  studio,
}: {
  tool: PublicTool;
  studio?: { slug: string; name: string; line: string };
}) {
  const initial = useMemo(() => {
    const v: Values = {};
    for (const f of tool.fields) {
      if (f.kind === "checkbox") v[f.key] = f.default === true;
      else if (f.kind === "number") v[f.key] = Number(f.default ?? f.min ?? 1);
      else if (f.kind === "select") v[f.key] = String(f.default ?? f.options?.[0]?.value ?? "");
      else v[f.key] = "";
    }
    return v;
  }, [tool]);

  const [values, setValues] = useState<Values>(initial);
  const [out, setOut] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<RunError | null>(null);
  const [meta, setMeta] = useState<{
    model?: string;
    attempts?: number;
    corrected?: boolean;
    notes?: string[];
    checks?: { passed: string[]; failed: string[] };
    issues?: string[];
    conversationId?: string;
    credits?: { charged: number; balance: number };
  }>({});
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const set = (k: string, v: string | number | boolean) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const busy = phase === "sending" || phase === "streaming" || phase === "checking";

  const lastText = useRef("");

  const run = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setOut("");
    setErr(null);
    setMeta({});
    setCopied(false);
    setPhase("sending");

    try {
      const res = await fetch(`/api/tools/${tool.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: values, ...(studio ? { studio: studio.slug } : {}) }),
        signal: ctrl.signal,
      });

      const ctype = res.headers.get("content-type") || "";
      if (!res.ok && ctype.includes("json")) {
        const j = (await res.json().catch(() => null)) as RunError | null;
        // A 402 is not a failure to explain twice: show the wallet's real
        // number and the way out, instead of a stack-trace-flavoured error.
        const short = creditsErrorFrom(j);
        if (short) applyCreditReceipt(short.balance);
        setPhase("error");
        setErr(j?.error ? j : { error: `The tool failed (HTTP ${res.status}).` });
        return;
      }
      if (!res.ok || !res.body) {
        setPhase("error");
        setErr({ error: `The tool failed (HTTP ${res.status}). Try again in a moment.` });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text = "";
      lastText.current = "";
      let sawDone = false;
      let sawError = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() || "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let j: Record<string, unknown>;
            try {
              j = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (j.meta) {
              setMeta((m) => ({ ...m, ...(j.meta as object) }));
              setPhase("streaming");
            } else if (typeof j.token === "string") {
              text += j.token;
              lastText.current = text;
              setOut(text);
            } else if (j.status === "checking") {
              setPhase("checking");
              setMeta((m) => ({
                ...m,
                checks: { ...(m.checks || { passed: [], failed: [] }), failed: (j.failed as string[]) || [] },
              }));
            } else if (typeof j.replace === "string") {
              text = j.replace;
              lastText.current = text;
              setOut(text);
              setPhase("streaming");
            } else if (j.error) {
              sawError = true;
              setPhase("error");
              setErr({ error: String(j.error) });
            } else if (j.done) {
              sawDone = true;
              const rec = j.credits as { charged?: number; balance?: number } | undefined;
              if (rec && typeof rec.balance === "number") {
                applyCreditReceipt(rec.balance);
              }
              setMeta({
                credits: rec
                  ? { charged: Number(rec.charged || 0), balance: Number(rec.balance || 0) }
                  : undefined,
                model: j.model as string | undefined,
                attempts: j.attempts as number | undefined,
                corrected: j.corrected as boolean | undefined,
                checks: (j.checks as { passed: string[]; failed: string[] }) || undefined,
                issues: (j.issues as string[]) || undefined,
                conversationId: j.conversationId as string | undefined,
              });
              setPhase("done");
            }
          }
        }
      }
      // No done frame at all: the user hit Stop or the connection dropped.
      // Say which — and never report a completion the server didn't send.
      if (sawError || sawDone) return;
      if (text) {
        setPhase("stopped");
        return;
      }
      setPhase("error");
      setErr({
        error:
          "The model returned nothing. The credit for this run was returned to your wallet — refresh the page to see the balance.",
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setPhase(lastText.current ? "stopped" : "idle");
        return;
      }
      setPhase("error");
      setErr({ error: "Couldn't reach the tool runner. Check your connection and try again." });
    }
  }, [tool.id, values, studio]);

  const stop = () => {
    abort.current?.abort();
    setPhase((p) => (p === "done" ? p : "stopped"));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(out);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  /**
   * Brand voice → saved as a real skill. Reads the current list first and
   * writes the merge, because /api/user/skills replaces the whole array and
   * blindly POSTing would wipe the user's existing instructions.
   */
  const saveBrandVoice = async () => {
    const m = out.match(/BRAND VOICE:\s*\n?([\s\S]{20,900})/i);
    const voice = (m ? m[1] : out.slice(0, 400)).replace(/\s+/g, " ").trim();
    if (!voice) {
      setSaveState("failed");
      return;
    }
    setSaveState("saving");
    try {
      const me = await fetch("/api/user/skills", { credentials: "include" });
      if (!me.ok || me.status === 401) {
        setSaveState("failed");
        return;
      }
      const cur = (await me.json()) as { skills?: string[] };
      const list = (cur.skills || []).filter((s) => !s.startsWith("BRAND VOICE:"));
      const res = await fetch("/api/user/skills", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skills: [...list, `BRAND VOICE: ${voice}`].slice(0, 15) }),
      });
      setSaveState(res.ok ? "saved" : "failed");
    } catch {
      setSaveState("failed");
    }
  };

  const filled = tool.fields.filter((f) => String(values[f.key] ?? "").trim()).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* ── inputs ── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="space-y-4 rounded-2xl border border-[#E6E0D6] bg-[#FBFAF7] p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">
            Inputs
          </span>
          <button
            type="button"
            onClick={() => setValues({ ...initial, ...tool.example })}
            className="text-xs font-medium text-[#C45C26] hover:underline"
          >
            Fill example
          </button>
        </div>

        {tool.fields.map((f) => (
          <Field key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={busy || filled === 0}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#14110F] px-4 text-sm font-semibold text-[#F7F4EE] disabled:opacity-45"
          >
            {phase === "sending" ? "Starting…" : phase === "streaming" ? "Writing…" : phase === "checking" ? "Checking output…" : "Run"}
            {tool.creditCost > 0 && phase === "idle" ? (
              <span className="rounded-md bg-[#F7F4EE]/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                {tool.creditCost} credit{tool.creditCost === 1 ? "" : "s"}
              </span>
            ) : null}
          </button>
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="h-10 rounded-xl border border-[#E6E0D6] px-3 text-sm font-medium text-[#6B6560] hover:bg-[#F1ECE3]"
            >
              Stop
            </button>
          ) : null}
        </div>
        <p className="text-[11px] leading-relaxed text-[#9C958C]">
          Costs {tool.creditCost} credit{tool.creditCost === 1 ? "" : "s"} per run
          {wallet.loaded ? ` · your balance is ${wallet.balance}` : ""}
          {tool.creditCost > 0 && wallet.loaded && wallet.balance < tool.creditCost
            ? " — not enough for another run, top up below"
            : ""}
          . Counts against your daily tool allowance on the {tool.feature === "code" ? "code" : "chat"} quota.
          Nothing runs if the output fails this tool&apos;s contract twice — you&apos;ll see which check failed.
        </p>
      </form>

      {/* ── output ── */}
      <div className="min-w-0 rounded-2xl border border-[#E6E0D6] bg-white/70">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6E0D6] px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9C958C]">Output</span>
          <div className="flex flex-wrap items-center gap-2">
            {meta.model && phase !== "sending" ? (
              <span className="bw-badge bw-badge-info">{meta.model}</span>
            ) : null}
            {meta.credits ? (
              <span
                className="bw-badge"
                title="Credits taken for this run (a refund is automatic when the runner produces nothing)"
              >
                {meta.credits.charged > 0
                  ? `−${meta.credits.charged} credit${meta.credits.charged === 1 ? "" : "s"} · ${meta.credits.balance} left`
                  : `no charge · ${meta.credits.balance} left`}
              </span>
            ) : null}
            {meta.attempts && meta.attempts > 1 ? (
              <span className="bw-badge bw-badge-warn" title="A corrective pass ran because the first answer broke the output contract">
                {meta.corrected ? "corrected once" : "correction didn't help"}
              </span>
            ) : null}
            {out ? (
              <button
                type="button"
                onClick={copy}
                className="rounded-lg border border-[#E6E0D6] px-2 py-1 text-xs font-medium text-[#6B6560] hover:bg-[#F1ECE3]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}
            {out && phase === "done" ? (
              <button
                type="button"
                onClick={() => void run()}
                className="rounded-lg border border-[#E6E0D6] px-2 py-1 text-xs font-medium text-[#6B6560] hover:bg-[#F1ECE3]"
              >
                Regenerate
              </button>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-3">
          {err ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[#8C2F22]">{err.error}</p>
              {err.hint ? <p className="text-[13px] text-[#6B6560]">{err.hint}</p> : null}
              {err.code === "INSUFFICIENT_CREDITS" ? (
                <span className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openCredits()}
                    className="rounded-lg bg-[#C45C26] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#A84B1C]"
                  >
                    Top up credits
                  </button>
                  <span className="text-[12px] text-[#9C958C]">
                    Signup grant is {wallet.welcome} credits; a pack never expires.
                  </span>
                </span>
              ) : null}
              {err.code === "LIMIT" ? (
                <Link href="/pricing" className="text-[13px] font-medium text-[#C45C26] hover:underline">
                  See what PRO raises →
                </Link>
              ) : null}
              {err.code === "PROVIDER_UNAVAILABLE" ? (
                <p className="text-[12px] text-[#9C958C]">
                  Server status: <Link className="underline" href="/status">/status</Link>
                </p>
              ) : null}
            </div>
          ) : out ? (
            <div
              className="prose-bw max-w-none text-[14px] leading-relaxed [&_h1]:text-lg [&_h2]:mt-4 [&_h2]:text-[15px] [&_h3]:mt-3 [&_h3]:text-[14px] [&_li]:my-0.5 [&_p]:my-2"
              dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(out) }}
            />
          ) : (
            <p className="py-6 text-[13px] text-[#9C958C]">
              {phase === "sending"
                ? "Contacting the model…"
                : phase === "checking"
                  ? "Your draft is written — grading it against the output contract…"
                  : phase === "stopped"
                    ? "Stopped. Whatever arrived is kept, and it's in your history."
                    : "Run the tool to see the output here."}
            </p>
          )}

          {phase === "streaming" ? (
            <div className="mt-2 h-0.5 w-full overflow-hidden rounded bg-[#EFEAE1]">
              <div className="shimmer h-full w-1/3 bg-[#C45C26]/60" />
            </div>
          ) : null}
        </div>

        {/* what we enforced — the tool's contract, reported honestly */}
        {meta.checks && (meta.checks.passed.length > 0 || meta.checks.failed.length > 0 || (meta.issues || []).length > 0) ? (
          <div className="border-t border-[#E6E0D6] px-4 py-3 text-[12px]">
            <p className="mb-1.5 font-semibold uppercase tracking-wider text-[#9C958C]">
              Output contract
            </p>
            <ul className="space-y-1">
              {(meta.checks.passed || []).map((p) => (
                <li key={p} className="flex gap-2 text-[#3D6B4A]">
                  <span aria-hidden>✓</span>
                  <span>{p}</span>
                </li>
              ))}
              {[...(meta.checks.failed || []), ...(meta.issues || [])].map((f) => (
                <li key={f} className="flex gap-2 text-[#8C5A22]">
                  <span aria-hidden>!</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {(meta.checks.failed || []).length === 0 && (meta.issues || []).length === 0 ? (
              <p className="mt-1.5 text-[#6B6560]">
                Every check passed. Saved to your history{meta.conversationId ? ` (thread ${meta.conversationId.slice(-6)})` : ""}.
              </p>
            ) : (
              <p className="mt-1.5 text-[#6B6560]">
                The answer above is still real output — these are the rules it broke. Fix the numbers yourself rather than trusting a filled placeholder.
              </p>
            )}
          </div>
        ) : null}

        {tool.afterRun === "save-brand-voice" && out ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#E6E0D6] px-4 py-3">
            <button
              type="button"
              onClick={saveBrandVoice}
              disabled={saveState === "saving"}
              className="rounded-lg bg-[#14110F] px-3 py-1.5 text-xs font-semibold text-[#F7F4EE] disabled:opacity-50"
            >
              {saveState === "saving" ? "Saving…" : "Save as my brand voice"}
            </button>
            <span className="text-[12px] text-[#6B6560]">
              {saveState === "saved"
                ? "Saved — chat and every other tool now write in this voice."
                : saveState === "failed"
                  ? "Couldn't save it. Sign in first: this needs your account, not a guest session."
                  : "Stores it as a workspace instruction (needs an account)."}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  f,
  value,
  onChange,
}: {
  f: ToolField;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const id = `tf-${f.key}`;
  const len = String(value ?? "").length;
  const cap = f.max;

  if (f.kind === "checkbox") {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2 pt-0.5 text-[13px] text-[#333]">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#C45C26]"
        />
        <span>{f.label}</span>
      </label>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-semibold text-[#14110F]">
          {f.label}
          {f.required ? <span className="text-[#C45C26]"> *</span> : null}
        </label>
        {cap ? (
          <span className={len > cap ? "text-[11px] text-[#8C2F22]" : "text-[11px] text-[#9C958C]"}>
            {len}/{cap}
          </span>
        ) : null}
      </div>
      {f.kind === "select" ? (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-xl border border-[#E6E0D6] bg-white px-2.5 text-[13px] text-[#14110F] outline-none focus:border-[#C45C26]"
        >
          {(f.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.kind === "textarea" ? (
        <textarea
          id={id}
          value={String(value ?? "")}
          placeholder={f.placeholder}
          rows={Math.min(12, Math.max(4, Math.ceil((cap || 600) / 140)))}
          maxLength={cap ? Math.round(cap * 1.2) : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-y rounded-xl border border-[#E6E0D6] bg-white px-2.5 py-2 text-[13px] leading-relaxed text-[#14110F] outline-none focus:border-[#C45C26]"
        />
      ) : f.kind === "number" ? (
        <input
          id={id}
          type="number"
          value={Number(value ?? f.default ?? f.min ?? 1)}
          min={f.min}
          max={f.max_value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 w-full rounded-xl border border-[#E6E0D6] bg-white px-2.5 text-[13px] text-[#14110F] outline-none focus:border-[#C45C26]"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={String(value ?? "")}
          placeholder={f.placeholder}
          maxLength={cap ? Math.round(cap * 1.2) : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-xl border border-[#E6E0D6] bg-white px-2.5 text-[13px] text-[#14110F] outline-none focus:border-[#C45C26]"
        />
      )}
      {f.help ? <p className="text-[11px] leading-relaxed text-[#9C958C]">{f.help}</p> : null}
    </div>
  );
}
