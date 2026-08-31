"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { PromptBar } from "@/components/workspace/PromptBar";
import type { Mode as ModeId } from "@/lib/client/modes";

/** The lab's mount of the real composer. Kept in its own file so the lab can load it
 * as a separate chunk — see the comment at the dynamic() call in Lab.tsx. */
type Log = (msg: string) => void;
const card =
  "rounded-[var(--radius)] border p-4 " ;
const cardStyle = { borderColor: "var(--border)", background: "var(--card)" } as const;

/**
 * Card 0 — the real composer, mounted inert.
 *
 * app/page.tsx only renders the pill once the workspace has auth state, so nothing
 * server-rendered proves it exists. Mounting it here means `next build` and
 * `tests/ui.mjs` both exercise the actual component — crash-free render, the pill
 * classes, the ARIA on its menu trigger, the disabled send — and the toggles below let
 * the interaction be clicked without a backend. Same component the app imports: a copy
 * of its markup here would prove nothing.
 */
export function PromptBarDemo({ log }: { log: Log }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ModeId>("auto");
  const [attachment, setAttachment] = useState<{ dataUrl: string; name: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const noop = () => {};

  return (
    <section className={clsx(card, "rounded-[var(--radius)] border p-4")} style={cardStyle}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>
        0 · The composer pill itself (real component, inert wiring)
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>
        Type and watch the field grow. Enter with a Hindi/Devanagari IME mid-word must NOT send —
        that is the bug Step 2 fixes. Toggle the attachment to see the chip and the menu&apos;s
        now-enabled &quot;Clear attachment&quot; row.
      </p>
      <div className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
        <PromptBar
          mode={mode}
          input={input}
          setInput={setInput}
          attachment={attachment}
          setAttachment={setAttachment}
          error=""
          setError={noop}
          streaming={false}
          streamPhase=""
          depth="balanced"
          setDepth={noop}
          tone="standard"
          setTone={noop}
          webSearchOn={false}
          setWebSearchOn={noop}
          listening={false}
          setListening={noop}
          imgLoading={false}
          audioBusy={false}
          visionBusy={false}
          plan="free"
          me={null}
          byokActive={false}
          lastPromptText=""
          taRef={taRef}
          fileRef={fileRef}
          imgAttachRef={imgRef}
          onSend={(t) => log(`send(${JSON.stringify(t ?? input)}) — inert, nothing posted`)}
          onGrow={noop}
          onMode={(m) => {
            setMode(m);
            log(`mode → ${m}`);
          }}
          setMode={setMode}
          onCompare={() => log("compare — inert here; the real one opens the panel")}
          onStop={() => log("stop")}
          onUpgrade={() => log("upgrade — the real one opens the plans sheet")}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="h-8 rounded-xl border px-2.5 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", background: "transparent", color: "var(--muted)" }}
          onClick={() =>
            setAttachment(
              attachment
                ? null
                : { dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", name: "sample.png" }
            )
          }
        >
          {attachment ? "remove attachment" : "attach an image"}
        </button>
        <button
          type="button"
          className="h-8 rounded-xl border px-2.5 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", background: "transparent", color: "var(--muted)" }}
          onClick={() => setInput("plan my launch in 3 days")}
        >
          fill text
        </button>
      </div>
    </section>
  );
}
