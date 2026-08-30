"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Download,
  RefreshCw,
  Maximize2,
  Image as ImageIcon,
  Loader2,
  Wand2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import clsx from "clsx";

export type StudioImage = {
  id: string;
  url: string;
  prompt: string;
  userPrompt?: string;
  aspect: string;
  model?: string;
};

const ASPECTS = [
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "yt", label: "YouTube" },
  { id: "9:16", label: "9:16" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
];

const MODELS = [
  { id: "flux", label: "Vision", badge: "Live", disabled: false },
  { id: "turbo", label: "Vision Fast", badge: "Live", disabled: false },
  { id: "pro", label: "Vision Pro", badge: "Soon", disabled: true },
];

const PRESETS = [
  "YouTube thumbnail, bold face, high CTR",
  "Product shot on cream background",
  "Cinematic portrait, moody light",
  "Gaming banner, neon red black",
];

export function ImageStudio({
  images,
  activeId,
  setActiveId,
  loading,
  aspect,
  setAspect,
  modelId,
  setModelId,
  prompt,
  setPrompt,
  onGenerate,
  lastPrompt,
  failure,
  onRetry,
  onDismissFailure,
}: {
  images: StudioImage[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  loading: boolean;
  aspect: string;
  setAspect: (a: string) => void;
  modelId: string;
  setModelId: (m: string) => void;
  prompt: string;
  setPrompt: (p: string) => void;
  onGenerate: (text: string) => void;
  lastPrompt?: string;
  /** Set when the last generation job failed — user-safe message. */
  failure?: string | null;
  /** Clears the failure and re-runs the last prompt. */
  onRetry?: () => void;
  /** Dismiss the failure without retrying. */
  onDismissFailure?: () => void;
}) {
  const active = images.find((i) => i.id === activeId) || images[0];
  const [fullscreen, setFullscreen] = useState(false);

  // Determinate-feeling progress. Image providers give no real progress
  // events, so we ease towards 90% and let completion snap it to 100 —
  // an honest "still working" signal rather than a frozen spinner.
  const [progress, setProgress] = useState(0);
  const startedAt = useRef(0);
  useEffect(() => {
    if (!loading) {
      setProgress(0);
      return;
    }
    startedAt.current = Date.now();
    setProgress(4);
    const t = setInterval(() => {
      const secs = (Date.now() - startedAt.current) / 1000;
      // ~12s to approach the ceiling, then crawl
      setProgress(Math.min(90, Math.round(100 * (1 - Math.exp(-secs / 5)))));
    }, 250);
    return () => clearInterval(t);
  }, [loading]);


  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:py-10">
        {/* Hero like use.ai */}
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <ImageIcon className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Describe it. See it. Edit it.
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-sm" style={{ color: "var(--muted)" }}>
            Create from a prompt, then refine — “make it a YouTube thumbnail”, resize, restyle.
          </p>
        </div>

        {/* Canvas */}
        <div
          className="relative mx-auto flex min-h-[240px] w-full max-w-3xl items-center justify-center rounded-3xl border border-dashed p-4 sm:min-h-[320px]"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          {loading ? (
            <div className="flex w-full max-w-sm flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--accent)" }} />
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {progress < 35
                  ? "Sending your prompt…"
                  : progress < 70
                    ? "Painting your frame…"
                    : "Finishing details…"}
              </p>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--border)" }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Image generation progress"
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%`, background: "var(--accent)" }}
                />
              </div>
              <p className="text-[11px]" style={{ color: "var(--soft)" }}>
                {progress}% · usually 5–15 seconds
              </p>
              <div className="shimmer h-40 w-64 rounded-2xl sm:w-80" />
            </div>
          ) : failure ? (
            <div className="w-full max-w-sm text-center" role="alert">
              <div
                className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold">Couldn&apos;t create that image</p>
              <p className="mx-auto mt-1 max-w-xs text-[12px]" style={{ color: "var(--muted)" }}>
                {failure}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Try again
                  </button>
                )}
                {onDismissFailure && (
                  <button
                    type="button"
                    onClick={onDismissFailure}
                    className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium"
                    style={{ borderColor: "var(--border)" }}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          ) : active?.url ? (
            <div className="relative w-full text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.url}
                alt={active.userPrompt || active.prompt}
                className="mx-auto max-h-[min(52vh,420px)] w-auto rounded-2xl object-contain shadow-lg"
                referrerPolicy="no-referrer"
              />
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setFullscreen(true)}
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
                </button>
                <a
                  href={active.url}
                  download={`buildwe-${active.id}.jpg`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: "var(--border)" }}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => onGenerate(active.userPrompt || active.prompt)}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Variations
                </button>
              </div>
              {lastPrompt && (
                <p className="mx-auto mt-3 max-w-xl text-[11px] line-clamp-2" style={{ color: "var(--soft)" }}>
                  Base: {lastPrompt}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center" style={{ color: "var(--muted)" }}>
              <ImageIcon className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">Your generations appear here</p>
            </div>
          )}
        </div>

        {/* Filmstrip */}
        {images.length > 0 && (
          <div className="mx-auto mt-4 flex max-w-3xl gap-2 overflow-x-auto pb-1">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveId(img.id)}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2"
                style={{
                  borderColor: img.id === active?.id ? "var(--accent)" : "transparent",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        )}

        {/* Controls card — use.ai style */}
        <div
          className="mx-auto mt-6 w-full max-w-3xl rounded-3xl border p-4 shadow-sm sm:p-5"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Describe the image you want — or say how to edit the last one (e.g. make it a YouTube thumbnail)…"
            className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:opacity-45"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Aspect */}
            <div className="flex flex-wrap gap-1">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspect(a.id)}
                  className="rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold"
                  style={
                    aspect === a.id
                      ? {
                          borderColor: "var(--accent)",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }
                      : { borderColor: "var(--border)", color: "var(--muted)" }
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div className="mx-1 h-5 w-px" style={{ background: "var(--border)" }} />

            {/* Model */}
            <div className="flex flex-wrap gap-1">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={m.disabled}
                  onClick={() => !m.disabled && setModelId(m.id)}
                  className={clsx(
                    "rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold",
                    m.disabled && "opacity-50"
                  )}
                  style={
                    modelId === m.id
                      ? {
                          borderColor: "var(--accent)",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }
                      : { borderColor: "var(--border)", color: "var(--muted)" }
                  }
                  title={m.disabled ? "Coming soon" : m.label}
                >
                  {m.label}
                  <span className="ml-1 opacity-60">{m.badge}</span>
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <button
              type="button"
              disabled={!prompt.trim() || loading}
              onClick={() => onGenerate(prompt)}
              className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {lastPrompt && /change|thumbnail|resize|edit|kr de|kar de|usi|same/i.test(prompt)
                ? "Edit & generate"
                : "Generate"}
            </button>
          </div>

          {lastPrompt && (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ color: "var(--accent)" }}
              onClick={() =>
                setPrompt(
                  "YouTube thumbnail bana do isi scene se, bold face, high contrast, 16:9"
                )
              }
            >
              <Wand2 className="h-3.5 w-3.5" /> Quick: turn last image into YT thumbnail
            </button>
          )}
        </div>

        {/* Presets */}
        <div className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPrompt(s)}
              className="rounded-full border px-3 py-1.5 text-[11px]"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {fullscreen && active?.url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setFullscreen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.url}
            alt=""
            className="max-h-full max-w-full rounded-xl"
            onClick={(e) => e.stopPropagation()}
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}
