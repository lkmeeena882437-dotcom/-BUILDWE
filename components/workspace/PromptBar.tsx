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
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  AudioLines,
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
import { ModeMenu } from "./ModeMenu";
import {
  MenuDivider,
  MenuLabel,
  MenuRow,
  Popover,
  SegmentedControl,
  menuTriggerProps,
} from "@/lib/ui";
import type { SegmentedItem } from "@/lib/ui";
import { analyzeFileApi, transcribeAudio, type MeResponse } from "@/lib/client/api";
import { type Mode } from "@/lib/client/modes";
import {
  speechRecognitionCtor,
  type SpeechRecognitionResultEvent,
} from "@/lib/client/speech";

export type AnswerDepth = "short" | "balanced" | "detailed" | "deep";
/** The two style axes, as data: the labels below and `AnswerDepth` must not drift. */
export const DEPTH_ITEMS: SegmentedItem<AnswerDepth>[] = [
  { value: "short", label: "Short" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
  { value: "deep", label: "Deep" },
];
export type AnswerTone = "simple" | "standard" | "expert";
export const TONE_ITEMS: SegmentedItem<AnswerTone>[] = [
  { value: "simple", label: "Simple" },
  { value: "standard", label: "Standard" },
  { value: "expert", label: "Expert" },
];
export type Attachment = { dataUrl: string; name: string } | null;

/** Kept in sync with the server's limits: the UI must refuse before a 413, not after. */
const MAX_TEXT_FILE = 200 * 1024;
/** Five minutes, then the composer stops on its own. A recorder nobody stopped is
 *  a microphone left open and a Blob nobody asked for. */
const MAX_VOICE_SECONDS = 300;
const MAX_IMAGE_FILE = 5 * 1024 * 1024;
/** Trigger + panel share one id so `aria-controls` cannot drift from it. */
const STYLE_MENU_ID = "bw-style-menu";

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
  /**
   * The gateway's per-message ceiling, from GET /api/credits. Optional on purpose: the
   * hint appears once the number is known, and a second copy of 24000 in a component is
   * how a limit ends up disagreeing with the server that enforces it.
   */
  maxMessageChars?: number;
  taRef: React.RefObject<HTMLTextAreaElement>;
  fileRef: React.RefObject<HTMLInputElement>;
  imgAttachRef: React.RefObject<HTMLInputElement>;
  onSend: (override?: string) => void | Promise<void>;
  onGrow: () => void;
  onMode: (m: Mode) => void;
  /** Plain setter, for a side effect that must not abort a running stream. */
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  /**
   * Workspace context (UI step 9): the file the next answer is allowed to read, and the
   * one way to stop it. Optional — the tool pages and the landing prompt have no project
   * to attach, and a chip that lies about what will be sent is worse than no chip.
   */
  contextPath?: string | null;
  contextNote?: string;
  onClearContext?: () => void;
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
    contextPath,
    contextNote,
    onClearContext,
  maxMessageChars,
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
  const [dragOver, setDragOver] = useState(false);
  const styleTrigger = useRef<HTMLDivElement | null>(null);
  // The dictation mic (the button on the right) is the browser's own recogniser and
  // never leaves the machine. This is the other thing a chat composer is expected to
  // do: record, send it to the server's transcription, and put the words in the box.
  // One rule the browser enforces: getUserMedia is only allowed on https or localhost.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  // Availability is measured in an effect, not during render: the server would answer
  // `false` for every visitor and the client would answer `true`, which is a hydration
  // mismatch on a button's disabled attribute.
  const [canRecord, setCanRecord] = useState(true);
  const attachTrigger = useRef<HTMLDivElement | null>(null);
  const [styleMenu, setStyleMenu] = useState(false);
  const chatLike = mode === "chat" || mode === "auto";

  /**
   * The one place a text/CSV file becomes prompt content. The file input, a drop on the
   * pill and a paste all run through here, so a rule added once (size, the summarise
   * call, the fallback) applies to every way a file can arrive.
   */
  const attachTextFile = async (f: File) => {
    if (f.size > MAX_TEXT_FILE) {
      setError(`File too large — keep text files under ${MAX_TEXT_FILE / 1024} KB. Tip: attach just the part you need help with.`);
      return;
    }
    let t = "";
    try {
      t = await f.text();
    } catch {
      setError(`Couldn't read "${f.name}" — it may have moved or been closed. Pick it again from its folder.`);
      return;
    }
    if (!t.trim()) {
      setError(`"${f.name}" is empty.`);
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

  const attachImageFile = (f: File) => {
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
      // The old code used the functional updater so a mode that changed while the file
      // was being read is still respected; `setMode` keeps that, and deliberately does
      // not go through onMode (= page's switchMode), which aborts a running stream.
      // Attaching a picture must not cancel the answer being streamed.
      setMode((m) => (m === "image" || m === "audio" ? "chat" : m));
    };
    reader.readAsDataURL(f);
  };

  function fmtTime(total: number): string {
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function releaseMic() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function finishVoiceNote() {
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    chunksRef.current = [];
    if (!blob.size) {
      setError("Nothing was recorded — the microphone may have been muted.");
      return;
    }
    setTranscribing(true);
    try {
      // transcribeAudio() is the single owner of that request, including the 402
      // credit path, so a voice note cannot quietly become an unpriced call.
      const res = await transcribeAudio(blob, "composer-voice-note.webm");
      const text = String(res.text || "").trim();
      if (!text) {
        setError("The recording came back empty — no speech was detected.");
        return;
      }
      setInput((v) => (v ? v.replace(/\s*$/, " ") : "") + text + " ");
      requestAnimationFrame(onGrow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't transcribe that recording.");
    } finally {
      setTranscribing(false);
    }
  }

  function stopVoiceNote() {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop(); // its onstop releases the mic
    else releaseMic();
    setRecording(false);
  }

  function cancelVoiceNote() {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      rec.onstop = null; // the clip is thrown away, so nothing may be uploaded
      rec.stop();
    }
    chunksRef.current = [];
    releaseMic();
    setRecording(false);
  }

  async function startVoiceNote() {
    setAttachOpen(false);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        releaseMic();
        setRecording(false);
        void finishVoiceNote();
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setSeconds(0);
      tickRef.current = setInterval(() => {
        setSeconds((n) => {
          if (n + 1 >= MAX_VOICE_SECONDS) stopVoiceNote();
          return n + 1;
        });
      }, 1000);
    } catch {
      releaseMic();
      setError(
        "The microphone was blocked — allow it for this site, or type the message instead."
      );
    }
  }

  useEffect(() => {
    setCanRecord(
      typeof window !== "undefined" &&
        "MediaRecorder" in window &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
    // Navigating away with the mic open keeps the recording indicator lit in the tab
    // and keeps the stream alive; refs are the only way to reach it from an unmount.
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  /** What the picker fires; the value is cleared first so the same file re-fires change. */
  const onPickTextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await attachTextFile(f);
  };

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) attachImageFile(f);
  };

  /** Paste and drag-drop share the routing: an image becomes an attachment, a text-ish
   *  file becomes prompt content, anything else is refused with a reason. */
  const acceptDroppedFile = (f: File) => {
    if (f.type.startsWith("image/")) return attachImageFile(f);
    if (f.type.startsWith("text/") || /\.(md|json|js|ts|tsx|py|css|html|csv|txt)$/i.test(f.name)) return void attachTextFile(f);
    setError(`Can't attach "${f.name}" — an image, or text/CSV/JSON/code up to ${MAX_TEXT_FILE / 1024} KB.`);
  };

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
  // 75% in, the number appears; past the ceiling it turns into the reason the send
  // would be refused. Nothing is blocked here - the server is the authority, and chat
  // costs no credits, so a premature refusal would be the app inventing a rule.
  const over = maxMessageChars ? Math.max(0, input.length - maxMessageChars) : 0;
  const nearLimit = Boolean(maxMessageChars && input.length > maxMessageChars * 0.75);

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

        <div
          className={clsx("bw-pill relative", dragOver && "is-drop")}
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            // leaving a child bubbles up and would flicker the hint off mid-drag
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            const f = files[0];
            if (!f) return;
            e.preventDefault();
            setDragOver(false);
            // One file at a time is the rule the endpoints have; saying which one won is
            // cheaper than letting someone wonder where the other two went.
            if (files.length > 1) setError(`Using "${f.name}" — one file at a time.`);
            acceptDroppedFile(f);
          }}
        >
          {dragOver && (
            <div className="bw-pill__drop">
              <Paperclip className="h-4 w-4" />
              Drop an image, or text / CSV / JSON / code
            </div>
          )}
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
          {contextPath ? (
            <div
              className="mx-3 mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2"
              style={{ borderColor: "var(--border)", background: "var(--secondary)" }}
              data-promptbar="context"
            >
              {/* No icon: the @ is what the files tab uses to set this, and matching the
                  two is more useful than decoration. */}
              <span className="shrink-0 text-[13px] font-semibold leading-none" aria-hidden>
                @
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                <span style={{ color: "var(--muted)" }}>Context · </span>
                <span className="font-mono">{contextPath}</span>
              </span>
              {contextNote ? (
                <span className="hidden shrink-0 text-[10px] md:block" style={{ color: "var(--soft)" }}>
                  {contextNote}
                </span>
              ) : null}
              <Btn
                variant="icon"
                size="sm"
                aria-label="Stop reading that file for this chat"
                onClick={() => onClearContext?.()}
              >
                <XCircle className="h-4 w-4" />
              </Btn>
            </div>
          ) : null}
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            // The page's `/` shortcut finds the composer through this, rather than querying a
            // translation of its label and breaking the first time the placeholder is reworded.
            data-composer
            aria-label="Message BUILDWE"
            onPaste={(e) => {
              // Only intercept a clipboard that actually carries an image; plain text
              // must paste exactly as the browser would have done it.
              const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith("image/"));
              if (!f) return;
              e.preventDefault();
              attachImageFile(f);
            }}
            placeholder={placeholderFor(mode)}
            onChange={(e) => {
              setInput(e.target.value);
              onGrow();
            }}
            onKeyDown={(e) => {
              // `isComposing` is the IME saying "this Enter ended a word, it is not a
              // send". Without it, Hindi/Japanese input sends half a sentence.
              if (e.nativeEvent.isComposing) return;
              const cmd = e.metaKey || e.ctrlKey;
              if (e.key === "Enter" && (!e.shiftKey || cmd)) {
                e.preventDefault();
                void onSend();
              }
            }}
            className="bw-pill__input max-h-[96px] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] outline-none placeholder:opacity-45 md:max-h-[128px]"
          />
          {(recording || transcribing) && (
            <div className="bw-pill__voice" role="status">
              {transcribing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Transcribing…
                </>
              ) : (
                <>
                  <span className="bw-pill__rec" aria-hidden />
                  <span className="tabular-nums">
                    {fmtTime(seconds)} / {fmtTime(MAX_VOICE_SECONDS)} — recording
                  </span>
                  <button type="button" className="bw-pill__voicebtn" onClick={stopVoiceNote}>
                    <Square className="h-3 w-3" aria-hidden /> Stop
                  </button>
                  <button type="button" className="bw-pill__voicebtn" onClick={cancelVoiceNote}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
          {nearLimit && (
            <p className={clsx("bw-pill__count", over ? "is-over" : "is-near")} role="status">
              {input.length.toLocaleString()} / {maxMessageChars?.toLocaleString()} characters
              {over ? ` — ${over.toLocaleString()} over the limit; trim it or attach it as a file` : ""}
            </p>
          )}
          <div className="flex items-center gap-0.5 px-2 pb-2">
            {/* leading: the one entry point for anything that gets attached */}
            <div ref={attachTrigger} className="relative mr-0.5 flex shrink-0 items-center">
              <Btn
                variant="icon"
                size="sm"
                aria-label="Attach"
                title="Attach — image, text file, voice note"
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
                  right={attachment ? attachment.name : undefined}
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
                  dataAction="voice-note"
                  icon={AudioLines}
                  title={recording ? "Stop and transcribe" : "Record a voice note"}
                  hint={
                    recording
                      ? `${fmtTime(seconds)} recorded — 1 credit`
                      : "Speech to text on the server, 1 credit"
                  }
                  disabled={!recording && (!canRecord || transcribing)}
                  note={
                    !canRecord
                      ? "This browser has no MediaRecorder"
                      : transcribing
                        ? "The last clip is still transcribing"
                        : undefined
                  }
                  onClick={() => (recording ? stopVoiceNote() : void startVoiceNote())}
                />
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

            {/* One control for five modes: components/workspace/ModeMenu.tsx owns the
                list, the popover, and the rule that re-picking the current mode must not
                abort the answer that is streaming. */}
            <ModeMenu mode={mode} onPick={onMode} className="mr-1" />

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
              <div ref={styleTrigger} className="relative">
                <Btn
                  variant="icon"
                  size="sm"
                  aria-label="Answer style"
                  title="Answer style — length & language"
                  onClick={() => setStyleMenu((v) => !v)}
                  {...menuTriggerProps(styleMenu, STYLE_MENU_ID)}
                  style={
                    depth === "balanced" && tone === "standard"
                      ? undefined
                      : { background: "var(--accent-soft)", color: "var(--accent)" }
                  }
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Btn>
                {/* The trigger sits at the right end of the pill, so the panel has to grow
                    leftwards or a 300px popover runs off a phone: `align="end"` is the
                    anchor's job, not a magic negative offset at the call site. */}
                <Popover
                  id={STYLE_MENU_ID}
                  open={styleMenu}
                  onClose={() => setStyleMenu(false)}
                  anchorRef={styleTrigger}
                  mode="absolute"
                  placement="above"
                  align="end"
                  width={300}
                  role="group"
                  label="Answer style"
                >
                  {/* Two segmented controls, not two rows of unlabelled chips. The chips
                      this replaces had no accessible selected state at all — a screen
                      reader heard seven identical buttons — and the panel was a
                      full-screen invisible <button> plus a hand-placed div, which meant the
                      first tap on any neighbour was eaten by the overlay. */}
                  <div className="bw-pop__stack">
                    <MenuLabel>Answer length</MenuLabel>
                    <SegmentedControl
                      size="sm"
                      full
                      dark
                      ariaLabel="Answer length"
                      value={depth}
                      onChange={setDepth}
                      items={DEPTH_ITEMS}
                    />
                    <MenuLabel>Language</MenuLabel>
                    <SegmentedControl
                      size="sm"
                      full
                      dark
                      ariaLabel="Language level"
                      value={tone}
                      onChange={setTone}
                      items={TONE_ITEMS}
                    />
                  </div>
                </Popover>
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
                title="Compare models — pick 2–6, get one combined answer"
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
                title={over ? `Over the message limit by ${over.toLocaleString()} characters` : "Send (Enter)"}
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
