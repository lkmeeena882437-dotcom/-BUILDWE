"use client";

/**
 * The composer, extracted.
 *
 * It used to be ~210 lines of inline JSX inside app/page.tsx's return, which made every
 * later change to it (attachment menu, mode picker, workspace context) an edit to the
 * largest file in the repo. Same markup, same handlers, same limits — the page keeps
 * the state and the send/stop logic, this component owns presentation.
 *
 * What actually changed in Step 2 (beyond the move):
 *  - the field is a floating pill (`.bw-pill`): radius, one shadow at rest, a second
 *    shadow + accent border only while it has focus inside (`:focus-within`, so the
 *    ring follows the *field*, not just the textarea);
 *  - a leading `+` opens the attachment menu. It replaced the two loose icon buttons
 *    because they were the same two actions; the menu contains only what really works
 *    today (image → vision, text/CSV → the summarise path, clear) — the link and voice
 *    rows land in Step 4 when their backends are wired, never before;
 *  - Enter is IME-safe. It used to send on `keydown` even while a composition was open,
 *    which meant a half-typed Devanagari/Hinglish word went out as a message. That is a
 *    real bug for this product's users, not a polish item.
 */
import { useRef, useState } from "react";
import {
  AlertTriangle,
  Globe,
  ImagePlus,
  Layers,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  SlidersHorizontal,
  Square,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { Btn } from "@/lib/ui/Btn";
import { MenuDivider, MenuRow, Popover, menuTriggerProps } from "@/lib/ui";
import { analyzeFileApi, type MeResponse } from "@/lib/client/api";
import { MODE_META, type Mode } from "@/lib/client/modes";
import {
  speechRecognitionCtor,
  type SpeechRecognitionResultEvent,
} from "@/lib/client/speech";

export type AnswerDepth = "short" | "balanced" | "detailed" | "deep";
export type AnswerTone = "simple" | "standard" | "expert";
export type Attachment = { dataUrl: string; name: string } | null;

/** Kept in sync with the server's limits: the UI must refuse before a 413, not after. */
const MAX_TEXT_FILE = 200 * 1024;
const MAX_IMAGE_FILE = 5 * 1024 * 1024;

export interface PromptBarProps {
  mode: Mode;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  attachment: Attachment;
  setAttachment: React.Dispatch<React.SetStateAction<Attachment>>;
  error: string;
  setError: (v: string) => void;
  streaming: boolean;
  streamPhase: string;
  depth: AnswerDepth;
  setDepth: (d: AnswerDepth) => void;
  tone: AnswerTone;
  setTone: (t: AnswerTone) => void;
  webSearchOn: boolean;
  setWebSearchOn: React.Dispatch<React.SetStateAction<boolean>>;
  listening: boolean;
  setListening: (v: boolean) => void;
  imgLoading: boolean;
  audioBusy: boolean;
  visionBusy: boolean;
  plan: string;
  me: MeResponse | null;
  byokActive: boolean;
  /** The prompt the last successful run used, for "Try again" after a failure. */
  lastPromptText: string;
  taRef: React.RefObject<HTMLTextAreaElement>;
  fileRef: React.RefObject<HTMLInputElement>;
  imgAttachRef: React.RefObject<HTMLInputElement>;
  onSend: (override?: string) => void | Promise<void>;
  onGrow: () => void;
  onMode: (m: Mode) => void;
  /** Plain setter, for a side effect that must not abort a running stream. */
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  onCompare: () => void;
  onStop: () => void;
  onUpgrade: () => void;
}

function placeholderFor(mode: Mode): string {
  if (mode === "auto")
    return "What do you want to do? e.g. “plan my launch”, “build a quiz app”, “make a logo”";
  if (mode === "code") return "Describe what you want to build — BUILDWE handles the code";
  if (mode === "chat") return "Ask anything — plain language works best";
  return "Message BUILDWE";
}

export function PromptBar(props: PromptBarProps) {
  const {
    mode,
    input,
    setInput,
    attachment,
    setAttachment,
    error,
    setError,
    streaming,
    streamPhase,
    depth,
    setDepth,
    tone,
    setTone,
    webSearchOn,
    setWebSearchOn,
    listening,
    setListening,
    imgLoading,
    audioBusy,
    visionBusy,
    plan,
    me,
    byokActive,
    lastPromptText,
    taRef,
    fileRef,
    imgAttachRef,
    onSend,
    onGrow,
    onMode,
    setMode,
    onCompare,
    onStop,
    onUpgrade,
  } = props;

  const [attachOpen, setAttachOpen] = useState(false);
  const attachTrigger = useRef<HTMLDivElement | null>(null);
  const [styleMenu, setStyleMenu] = useState(false);
  const chatLike = mode === "chat" || mode === "auto";

  const onPickTextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_TEXT_FILE) {
      setError(`File too large — keep text files under ${MAX_TEXT_FILE / 1024} KB. Tip: attach just the part you need help with.`);
      return;
    }
    // Clearing `value` first matters twice: a re-picked identical file must still fire
    // change, and nothing here may look like it worked while the read is failing.
    let t = "";
    try {
      t = await f.text();
    } catch {
      setError(`Couldn't read "${f.name}" — it may have moved or been closed. Pick it again from its folder.`);
      return;
    }
    try {
      const a = await analyzeFileApi(f.name, t);
      setInput((v) => (v ? v + "\n\n" : "") + `[Attached file: ${f.name}]\n${a.summary}\n\nMy question: `);
    } catch {
      // The summariser is an optimisation, not a requirement: the raw slice still
      // arrives, and saying so in the text keeps it honest about what the model sees.
      setInput((v) => (v ? v + "\n\n" : "") + `[File: ${f.name}]\n${t.slice(0, 8000)}`);
    }
    requestAnimationFrame(onGrow);
  };

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_IMAGE_FILE) {
      setError("Image too large — keep it under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      // A FileReader failure is silent by default: the picker closes, nothing appears,
      // and the user assumes the app ignored their file.
      setError(`Couldn't read "${f.name}" as an image. Try a PNG or JPEG under 5 MB.`);
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError(`Couldn't read "${f.name}" as an image. Try a PNG or JPEG under 5 MB.`);
        return;
      }
      setAttachment({ dataUrl: reader.result, name: f.name });
      // A picture is a question about pixels, not a song or an image generation.
      retargetModeForImage();
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  // The old code used the functional updater so a mode that changed while the file was
  // being read is still respected; `setMode` keeps that, and deliberately does not go
  // through onMode (= page's switchMode), which aborts a running stream. Attaching a
  // picture must not cancel the answer being streamed.
  const retargetModeForImage = () => setMode((m) => (m === "image" || m === "audio" ? "chat" : m));

  const startMic = () => {
    const SR = speechRecognitionCtor();
    if (!SR) {
      alert("Use Chrome for voice input");
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.onresult = (ev: SpeechRecognitionResultEvent) => {
      let t = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setInput((v) => (v ? v + " " : "") + t);
      requestAnimationFrame(onGrow);
    };
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  };

  const busy = streaming || imgLoading || audioBusy || visionBusy;

  return (
    <div className="bw-dock sticky bottom-0 z-20 shrink-0 px-3 py-2.5 sm:px-5">
      <div className="mx-auto max-w-2xl">
        {error && (
          <div
            className="anim-rise mb-2 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ background: "var(--err-soft)", color: "var(--err)" }}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            {/limit|PRO/i.test(error) ? (
              <button type="button" className="font-semibold underline" onClick={onUpgrade}>
                Upgrade
              </button>
            ) : lastPromptText ? (
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  setError("");
                  void onSend(lastPromptText);
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        )}
        {streaming && (
          <div
            className="anim-rise mb-1.5 flex items-center gap-1.5 px-1 text-[11px]"
            style={{ color: "var(--muted)" }}
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--accent)" }} />
            {streamPhase || "Working…"}
            <span className="ml-1" style={{ color: "var(--soft)" }}>
              · you can stop anytime, the partial answer is saved
            </span>
          </div>
        )}

        <div className="bw-pill">
          {attachment && (
            <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border p-2" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachment.dataUrl} alt={attachment.name} className="h-12 w-12 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{attachment.name}</div>
                <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                  Image attached — ask anything about it
                </div>
              </div>
              <Btn variant="icon" size="sm" aria-label="Remove image" onClick={() => setAttachment(null)}>
                <XCircle className="h-4 w-4" />
              </Btn>
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            aria-label="Message BUILDWE"
            placeholder={placeholderFor(mode)}
            onChange={(e) => {
              setInput(e.target.value);
              onGrow();
            }}
            onKeyDown={(e) => {
              // `isComposing` is the IME saying "this Enter ended a word, it is not a
              // send". Without it, Hindi/Japanese input sends half a sentence.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void onSend();
              }
            }}
            className="bw-pill__input max-h-[96px] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] outline-none placeholder:opacity-45 md:max-h-[128px]"
          />
          <div className="flex items-center gap-0.5 px-2 pb-2">
            {/* leading: the one entry point for anything that gets attached */}
            <div ref={attachTrigger} className="relative mr-0.5 flex shrink-0 items-center">
              <Btn
                variant="icon"
                size="sm"
                aria-label="Attach"
                title="Attach — image, text file"
                onClick={() => setAttachOpen((v) => !v)}
                {...menuTriggerProps(attachOpen, "bw-attach-menu")}
                style={
                  attachOpen || attachment
                    ? { background: "var(--accent-soft)", color: "var(--accent)" }
                    : undefined
                }
              >
                <Plus className={clsx("h-4 w-4 transition-transform", attachOpen && "rotate-45")} />
              </Btn>
              <Popover
                id="bw-attach-menu"
                open={attachOpen}
                onClose={() => setAttachOpen(false)}
                anchorRef={attachTrigger}
                mode="absolute"
                placement="above"
                align="start"
                width={252}
                label="Attach"
              >
                <MenuRow
                  dataAction="attach-image"
                  icon={ImagePlus}
                  title="Upload image"
                  hint="Reads it with vision"
                  onClick={() => {
                    setAttachOpen(false);
                    imgAttachRef.current?.click();
                  }}
                />
                <MenuRow
                  dataAction="attach-file"
                  icon={Paperclip}
                  title="Attach text / CSV"
                  hint="Summarised, not pasted whole"
                  onClick={() => {
                    setAttachOpen(false);
                    fileRef.current?.click();
                  }}
                />
                <MenuDivider />
                <MenuRow
                  dataAction="clear-attachment"
                  icon={XCircle}
                  title="Clear attachment"
                  disabled={!attachment}
                  note="Nothing attached"
                  onClick={() => {
                    setAttachment(null);
                    setAttachOpen(false);
                  }}
                />
              </Popover>
            </div>

            <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
              {MODE_META.map((m) => {
                const Icon = m.icon;
                const on = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    title={`${m.label} — ${m.sub}`}
                    onClick={() => onMode(m.id)}
                    className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium"
                    style={on ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--muted)" }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* hidden, but rendered: the menu above drives exactly these two inputs */}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="text/*,.md,.json,.js,.ts,.tsx,.py,.css,.html,.csv"
              onChange={onPickTextFile}
            />
            <input
              ref={imgAttachRef}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPickImage}
            />

            <div className="flex shrink-0 items-center gap-0.5">
            {chatLike && (
              <div className="relative">
                <Btn
                  variant="icon"
                  size="sm"
                  aria-label="Answer style"
                  title="Answer style — length & language"
                  onClick={() => setStyleMenu((v) => !v)}
                  style={depth !== "balanced" || tone !== "standard" ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Btn>
                {styleMenu && (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 cursor-default"
                      aria-label="Close style menu"
                      onClick={() => setStyleMenu(false)}
                    />
                    <div
                      className="anim-rise absolute bottom-10 left-0 z-50 w-60 rounded-2xl border p-3 shadow-lg"
                      style={{ borderColor: "var(--border)", background: "var(--card)" }}
                    >
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
                        Answer length
                      </div>
                      <div className="mb-3 flex flex-wrap gap-1">
                        {(["short", "balanced", "detailed", "deep"] as const).map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDepth(d)}
                            className="rounded-full px-2 py-1 text-[11px] font-semibold capitalize"
                            style={depth === d ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
                        Language
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(["simple", "standard", "expert"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTone(t)}
                            className="rounded-full px-2 py-1 text-[11px] font-semibold capitalize"
                            style={tone === t ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {chatLike && (
              <Btn
                variant="icon"
                size="sm"
                aria-label="Web search"
                title="Web search — live sources"
                onClick={() => setWebSearchOn((v) => !v)}
                style={webSearchOn ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
              >
                <Globe className="h-4 w-4" />
              </Btn>
            )}
            {chatLike && (
              <Btn
                variant="icon"
                size="sm"
                aria-label="Compare models"
                title="Compare models — ask 3 AIs the same question"
                onClick={onCompare}
              >
                <Layers className="h-4 w-4" />
              </Btn>
            )}
            <Btn
              variant="icon"
              size="sm"
              aria-label="Mic"
              title="Dictate — voice input"
              onClick={startMic}
              style={listening ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Btn>
            {busy ? (
              <Btn variant="ink" className="bw-pill__send !h-10 !w-10 !p-0" aria-label="Stop" onClick={onStop}>
                <Square className="h-3.5 w-3.5 fill-current" />
              </Btn>
            ) : (
              <Btn
                className="bw-pill__send !h-10 !w-10 !p-0"
                aria-label="Send"
                disabled={!input.trim() && !attachment}
                onClick={() => void onSend()}
              >
                {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Btn>
            )}
            </div>
          </div>
        </div>

        <p className="mt-1.5 text-center text-[10px]" style={{ color: "var(--soft)" }}>
          BUILDWE picks the right tool — no commands or code needed, just type naturally
          {me?.kind === "guest" ? " · guest mode" : me?.user?.email ? ` · ${me.user.email}` : ""}
          {plan === "free" ? " · Free plan" : " · PRO"}
          {byokActive ? " · Own key ⚡" : ""}
        </p>
      </div>
    </div>
  );
}
