"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic2,
  Play,
  Pause,
  Download,
  Loader2,
  Volume2,
} from "lucide-react";
import clsx from "clsx";

export type VoiceOpt = {
  id: string;
  label: string;
  lang: string;
  tone: string;
  tier?: "live" | "soon";
};

export function AudioStudio({
  text,
  setText,
  voice,
  setVoice,
  speed,
  setSpeed,
  voices,
  loading,
  onGenerate,
  lastSpoken,
}: {
  text: string;
  setText: (t: string) => void;
  voice: string;
  setVoice: (v: string) => void;
  speed: number;
  setSpeed: (s: number) => void;
  voices: VoiceOpt[];
  loading: boolean;
  onGenerate: () => void;
  lastSpoken?: { text: string; voice: string; audioUrl?: string } | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  const liveVoices = useMemo(
    () => voices.filter((v) => v.tier !== "soon"),
    [voices]
  );
  const soonVoices = useMemo(
    () => voices.filter((v) => v.tier === "soon"),
    [voices]
  );

  const visible = showAll ? liveVoices : liveVoices.slice(0, 8);
  const activeLabel =
    voices.find((v) => v.id === voice)?.label || voice;

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  const togglePlay = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const speakText = lastSpoken?.text || text;
    if (!speakText.trim()) return;

    if (playing) {
      window.speechSynthesis.cancel();
      setPlaying(false);
      return;
    }

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakText);
    u.rate = speed;
    const sys = window.speechSynthesis.getVoices();
    const pref = voices.find((x) => x.id === voice);
    const match =
      sys.find((v) =>
        pref?.lang?.startsWith("HI")
          ? /hi|hindi/i.test(v.lang + v.name)
          : /en/i.test(v.lang)
      ) || sys[0];
    if (match) u.voice = match;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    utterRef.current = u;
    setPlaying(true);
    window.speechSynthesis.speak(u);
  };

  const downloadScript = () => {
    const blob = new Blob(
      [`BUILDWE Voice\nVoice: ${activeLabel}\nSpeed: ${speed}x\n\n${text}`],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "buildwe-voice-script.txt";
    a.click();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:flex-row sm:py-10">
        {/* Left editor — Voicemaker style */}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <Mic2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Script in. Voice out.
              </h1>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Studio-style text to speech · pick a voice · convert
              </p>
            </div>
          </div>

          <div
            className="rounded-3xl border p-4 shadow-sm sm:p-5"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                Live · {activeLabel}
              </span>
              <span className="text-[11px]" style={{ color: "var(--soft)" }}>
                Multilingual device voices
              </span>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 5000))}
              rows={12}
              placeholder="Type or paste your script here…"
              className="min-h-[220px] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:opacity-45"
            />

            <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: "var(--soft)" }}>
              <span>{text.length} / 5000</span>
              <button type="button" className="hover:underline" onClick={() => setText("")}>
                Clear
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                Speed
              </span>
              {[0.75, 1, 1.25, 1.5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className="rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold"
                  style={
                    speed === s
                      ? {
                          borderColor: "var(--accent)",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }
                      : { borderColor: "var(--border)", color: "var(--muted)" }
                  }
                >
                  {s}×
                </button>
              ))}
              <div className="flex-1" />
              <button
                type="button"
                disabled={!text.trim() || loading}
                onClick={onGenerate}
                className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: "var(--accent)" }}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
                Convert to speech
              </button>
            </div>
          </div>
        </div>

        {/* Right panel — voice list + player */}
        <div className="w-full shrink-0 sm:w-[300px]">
          <div
            className="rounded-3xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
              Voices
            </div>
            <div className="mt-3 max-h-[280px] space-y-1 overflow-y-auto pr-1">
              {visible.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVoice(v.id)}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition"
                  )}
                  style={
                    voice === v.id
                      ? { background: "var(--accent-soft)", color: "var(--accent)" }
                      : { color: "var(--ink)" }
                  }
                >
                  <span className="font-medium">{v.label}</span>
                  <span className="text-[10px] opacity-70">
                    {v.lang} · {v.tone}
                  </span>
                </button>
              ))}
            </div>
            {liveVoices.length > 8 && (
              <button
                type="button"
                className="mt-2 text-xs font-semibold"
                style={{ color: "var(--accent)" }}
                onClick={() => setShowAll((s) => !s)}
              >
                {showAll ? "Show less" : `Show more (+${liveVoices.length - 8})`}
              </button>
            )}

            {soonVoices.length > 0 && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
                  Studio voices · Coming soon
                </div>
                <div className="mt-2 space-y-1 opacity-60">
                  {soonVoices.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-xl px-3 py-2 text-xs"
                      style={{ background: "var(--secondary)" }}
                    >
                      <span>{v.label}</span>
                      <span>Soon</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Player card */}
          <div
            className="mt-3 rounded-3xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
                Player
              </div>
              {lastSpoken?.audioUrl && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  ● MP3
                </span>
              )}
            </div>
            <p className="mt-2 line-clamp-3 text-sm" style={{ color: "var(--muted)" }}>
              {lastSpoken?.text || text || "Generate speech to preview here."}
            </p>

            {lastSpoken?.audioUrl ? (
              /* Real generated audio — native player + MP3 download */
              <div className="mt-4 space-y-2">
                <audio controls preload="metadata" src={lastSpoken.audioUrl} className="h-10 w-full">
                  Your browser does not support audio playback.
                </audio>
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: "var(--soft)" }}>
                    {activeLabel} · {speed}× · real audio
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = lastSpoken.audioUrl!;
                      a.download = `buildwe-voice-${lastSpoken.voice}-${Date.now()}.mp3`;
                      a.click();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold"
                    style={{ borderColor: "var(--border)", color: "var(--accent)" }}
                  >
                    <Download className="h-3.5 w-3.5" /> MP3
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!(lastSpoken?.text || text).trim()}
                  className="flex h-12 w-12 items-center justify-center rounded-full text-white disabled:opacity-40"
                  style={{ background: "var(--ink)" }}
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="ml-0.5 h-5 w-5 fill-current" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="h-1.5 rounded-full" style={{ background: "var(--secondary)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: playing ? "66%" : "0%",
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <div className="mt-1 text-[10px]" style={{ color: "var(--soft)" }}>
                    {activeLabel} · {speed}× · device voice
                  </div>
                </div>
                <button
                  type="button"
                  onClick={downloadScript}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border"
                  style={{ borderColor: "var(--border)" }}
                  aria-label="Download script"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
