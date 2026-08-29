"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  MessageSquare,
  Code2,
  Image as ImageIcon,
  Mic2,
  Send,
  Square,
  Copy,
  Check,
  Plus,
  Search,
  Trash2,
  Settings,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Menu,
  Zap,
  Paperclip,
  Mic,
  MicOff,
  LogOut,
  LogIn,
  CreditCard,
  Sun,
  Moon,
  Monitor,
  Star,
  PanelLeftClose,
  PanelLeft,
  Bot,
  Shield,
  ExternalLink,
  ArrowRight,
  FileCode2,
  Loader2,
  RotateCcw,
  SquarePen,
} from "lucide-react";
import clsx from "clsx";
import {
  detectAuto,
  deleteHistory,
  fetchHistory,
  fetchMe,
  generateAudio,
  generateImage,
  loadConversation,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  streamAI,
  type MeResponse,
} from "@/lib/client/api";

type Mode = "auto" | "chat" | "code" | "image" | "audio";
type ThemePref = "system" | "light" | "dark";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

type HistItem = {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
  preview: string;
};

const MODE_META: {
  id: Mode;
  label: string;
  icon: React.ElementType;
  headline: string;
  sub: string;
  power: string;
}[] = [
  {
    id: "auto",
    label: "Auto",
    icon: Bot,
    headline: "Ask once. BUILDWE routes it.",
    sub: "One box for thinking, building, visuals, and voice.",
    power: "Smart routing",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    headline: "Clarity under pressure.",
    sub: "Decide faster. Write sharper. Learn without noise.",
    power: "BUILDWE AI",
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
    headline: "From brief to working build.",
    sub: "Scaffold, fix, and ship — without leaving the workspace.",
    power: "BUILDWE Code",
  },
  {
    id: "image",
    label: "Image",
    icon: ImageIcon,
    headline: "Describe it. See it.",
    sub: "Brand frames, product shots, and scenes on demand.",
    power: "BUILDWE Vision",
  },
  {
    id: "audio",
    label: "Audio",
    icon: Mic2,
    headline: "Script in. Voice out.",
    sub: "Natural speech for briefs, stories, and product copy.",
    power: "BUILDWE Voice",
  },
];

const SUGGEST: Record<Mode, string[]> = {
  auto: [
    "Build a cream landing page for my SaaS",
    "Explain transformers simply",
    "Image: cozy studio desk, soft light",
    "Speak: Welcome to BUILDWE.ONLINE",
  ],
  chat: [
    "Brainstorm 5 creator startup ideas",
    "Rewrite this colder and clearer",
    "Study plan for learning TypeScript",
  ],
  code: [
    "React todo with localStorage",
    "Next.js API rate limiter",
    "Quiz game in plain HTML/JS",
  ],
  image: [
    "Minimal AI logo, terracotta on cream",
    "Product shot ceramic mug morning light",
    "Abstract mesh gradient poster 16:9",
  ],
  audio: [
    "Welcome to BUILDWE — build anything.",
    "Your daily brief: three priorities.",
  ],
};

const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

const VOICES = [
  { id: "nova", label: "Nova", lang: "EN-US", tone: "Warm" },
  { id: "atlas", label: "Atlas", lang: "EN-US", tone: "Deep" },
  { id: "luna", label: "Luna", lang: "EN-UK", tone: "Soft" },
  { id: "ember", label: "Ember", lang: "EN-US", tone: "Bright" },
  { id: "river", label: "River", lang: "EN-AU", tone: "Clear" },
  { id: "aanya", label: "Aanya", lang: "HI", tone: "Warm" },
  { id: "arjun", label: "Arjun", lang: "HI", tone: "Steady" },
  { id: "kiara", label: "Kiara", lang: "HI", tone: "Bright" },
  { id: "vihaan", label: "Vihaan", lang: "HI", tone: "Deep" },
  { id: "meera", label: "Meera", lang: "IN-EN", tone: "Soft" },
  { id: "kabir", label: "Kabir", lang: "IN-EN", tone: "Clear" },
  { id: "saanvi", label: "Saanvi", lang: "HI", tone: "Gentle" },
  { id: "ananya", label: "Ananya", lang: "BN", tone: "Warm" },
  { id: "dev", label: "Dev", lang: "TA", tone: "Clear" },
  { id: "isha", label: "Isha", lang: "TE", tone: "Soft" },
  { id: "sofia", label: "Sofia", lang: "ES", tone: "Bright" },
  { id: "luca", label: "Luca", lang: "IT", tone: "Warm" },
  { id: "amira", label: "Amira", lang: "AR", tone: "Clear" },
  { id: "yuki", label: "Yuki", lang: "JP", tone: "Soft" },
  { id: "chen", label: "Chen", lang: "ZH", tone: "Steady" },
];

function rid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function md(text: string) {
  let h = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  h = h.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre data-lang="${lang || ""}"><code>${code.replace(/\n$/, "")}</code></pre>`;
  });
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>");
  h = h.replace(/(<li>[\s\S]*?<\/li>)(?:\n<li>[\s\S]*?<\/li>)*/g, (m) => `<ul>${m}</ul>`);
  return h
    .split(/\n{2,}/)
    .map((b) =>
      b.startsWith("<pre") || b.startsWith("<ul")
        ? b
        : `<p>${b.replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

function extractCode(text: string) {
  const blocks: { lang: string; code: string }[] = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    blocks.push({ lang: m[1] || "txt", code: m[2].replace(/\n$/, "") });
  }
  return blocks;
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  size = "md",
  className,
  type = "button",
  "aria-label": al,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "ink" | "icon" | "soft";
  size?: "sm" | "md" | "lg";
  className?: string;
  type?: "button" | "submit";
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={al}
      title={al}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "rounded-2xl text-white shadow-sm",
        variant === "ghost" && "rounded-2xl border",
        variant === "ink" && "rounded-2xl",
        variant === "soft" && "rounded-2xl",
        variant === "icon" && "rounded-xl",
        size === "sm" && variant !== "icon" && "h-9 px-3.5 text-sm",
        size === "md" && variant !== "icon" && "h-10 px-4 text-sm",
        size === "lg" && variant !== "icon" && "h-12 px-5 text-[15px]",
        variant === "icon" && (size === "sm" ? "h-8 w-8" : "h-10 w-10"),
        className
      )}
      style={
        variant === "primary"
          ? { background: "var(--accent)" }
          : variant === "ink"
            ? { background: "var(--ink)", color: "var(--bg)" }
            : variant === "soft"
              ? { background: "var(--accent-soft)", color: "var(--accent)" }
              : variant === "ghost"
                ? {
                    borderColor: "var(--border)",
                    background: "var(--card)",
                    color: "var(--ink)",
                  }
                : { color: "var(--muted)" }
      }
    >
      {children}
    </button>
  );
}

function Sheet({
  children,
  onClose,
  title,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title?: string;
  wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.classList.add("lock-scroll");
    return () => {
      window.removeEventListener("keydown", k);
      document.body.classList.remove("lock-scroll");
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/35" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className={clsx(
          "relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border p-5 shadow-2xl sm:rounded-3xl",
          wide ? "max-w-lg" : "max-w-md"
        )}
        style={{
          borderColor: "var(--border)",
          background: "var(--card)",
          color: "var(--ink)",
          paddingBottom: "calc(18px + var(--safe-b))",
        }}
      >
        <div className="mb-3 flex justify-center sm:hidden">
          <span className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} />
        </div>
        {title && (
          <div className="mb-4 flex items-center gap-2">
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: "var(--muted)" }} aria-label="Back">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="flex-1 text-base font-semibold tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: "var(--muted)" }} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function Dashboard() {
  const [view, setView] = useState<"home" | "app">("home");
  const [mode, setMode] = useState<Mode>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState<
    null | "auth" | "settings" | "plans" | "profile"
  >(null);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [dark, setDark] = useState(false);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [search, setSearch] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [modelTag, setModelTag] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // code panel
  const [codePanel, setCodePanel] = useState("// generated code lands here\n");
  const [codeLang, setCodeLang] = useState("txt");

  // image
  const [aspect, setAspect] = useState("1:1");
  const [images, setImages] = useState<{ id: string; url: string; prompt: string }[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [activeImg, setActiveImg] = useState<string | null>(null);

  // audio
  const [voice, setVoice] = useState("nova");
  const [showVoices, setShowVoices] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [audioBusy, setAudioBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // auth form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = MODE_META.find((m) => m.id === mode)!;
  const plan = me?.plan || "free";
  const loggedIn = me?.kind === "user";

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter(
      (h) => !q || h.title.toLowerCase().includes(q) || h.preview.toLowerCase().includes(q)
    );
  }, [history, search]);

  /* theme */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const isDark = themePref === "dark" || (themePref === "system" && mq.matches);
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [themePref]);

  const refreshMe = useCallback(async () => {
    try {
      const m = await fetchMe();
      setMe(m);
    } catch {
      /* */
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await fetchHistory();
      setHistory(
        h.conversations.map((c) => ({
          id: c.id,
          title: c.title,
          mode: c.mode,
          updatedAt: c.updatedAt,
          preview: c.preview,
        }))
      );
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    refreshMe();
    refreshHistory();
  }, [refreshMe, refreshHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = window.innerWidth < 768 ? 96 : 128;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  };

  useEffect(() => {
    if (taRef.current) taRef.current.style.height = "48px";
    grow();
  }, [mode]);

  const switchMode = (m: Mode) => {
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
    }
    setMode(m);
    setDrawer(false);
    setError("");
    if (m !== "audio") setShowVoices(false);
  };

  const newChat = () => {
    setConvId(null);
    setMessages([]);
    setInput("");
    setCodePanel("// generated code lands here\n");
    setModelTag("");
    setView("app");
    setMode("chat");
    setDrawer(false);
  };

  const openHist = async (id: string) => {
    try {
      const c = await loadConversation(id);
      setConvId(c.id);
      setMessages(
        (c.messages || [])
          .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
          .map((m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
      );
      setMode((c.mode as Mode) || "chat");
      setView("app");
      setDrawer(false);
      const last = [...(c.messages || [])].reverse().find((m: { role: string }) => m.role === "assistant");
      if (last) {
        const blocks = extractCode(last.content);
        if (blocks.length) {
          setCodePanel(blocks[blocks.length - 1].code);
          setCodeLang(blocks[blocks.length - 1].lang);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  };

  const speakBrowser = (text: string, vId: string, spd: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      throw new Error("Speech synthesis not supported in this browser");
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = spd;
    const voices = window.speechSynthesis.getVoices();
    const pref = VOICES.find((x) => x.id === vId);
    const match =
      voices.find((v) =>
        pref?.lang === "HI"
          ? /hi|hindi/i.test(v.lang + v.name)
          : pref?.lang.startsWith("EN")
            ? /en/i.test(v.lang)
            : v.lang.toLowerCase().includes((pref?.lang || "en").toLowerCase().slice(0, 2))
      ) || voices[0];
    if (match) u.voice = match;
    utterRef.current = u;
    window.speechSynthesis.speak(u);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    setError("");
    setView("app");
    setInput("");
    if (taRef.current) taRef.current.style.height = "48px";

    let resolved: Mode = mode;
    if (mode === "auto") {
      try {
        const d = await detectAuto(text);
        resolved = (d.mode as Mode) || "chat";
        setMode(resolved === "auto" ? "chat" : resolved);
      } catch {
        resolved = "chat";
      }
    }

    if (resolved === "image") {
      setImgLoading(true);
      const userMsg: Msg = { id: rid(), role: "user", content: text };
      setMessages((m) => [...m, userMsg]);
      try {
        const img = await generateImage(text, aspect);
        setImages((p) => [{ id: img.id, url: img.url, prompt: text }, ...p]);
        setActiveImg(img.id);
        setMessages((m) => [
          ...m,
          {
            id: rid(),
            role: "assistant",
            content: `**Ready.** Your image is in the preview.\n\n> ${text}`,
          },
        ]);
        setModelTag("BUILDWE Vision");
        refreshMe();
        refreshHistory();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setImgLoading(false);
      }
      return;
    }

    if (resolved === "audio") {
      setAudioBusy(true);
      const userMsg: Msg = { id: rid(), role: "user", content: text };
      setMessages((m) => [...m, userMsg]);
      try {
        const a = await generateAudio(text, voice, speed);
        speakBrowser(a.text, a.voice, a.speed);
        setMessages((m) => [
          ...m,
          {
            id: rid(),
            role: "assistant",
            content: `**Playing** · voice **${VOICES.find((v) => v.id === voice)?.label || voice}**\n\n${a.text}`,
          },
        ]);
        setModelTag("BUILDWE Voice");
        refreshMe();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAudioBusy(false);
      }
      return;
    }

    // chat or code stream
    const endpoint = resolved === "code" ? "/api/ai/code" : "/api/ai/chat";
    const userMsg: Msg = { id: rid(), role: "user", content: text };
    const aId = rid();
    const nextMessages = [
      ...messages,
      userMsg,
      { id: aId, role: "assistant" as const, content: "", streaming: true },
    ];
    setMessages(nextMessages);
    setStreaming(true);

    const apiMessages = nextMessages
      .filter((m) => m.id !== aId)
      .concat()
      .map((m) => ({ role: m.role, content: m.content }));
    // include current user
    if (!apiMessages.some((m) => m.content === text && m.role === "user")) {
      apiMessages.push({ role: "user", content: text });
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let acc = "";
      await streamAI(
        endpoint,
        {
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: text },
          ],
          conversationId: convId,
        },
        (ev) => {
          if (ev.meta && typeof ev.meta === "object") {
            const meta = ev.meta as { conversationId?: string; model?: string; live?: boolean };
            if (meta.conversationId) setConvId(meta.conversationId);
            if (meta.model) setModelTag(meta.model);
          }
          if (ev.token) {
            acc += ev.token;
            setMessages((ms) =>
              ms.map((m) =>
                m.id === aId ? { ...m, content: acc, streaming: true } : m
              )
            );
            if (resolved === "code") {
              const blocks = extractCode(acc);
              if (blocks.length) {
                setCodePanel(blocks[blocks.length - 1].code);
                setCodeLang(blocks[blocks.length - 1].lang);
              }
            }
          }
          if (ev.error) setError(ev.error);
          if (ev.done) {
            setMessages((ms) =>
              ms.map((m) => (m.id === aId ? { ...m, streaming: false } : m))
            );
          }
        },
        ctrl.signal
      );
      refreshMe();
      refreshHistory();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        setMessages((ms) =>
          ms.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  content: m.content || "Something went wrong. Try again.",
                  streaming: false,
                }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const onAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr("");
    setAuthBusy(true);
    try {
      if (authTab === "login") await apiLogin(email, password);
      else await apiRegister(email, password, name || undefined);
      await refreshMe();
      await refreshHistory();
      setModal(null);
      setPassword("");
    } catch (err) {
      setAuthErr((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const doLogout = async () => {
    await apiLogout();
    await refreshMe();
    setModal(null);
  };

  const copy = async (t: string, id: string) => {
    await navigator.clipboard.writeText(t);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };

  /* ── Landing ───────────────────────────────────────────── */
  if (view === "home") {
    return (
      <div className="mesh-bg min-h-[100dvh]" style={{ color: "var(--ink)" }}>
        <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-2xl text-sm font-bold"
              style={{ background: "var(--ink)", color: "var(--bg)" }}
            >
              B
            </span>
            <div>
              <div className="text-sm font-semibold tracking-tight">BUILDWE</div>
              <div className="text-[10px]" style={{ color: "var(--soft)" }}>
                buildwe.online
              </div>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm md:flex" style={{ color: "var(--muted)" }}>
            <Link href="/about" className="hover:opacity-80">About</Link>
            <Link href="/pricing" className="hover:opacity-80">Pricing</Link>
            <Link href="/privacy" className="hover:opacity-80">Privacy</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setAuthTab("login"); setModal("auth"); }}>
              Log in
            </Btn>
            <Btn size="sm" onClick={() => setView("app")}>
              Enter app <ArrowRight className="h-3.5 w-3.5" />
            </Btn>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-16">
          <div className="anim-fade-up mx-auto max-w-3xl text-center">
            <div
              className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--accent)" }}
            >
              <Sparkles className="h-3.5 w-3.5" /> Free for everyone · Ad-supported
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl sm:leading-[1.05]">
              Four AI problems.
              <br />
              <span style={{ color: "var(--accent)" }}>One platform.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg" style={{ color: "var(--muted)" }}>
              Chat. Code. Image. Audio. BUILDWE is the free workspace that keeps creation in one place — so more people can build, and the platform grows with you.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Btn size="lg" onClick={() => setView("app")}>
                Enter BUILDWE <ArrowRight className="h-4 w-4" />
              </Btn>
              <Btn variant="ghost" size="lg" onClick={() => setModal("plans")}>
                Free &amp; PRO
              </Btn>
            </div>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MODE_META.filter((m) => m.id !== "auto").map((m, i) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMode(m.id);
                    setView("app");
                  }}
                  className="anim-fade-up rounded-3xl border p-5 text-left transition hover:-translate-y-0.5"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--card)",
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  <div
                    className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold">{m.label}</div>
                  <div className="mt-1 text-[15px] font-medium tracking-tight">{m.headline}</div>
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                    {m.sub}
                  </p>
                  <div
                    className="mt-4 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: "var(--secondary)", color: "var(--soft)" }}
                  >
                    {m.power}
                  </div>
                </button>
              );
            })}
          </div>

          <div
            className="mt-14 rounded-3xl border p-6 sm:p-10"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Built as a platform — not a pitch deck.</h2>
                <ul className="mt-4 space-y-3 text-sm" style={{ color: "var(--muted)" }}>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} /> Free for every new user — growth first, ads-supported</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} /> Four tools, one session: stop hopping between AI tabs</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} /> PRO = higher limits + calmer experience when you need volume</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} /> Mobile-first workspace that feels like a product, not a form</li>
                </ul>
              </div>
              <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>Inside the workspace</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["Auto route", "Streaming chat", "Code canvas", "Vision", "Voice", "History", "Guest mode"].map((label) => (
                    <span key={label} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: "var(--border)", background: "var(--card)" }}>{label}</span>
                  ))}
                </div>
                <Link href="/about" className="mt-4 inline-flex items-center gap-1 text-sm font-medium" style={{ color: "var(--accent)" }}>
                  How BUILDWE works <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </main>

        {modal === "auth" && (
          <AuthSheet
            tab={authTab}
            setTab={setAuthTab}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            name={name}
            setName={setName}
            err={authErr}
            busy={authBusy}
            onSubmit={onAuth}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "plans" && (
          <PlansSheet plan={plan} onClose={() => setModal(null)} onPro={() => setModal("auth")} />
        )}
      </div>
    );
  }

  /* ── App shell ─────────────────────────────────────────── */
  return (
    <div className="flex h-[100dvh] overflow-hidden" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      {/* Sidebar */}
      <aside
        className={clsx(
          "relative z-20 hidden shrink-0 flex-col border-r transition-[width] duration-200 lg:flex",
          sidebarOpen ? "w-[260px]" : "w-[72px]"
        )}
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
      >
        <div className="flex h-14 items-center gap-2.5 border-b px-3" style={{ borderColor: "var(--border)" }}>
          <button type="button" onClick={() => setView("home")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-bold" style={{ background: "var(--ink)", color: "var(--bg)" }}>B</button>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">BUILDWE</div>
              <a href="/about" className="text-[10px] hover:underline" style={{ color: "var(--soft)" }}>Platform</a>
            </div>
          )}
        </div>

        <div className="p-2.5">
          <button
            type="button"
            onClick={newChat}
            className={clsx("flex w-full items-center gap-2 rounded-2xl border py-2.5 text-sm font-medium", sidebarOpen ? "px-3" : "justify-center")}
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <Plus className="h-4 w-4" style={{ color: "var(--accent)" }} />
            {sidebarOpen && "New chat"}
          </button>
        </div>

        <nav className="space-y-0.5 px-2.5 pb-2">
          {MODE_META.map((m) => {
            const Icon = m.icon;
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => switchMode(m.id)}
                className={clsx("flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm font-medium", sidebarOpen ? "px-3" : "justify-center")}
                style={on ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--muted)" }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {sidebarOpen && m.label}
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col border-t" style={{ borderColor: "var(--border)" }}>
          {sidebarOpen && (
            <>
              <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>History</div>
              <div className="px-2.5 pb-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--soft)" }} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-9 w-full rounded-xl pl-8 pr-2 text-xs outline-none" style={{ background: "var(--secondary)" }} />
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                {filteredHistory.map((h) => (
                  <div key={h.id} className="group flex items-center rounded-xl" style={h.id === convId ? { background: "var(--secondary)" } : undefined}>
                    <button type="button" onClick={() => openHist(h.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                      <div className="truncate text-[13px] font-medium">{h.title}</div>
                      <div className="truncate text-[10px]" style={{ color: "var(--soft)" }}>{h.mode} · {h.preview}</div>
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="mr-1 hidden h-7 w-7 items-center justify-center rounded-lg group-hover:flex"
                      style={{ color: "var(--soft)" }}
                      onClick={async () => {
                        await deleteHistory(h.id);
                        if (convId === h.id) newChat();
                        refreshHistory();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {!filteredHistory.length && (
                  <p className="px-2 py-8 text-center text-[11px]" style={{ color: "var(--soft)" }}>No history yet</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-1 border-t p-2.5" style={{ borderColor: "var(--border)" }}>
          <button type="button" onClick={() => setModal("settings")} className={clsx("flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm", sidebarOpen ? "px-3" : "justify-center")} style={{ color: "var(--muted)" }}>
            <Settings className="h-4 w-4" />
            {sidebarOpen && "Settings"}
          </button>
          {loggedIn ? (
            <button type="button" onClick={() => setModal("profile")} className={clsx("flex w-full items-center gap-2.5 rounded-2xl py-2 text-sm", sidebarOpen ? "px-3" : "justify-center")}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                {(me?.name || "U").slice(0, 1).toUpperCase()}
              </span>
              {sidebarOpen && (
                <span className="min-w-0 text-left">
                  <span className="block truncate text-[12px] font-medium">{me?.name}</span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>{plan === "pro" ? "PRO" : "Free"}</span>
                </span>
              )}
            </button>
          ) : (
            <button type="button" onClick={() => { setAuthTab("login"); setModal("auth"); }} className={clsx("flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm font-medium", sidebarOpen ? "px-3" : "justify-center")} style={{ background: "var(--ink)", color: "var(--bg)" }}>
              <LogIn className="h-4 w-4" />
              {sidebarOpen && "Log in"}
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}>
          <Btn variant="icon" className="lg:hidden" aria-label="Menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Btn>
          <Btn variant="icon" className="hidden lg:inline-flex" aria-label="Sidebar" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? <PanelLeftClose className="h-[18px] w-[18px]" /> : <PanelLeft className="h-[18px] w-[18px]" />}
          </Btn>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">{meta.label}</div>
            <div className="hidden truncate text-[11px] sm:block" style={{ color: "var(--muted)" }}>{meta.headline}{modelTag ? ` · ${modelTag}` : ""}</div>
          </div>
          {plan === "pro" ? (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--ink)", color: "var(--bg)" }}><Star className="h-3 w-3" /> PRO</span>
          ) : (
            <Btn size="sm" variant="soft" onClick={() => setModal("plans")}><Zap className="h-3.5 w-3.5" /> PRO</Btn>
          )}
        </header>

        {plan === "free" && (
          <div
            className="flex shrink-0 items-center justify-center gap-2 border-b px-3 py-1.5 text-[11px]"
            style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--muted)" }}
          >
            <span>Free platform · ad-supported</span>
            <span style={{ color: "var(--soft)" }}>·</span>
            <button type="button" className="font-semibold" style={{ color: "var(--accent)" }} onClick={() => setModal("plans")}>
              Go PRO — quieter workspace
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col pb-mobile-nav md:pb-0">
          <div className={clsx("flex min-h-0 flex-1", mode === "code" ? "flex-col lg:flex-row" : "flex-col")}>
            {/* messages */}
            <div className={clsx("flex min-h-0 flex-col", mode === "code" ? "lg:w-[46%] lg:border-r" : "flex-1")} style={{ borderColor: "var(--border)" }}>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="mx-auto flex min-h-full max-w-2xl flex-col px-3 py-5 sm:px-5">
                  {!messages.length && (
                    <div className="anim-fade-up flex flex-1 flex-col items-center justify-center py-10 text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--border)" }}>
                        <meta.icon className="h-6 w-6" style={{ color: "var(--accent)" }} />
                      </div>
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{meta.headline}</h1>
                      <p className="mt-2 max-w-md text-sm" style={{ color: "var(--muted)" }}>{meta.sub}</p>
                      <div
                        className="mt-3 rounded-full px-3 py-1 text-[11px] font-semibold"
                        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                      >
                        Free on BUILDWE
                      </div>
                      <div className="mt-8 grid w-full max-w-md gap-2">
                        {SUGGEST[mode].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => send(s)}
                            className="rounded-2xl border px-4 py-3 text-left text-sm transition hover:border-[var(--accent)]"
                            style={{ borderColor: "var(--border)", background: "var(--card)" }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {!!messages.length && (
                    <div className="space-y-4 pb-2">
                      {messages.map((m) => {
                        const isUser = m.role === "user";
                        return (
                          <div key={m.id} className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
                            <div className="max-w-[min(100%,36rem)]">
                              {!isUser && (
                                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                                  <span className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: "var(--accent)" }}>B</span>
                                  BUILDWE
                                </div>
                              )}
                              <div
                                className={clsx(
                                  "rounded-3xl px-4 py-3 text-[15px] leading-relaxed",
                                  isUser ? "rounded-br-md" : "rounded-bl-md border",
                                  m.streaming && !isUser && "typing-caret"
                                )}
                                style={
                                  isUser
                                    ? { background: "var(--ink)", color: "var(--bg)" }
                                    : { background: "var(--card)", borderColor: "var(--border)" }
                                }
                              >
                                {isUser ? (
                                  <p className="whitespace-pre-wrap">{m.content}</p>
                                ) : (
                                  <div className="prose-bw" dangerouslySetInnerHTML={{ __html: md(m.content || "") }} />
                                )}
                              </div>
                              {!isUser && m.content && !m.streaming && (
                                <div className="mt-1 flex gap-0.5">
                                  <Btn variant="icon" size="sm" aria-label="Copy" onClick={() => copy(m.content, m.id)}>
                                    {copied === m.id ? <Check className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} /> : <Copy className="h-3.5 w-3.5" />}
                                  </Btn>
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Regenerate"
                                    onClick={() => {
                                      const idx = messages.findIndex((x) => x.id === m.id);
                                      const prevUser = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
                                      if (!prevUser || streaming) return;
                                      setMessages((ms) => ms.filter((x) => x.id !== m.id));
                                      setTimeout(() => send(prevUser.content), 30);
                                    }}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Btn>
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Edit prompt"
                                    onClick={() => {
                                      const idx = messages.findIndex((x) => x.id === m.id);
                                      const prevUser = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
                                      if (!prevUser) return;
                                      setInput(prevUser.content);
                                      requestAnimationFrame(grow);
                                    }}
                                  >
                                    <SquarePen className="h-3.5 w-3.5" />
                                  </Btn>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {mode === "image" && (imgLoading || activeImg) && (
                        <div className="rounded-3xl border p-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                          {imgLoading ? (
                            <div className="shimmer h-48 rounded-2xl" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={images.find((i) => i.id === activeImg)?.url}
                              alt=""
                              className="max-h-72 w-auto rounded-2xl"
                            />
                          )}
                          <div className="mt-2 flex gap-2 overflow-x-auto">
                            {images.map((i) => (
                              <button key={i.id} type="button" onClick={() => setActiveImg(i.id)} className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2" style={{ borderColor: i.id === activeImg ? "var(--accent)" : "transparent" }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={i.url} alt="" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div ref={endRef} />
                    </div>
                  )}
                </div>
              </div>

              {/* composer */}
              <div className="shrink-0 border-t px-3 py-2.5 sm:px-5" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-elevated) 95%, transparent)" }}>
                <div className="mx-auto max-w-2xl">
                  {error && (
                    <div className="mb-2 rounded-xl px-3 py-2 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {error}
                      {/limit|PRO/i.test(error) && (
                        <button type="button" className="ml-2 font-semibold underline" onClick={() => setModal("plans")}>Upgrade</button>
                      )}
                    </div>
                  )}

                  {(mode === "image" || mode === "audio") && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {mode === "image" &&
                        ASPECTS.map((a) => (
                          <button key={a} type="button" onClick={() => setAspect(a)} className="rounded-xl border px-2.5 py-1 text-[11px] font-medium" style={aspect === a ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--muted)" }}>{a}</button>
                        ))}
                      {mode === "audio" && (
                        <>
                          {(showVoices ? VOICES : VOICES.slice(0, 6)).map((v) => (
                            <button key={v.id} type="button" title={`${v.lang} · ${v.tone}`} onClick={() => setVoice(v.id)} className="rounded-xl border px-2.5 py-1 text-[11px] font-medium" style={voice === v.id ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--muted)" }}>
                              {v.label}{showVoices && <span className="ml-1 opacity-50">{v.lang}</span>}
                            </button>
                          ))}
                          <button type="button" onClick={() => setShowVoices((v) => !v)} className="rounded-xl border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--border)", color: "var(--accent)" }}>
                            {showVoices ? "Less" : `More +${VOICES.length - 6}`}
                          </button>
                          {[0.75, 1, 1.25, 1.5].map((s) => (
                            <button key={s} type="button" onClick={() => setSpeed(s)} className="rounded-xl border px-2 py-1 text-[11px]" style={speed === s ? { borderColor: "var(--accent)", color: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--muted)" }}>{s}×</button>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  <div className="rounded-3xl border shadow-sm" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <textarea
                      ref={taRef}
                      value={input}
                      rows={1}
                      placeholder={
                        mode === "auto"
                          ? "What are we making?"
                          : mode === "code"
                            ? "Describe the build…"
                            : mode === "image"
                              ? "Describe the frame…"
                              : mode === "audio"
                                ? "Paste the script…"
                                : "Message BUILDWE"
                      }
                      onChange={(e) => {
                        setInput(e.target.value);
                        grow();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      className="max-h-[96px] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] outline-none placeholder:opacity-45 md:max-h-[128px]"
                    />
                    <div className="flex items-center gap-0.5 px-2 pb-2">
                      <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
                        {MODE_META.map((m) => {
                          const Icon = m.icon;
                          const on = mode === m.id;
                          return (
                            <button key={m.id} type="button" onClick={() => switchMode(m.id)} className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium" style={on ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--muted)" }}>
                              <Icon className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{m.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <input ref={fileRef} type="file" className="hidden" accept="text/*,.md,.json,.js,.ts,.tsx,.py,.css,.html" onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const t = await f.text();
                        setInput((v) => (v ? v + "\n\n" : "") + `[File: ${f.name}]\n${t.slice(0, 8000)}`);
                        e.target.value = "";
                        requestAnimationFrame(grow);
                      }} />
                      <Btn variant="icon" size="sm" aria-label="Upload" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Btn>
                      <Btn
                        variant="icon"
                        size="sm"
                        aria-label="Mic"
                        onClick={() => {
                          const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition };
                          const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
                          if (!SR) return alert("Use Chrome for voice input");
                          if (listening) {
                            setListening(false);
                            return;
                          }
                          const rec = new SR();
                          rec.lang = "en-IN";
                          rec.onresult = (ev: SpeechRecognitionEvent) => {
                            let t = "";
                            for (let i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
                            setInput((v) => (v ? v + " " : "") + t);
                            requestAnimationFrame(grow);
                          };
                          rec.onend = () => setListening(false);
                          rec.start();
                          setListening(true);
                        }}
                      >
                        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      </Btn>
                      {streaming || imgLoading || audioBusy ? (
                        <Btn variant="ink" className="!h-10 !w-10 !p-0" aria-label="Stop" onClick={stop}><Square className="h-3.5 w-3.5 fill-current" /></Btn>
                      ) : (
                        <Btn className="!h-10 !w-10 !p-0" aria-label="Send" disabled={!input.trim()} onClick={() => send()}>
                          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Btn>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-center text-[10px]" style={{ color: "var(--soft)" }}>
                    {me?.kind === "guest" ? "Browsing free · sign in to sync across devices" : me?.user?.email}
                    {plan === "free" ? " · Free plan" : " · PRO"}
                  </p>
                </div>
              </div>
            </div>

            {/* code canvas */}
            {mode === "code" && (
              <div className="hidden min-h-0 flex-1 flex-col lg:flex" style={{ background: "var(--code-bg)", color: "var(--code-fg)" }}>
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <FileCode2 className="h-3.5 w-3.5" />
                    buildwe · {codeLang}
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className="rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10" onClick={() => copy(codePanel, "code")}>{copied === "code" ? "Copied" : "Copy"}</button>
                    <button type="button" className="rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10" onClick={() => {
                      const blob = new Blob([codePanel], { type: "text/plain" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `buildwe.${codeLang || "txt"}`;
                      a.click();
                    }}>Save</button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className="font-mono text-[13px] leading-relaxed"><code>{codePanel}</code></pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* mobile nav */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md md:hidden" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)", paddingBottom: "var(--safe-b)" }}>
          <div className="flex h-[58px]">
            {MODE_META.map((m) => {
              const Icon = m.icon;
              const on = mode === m.id;
              return (
                <button key={m.id} type="button" onClick={() => switchMode(m.id)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium" style={{ color: on ? "var(--accent)" : "var(--muted)" }}>
                  <span className="flex h-7 w-11 items-center justify-center rounded-full" style={on ? { background: "var(--accent-soft)" } : undefined}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {m.label}
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(100%,300px)] flex-col" style={{ background: "var(--bg-elevated)", paddingTop: "var(--safe-t)" }}>
            <div className="flex h-14 items-center justify-between border-b px-3" style={{ borderColor: "var(--border)" }}>
              <span className="font-semibold">BUILDWE</span>
              <Btn variant="icon" aria-label="Close" onClick={() => setDrawer(false)}><X className="h-4 w-4" /></Btn>
            </div>
            <div className="p-3"><Btn className="w-full" onClick={newChat}><Plus className="h-4 w-4" /> New chat</Btn></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2">
              {filteredHistory.map((h) => (
                <button key={h.id} type="button" onClick={() => openHist(h.id)} className="mb-0.5 flex w-full rounded-xl px-3 py-2.5 text-left text-sm" style={h.id === convId ? { background: "var(--secondary)" } : undefined}>
                  <span className="truncate font-medium">{h.title}</span>
                </button>
              ))}
            </div>
            <div className="space-y-1 border-t p-3" style={{ borderColor: "var(--border)", paddingBottom: "calc(12px + var(--safe-b))" }}>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ color: "var(--muted)" }} onClick={() => { setDrawer(false); setModal("settings"); }}><Settings className="h-4 w-4" /> Settings</button>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} onClick={() => { setDrawer(false); setModal("plans"); }}><Zap className="h-4 w-4" /> Plans</button>
            </div>
          </div>
        </div>
      )}

      {modal === "auth" && (
        <AuthSheet
          tab={authTab}
          setTab={setAuthTab}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          name={name}
          setName={setName}
          err={authErr}
          busy={authBusy}
          onSubmit={onAuth}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "plans" && (
        <PlansSheet
          plan={plan}
          onClose={() => setModal(null)}
          onPro={() => {
            if (!loggedIn) {
              setAuthTab("register");
              setModal("auth");
            } else {
              setModal(null);
              // Billing hooks live under /api/checkout — wire keys when ready
              window.location.href = "/pricing";
            }
          }}
        />
      )}

      {modal === "settings" && (
        <Sheet onClose={() => setModal(null)} title="Settings">
          <div className="space-y-1">
            <button type="button" onClick={() => setModal(loggedIn ? "profile" : "auth")} className="mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{(me?.name || "G")[0]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{me?.name || "Guest"}</span>
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>{loggedIn ? me?.user?.email : "Tap to log in"}</span>
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--soft)" }} />
            </button>
            <div className="px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>Theme</div>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ["system", Monitor, "System"],
                ["light", Sun, "Light"],
                ["dark", Moon, "Dark"],
              ] as const).map(([id, Icon, label]) => (
                <button key={id} type="button" onClick={() => setThemePref(id)} className="flex items-center justify-center gap-1 rounded-xl border py-2.5 text-[11px] font-medium" style={themePref === id ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--muted)" }}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="pt-3">
              <a href="/about" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Bot className="h-4 w-4 opacity-70" /> About BUILDWE <ExternalLink className="ml-auto h-3.5 w-3.5" style={{ color: "var(--soft)" }} /></a>
              <a href="/privacy" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Shield className="h-4 w-4 opacity-70" /> Privacy</a>
              <a href="/terms" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><FileCode2 className="h-4 w-4 opacity-70" /> Terms</a>
              <button type="button" onClick={() => setModal("plans")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><CreditCard className="h-4 w-4 opacity-70" /> Plan · {plan}</button>
              {loggedIn ? (
                <button type="button" onClick={doLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600"><LogOut className="h-4 w-4" /> Log out</button>
              ) : (
                <button type="button" onClick={() => setModal("auth")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><LogIn className="h-4 w-4 opacity-70" /> Log in</button>
              )}
            </div>
            <p className="px-1 pt-2 text-[10px]" style={{ color: "var(--soft)" }}>Now: {dark ? "Dark" : "Light"}{themePref === "system" ? " (system)" : ""}</p>
          </div>
        </Sheet>
      )}

      {modal === "profile" && me?.user && (
        <Sheet onClose={() => setModal(null)} title="Profile">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{me.name[0]}</span>
            <div>
              <div className="text-lg font-medium">{me.user.name}</div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>{me.user.email}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
            <div><div className="text-[10px] uppercase" style={{ color: "var(--soft)" }}>Plan</div><div className="font-medium">{me.plan}</div></div>
            <div><div className="text-[10px] uppercase" style={{ color: "var(--soft)" }}>Today</div><div className="font-medium">{me.usage.chat} chats</div></div>
          </div>
          <Btn variant="ghost" className="mt-4 w-full" onClick={doLogout}>Log out</Btn>
        </Sheet>
      )}
    </div>
  );
}

function AuthSheet(props: {
  tab: "login" | "register";
  setTab: (t: "login" | "register") => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  err: string;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={props.onClose} title={props.tab === "login" ? "Welcome back" : "Create account"}>
      <div className="mb-4 flex rounded-2xl border p-1" style={{ borderColor: "var(--border)" }}>
        {(["login", "register"] as const).map((t) => (
          <button key={t} type="button" onClick={() => props.setTab(t)} className="flex-1 rounded-xl py-2 text-sm font-medium capitalize" style={props.tab === t ? { background: "var(--ink)", color: "var(--bg)" } : { color: "var(--muted)" }}>{t}</button>
        ))}
      </div>
      <form onSubmit={props.onSubmit} className="space-y-3">
        {props.tab === "register" && (
          <input value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="Name" className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
        )}
        <input type="email" required value={props.email} onChange={(e) => props.setEmail(e.target.value)} placeholder="Email" className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
        <input type="password" required minLength={6} value={props.password} onChange={(e) => props.setPassword(e.target.value)} placeholder="Password (min 6)" className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
        {props.err && <p className="text-xs text-red-600">{props.err}</p>}
        <Btn type="submit" className="w-full" size="lg" disabled={props.busy}>{props.busy ? "…" : props.tab === "login" ? "Log in" : "Sign up free"}</Btn>
      </form>
      <p className="mt-3 text-center text-[11px]" style={{ color: "var(--soft)" }}>Free account · your workspace, your history</p>
    </Sheet>
  );
}

function PlansSheet({ plan, onClose, onPro }: { plan: string; onClose: () => void; onPro: () => void }) {
  return (
    <Sheet onClose={onClose} title="Plans" wide>
      <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
        BUILDWE is free so more people can create. We grow with reach — supported by ads on Free. PRO removes friction when you need volume.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border p-4" style={{ borderColor: plan === "free" ? "var(--accent)" : "var(--border)", background: "var(--secondary)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--soft)" }}>FREE {plan === "free" && "· CURRENT"}</div>
          <div className="mt-1 text-2xl font-semibold">$0</div>
          <ul className="mt-3 space-y-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <li>✓ Full platform access</li>
            <li>✓ Chat, Code, Image, Audio</li>
            <li>✓ Fair daily creative limits</li>
            <li>✓ Ad-supported experience</li>
          </ul>
        </div>
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--accent)" }}>PRO</div>
          <div className="mt-1 text-2xl font-semibold">$5<span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/mo</span></div>
          <ul className="mt-3 space-y-1.5 text-xs">
            <li>✓ Higher creative limits</li>
            <li>✓ Priority generation</li>
            <li>✓ Calmer, fewer ads</li>
            <li>✓ Built for daily heavy use</li>
          </ul>
          <Btn className="mt-4 w-full" size="sm" onClick={onPro}>Upgrade to PRO</Btn>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: "var(--soft)" }}>
        <Link href="/pricing" onClick={onClose} className="underline">Pricing page</Link>
        <Link href="/terms" onClick={onClose} className="underline">Terms</Link>
        <Link href="/privacy" onClick={onClose} className="underline">Privacy</Link>
      </div>
    </Sheet>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-[100dvh] items-center justify-center text-sm" style={{ background: "#F7F4EE", color: "#6b6560" }}>Loading BUILDWE…</div>}>
      <Dashboard />
    </Suspense>
  );
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  start(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
