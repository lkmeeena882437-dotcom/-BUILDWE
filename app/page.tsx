"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  MessageSquare,
  Code2,
  Image as ImageIcon,
  Mic2,
  Send,
  Square,
  Copy,
  Check,
  Download,
  RotateCcw,
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
  Play,
  Pause,
  Volume2,
  Maximize2,
  Paperclip,
  Mic,
  MicOff,
  Share2,
  FileCode2,
  FolderOpen,
  Presentation,
  LogOut,
  LogIn,
  CreditCard,
  HelpCircle,
  MessageCircle,
  Sun,
  Moon,
  Monitor,
  Star,
  PanelLeftClose,
  PanelLeft,
  ArrowUpRight,
  RefreshCw,
  Bot,
  Shield,
  ExternalLink,
} from "lucide-react";
import clsx from "clsx";
import { detectIntent, isComplexCodePrompt } from "@/lib/ai/rules";
import { streamDemoText } from "@/lib/ai/gateway";

/* ─────────────────────────────────────────────────────────────
   BUILDWE.ONLINE — Fast · Mobile-first · Free→PRO checkout
   ───────────────────────────────────────────────────────────── */

type Mode = "auto" | "chat" | "code" | "image" | "audio";
type Plan = "free" | "pro";
type ThemePref = "system" | "light" | "dark";
type CodeView = "files" | "slides";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  streaming?: boolean;
}

interface Activity {
  id: string;
  title: string;
  mode: Mode;
  preview: string;
  messages: Message[];
  updatedAt: number;
  /** optional attachments from other modes */
  meta?: Record<string, unknown>;
}

interface CodeFile {
  id: string;
  name: string;
  language: string;
  content: string;
}

interface Slide {
  id: string;
  title: string;
  body: string;
}

interface ImageGen {
  id: string;
  prompt: string;
  aspect: string;
  url: string;
  createdAt: number;
  status: "done" | "loading";
}

interface AudioGen {
  id: string;
  text: string;
  voice: string;
  speed: number;
  duration: number;
  createdAt: number;
  status: "done" | "loading";
  playing?: boolean;
}

const MODES: { id: Mode; label: string; icon: React.ElementType; hint: string }[] = [
  { id: "auto", label: "Auto", icon: Bot, hint: "AI picks the tool" },
  { id: "chat", label: "Chat", icon: MessageSquare, hint: "Ask anything" },
  { id: "code", label: "Code", icon: Code2, hint: "Build & ship" },
  { id: "image", label: "Image", icon: ImageIcon, hint: "Create visuals" },
  { id: "audio", label: "Audio", icon: Mic2, hint: "Make voice" },
];

const CHAT_HEADLINES = [
  "What can we build today?",
  "What's on your mind?",
  "Ready to build?",
  "What do you want to create?",
];

const SUGGESTIONS: Record<string, string[]> = {
  auto: [
    "Build a landing page for my app",
    "Explain quantum computing simply",
    "Image: cream workspace morning light",
    "Read this welcome script aloud",
  ],
  chat: ["Explain this simply", "Brainstorm 5 ideas", "Write a short draft", "Help me decide"],
  code: ["Landing page for a SaaS", "Todo app with local save", "Quiz game in browser"],
  image: ["Soft cream workspace", "Minimal AI logo", "Cozy reading nook"],
  audio: ["Welcome to BUILDWE.ONLINE", "Your daily brief in 30 seconds"],
};

const ASPECTS = [
  { id: "1:1", label: "1:1", w: 1, h: 1 },
  { id: "16:9", label: "16:9", w: 16, h: 9 },
  { id: "9:16", label: "9:16", w: 9, h: 16 },
  { id: "4:3", label: "4:3", w: 4, h: 3 },
];

const VOICES: { id: string; label: string; lang: string; region: string; tone: string }[] = [
  // English
  { id: "nova", label: "Nova", lang: "English", region: "US", tone: "Warm" },
  { id: "atlas", label: "Atlas", lang: "English", region: "US", tone: "Deep" },
  { id: "luna", label: "Luna", lang: "English", region: "UK", tone: "Soft" },
  { id: "ember", label: "Ember", lang: "English", region: "US", tone: "Expressive" },
  { id: "river", label: "River", lang: "English", region: "AU", tone: "Clear" },
  // Hindi / Indian
  { id: "aanya", label: "Aanya", lang: "Hindi", region: "IN", tone: "Warm" },
  { id: "arjun", label: "Arjun", lang: "Hindi", region: "IN", tone: "Steady" },
  { id: "kiara", label: "Kiara", lang: "Hindi", region: "IN", tone: "Bright" },
  { id: "vihaan", label: "Vihaan", lang: "Hindi", region: "IN", tone: "Deep" },
  { id: "meera", label: "Meera", lang: "English", region: "IN", tone: "Soft" },
  { id: "kabir", label: "Kabir", lang: "English", region: "IN", tone: "Clear" },
  { id: "saanvi", label: "Saanvi", lang: "Hindi", region: "IN", tone: "Gentle" },
  { id: "ananya_bn", label: "Ananya", lang: "Bengali", region: "IN", tone: "Warm" },
  { id: "dev_ta", label: "Dev", lang: "Tamil", region: "IN", tone: "Clear" },
  { id: "isha_te", label: "Isha", lang: "Telugu", region: "IN", tone: "Soft" },
  // World
  { id: "sofia", label: "Sofia", lang: "Spanish", region: "ES", tone: "Bright" },
  { id: "luca", label: "Luca", lang: "Italian", region: "IT", tone: "Warm" },
  { id: "amira", label: "Amira", lang: "Arabic", region: "AE", tone: "Clear" },
  { id: "yuki", label: "Yuki", lang: "Japanese", region: "JP", tone: "Soft" },
  { id: "chen", label: "Chen", lang: "Mandarin", region: "CN", tone: "Steady" },
];

const VOICE_PREVIEW_COUNT = 6;

const SKILL_PRESETS = [
  "Web development",
  "Python",
  "Design",
  "Marketing",
  "Writing",
  "Student",
  "Founder",
];

const FREE_LIMITS = { code: 15, image: 5, audio: 5 };

function uid(p = "id") {
  return `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  ) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDuration(s: number) {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 60)}:${(n % 60).toString().padStart(2, "0")}`;
}

function roughMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre data-lang="${lang || ""}"><code>${code.replace(/\n$/, "")}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)(?:\n<li>[\s\S]*?<\/li>)*/g, (m) => `<ul>${m}</ul>`);
  return html
    .split(/\n{2,}/)
    .map((b) =>
      b.startsWith("<pre") || b.startsWith("<ul") ? b : `<p>${b.replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.slice(0, 48) + (t.length > 48 ? "…" : "");
}

function buildProject(prompt: string): { files: CodeFile[]; slides: Slide[]; summary: string } {
  const p = prompt.toLowerCase();
  const isGame = /game|quiz/.test(p);
  const name =
    prompt.match(/name[:\s]+([^\n,]+)/i)?.[1]?.trim() ||
    (isGame ? "Quiz Game" : /landing|saas|website/.test(p) ? "Landing" : "App");

  if (isGame) {
    return {
      summary: `${name} — browser quiz`,
      slides: [
        { id: uid("s"), title: name, body: "Playable quiz\nScore tracking\nClean UI" },
      ],
      files: [
        {
          id: uid("f"),
          name: "index.html",
          language: "html",
          content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8"/>\n<meta name="viewport" content="width=device-width,initial-scale=1"/>\n<title>${name}</title>\n<link rel="stylesheet" href="styles.css"/>\n</head>\n<body>\n<main class="app"><h1>${name}</h1><p id="q"></p><div id="choices"></div><p id="score">Score: 0</p></main>\n<script src="app.js"></script>\n</body>\n</html>\n`,
        },
        {
          id: uid("f"),
          name: "styles.css",
          language: "css",
          content: `body{margin:0;font-family:system-ui,sans-serif;background:#F8F6F1;display:grid;place-items:center;min-height:100vh}\n.app{width:min(400px,92vw);background:#fff;border:1px solid #E5E1D8;border-radius:16px;padding:24px}\nbutton{display:block;width:100%;margin:8px 0;padding:12px;border-radius:12px;border:1px solid #E5E1D8;background:#FDFCFA;cursor:pointer;text-align:left}\n`,
        },
        {
          id: uid("f"),
          name: "app.js",
          language: "javascript",
          content: `const qs=[{q:"2+2?",a:["3","4","5"],c:1},{q:"AI means?",a:["Artificial Intelligence","Auto Input"],c:0}];\nlet i=0,score=0;\nconst q=document.getElementById("q"),ch=document.getElementById("choices"),sc=document.getElementById("score");\nfunction render(){if(i>=qs.length){q.textContent="Done!";ch.innerHTML="";return;}const c=qs[i];q.textContent=c.q;ch.innerHTML="";c.a.forEach((t,idx)=>{const b=document.createElement("button");b.textContent=t;b.onclick=()=>{if(idx===c.c)score++;i++;sc.textContent="Score: "+score;render();};ch.appendChild(b);});}\nrender();\n`,
        },
        {
          id: uid("f"),
          name: "README.md",
          language: "markdown",
          content: `# ${name}\n\nOpen index.html\n\nBuilt with BUILDWE CODE.\n`,
        },
      ],
    };
  }

  return {
    summary: `${name} — starter project`,
    slides: [
      { id: uid("s"), title: name, body: "Hero + structure\nMobile ready\nEdit in canvas" },
    ],
    files: [
      {
        id: uid("f"),
        name: "index.html",
        language: "html",
        content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8"/>\n<meta name="viewport" content="width=device-width,initial-scale=1"/>\n<title>${name}</title>\n<link rel="stylesheet" href="styles.css"/>\n</head>\n<body>\n<header class="nav"><strong>${name}</strong><a href="#cta">Start</a></header>\n<section class="hero"><h1>Build better.</h1><p>${prompt.slice(0, 120)}</p><a class="btn" id="cta" href="#">Get started</a></section>\n</body>\n</html>\n`,
      },
      {
        id: uid("f"),
        name: "styles.css",
        language: "css",
        content: `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#F8F6F1;color:#1C1C1C}\n.nav{display:flex;justify-content:space-between;padding:16px 24px;border-bottom:1px solid #E5E1D8}\n.hero{max-width:640px;margin:0 auto;padding:64px 24px;text-align:center}\nh1{font-size:clamp(2rem,5vw,3rem);letter-spacing:-.02em}\n.btn{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:12px;background:#C45C26;color:#fff;text-decoration:none;font-weight:600}\n`,
      },
      {
        id: uid("f"),
        name: "README.md",
        language: "markdown",
        content: `# ${name}\n\nPrompt: ${prompt.slice(0, 200)}\n\nOpen index.html\n`,
      },
    ],
  };
}

function demoReply(mode: Mode, prompt: string, skills: string[]): string {
  const skill =
    skills.length > 0 ? `\n\n_Tuned for: **${skills.slice(0, 3).join(", ")}**_` : "";
  if (mode === "code") {
    return `Built a clean starter for “${prompt.slice(0, 60)}”.\n\nOpen **Files** in the canvas — edit, copy, or download.\n\nWhat should we change next?${skill}`;
  }
  if (mode === "image") return `Creating visual for: ${prompt.slice(0, 100)}${skill}`;
  if (mode === "audio") return prompt;
  return `Got it.\n\n**Clear path**\n- Outcome first\n- Smallest useful version\n- One next action\n\nShare constraints and I’ll go concrete.${skill}`;
}

function downloadText(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── atoms ────────────────────────────────────────────────── */

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  size = "md",
  className,
  "aria-label": ariaLabel,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "ink" | "icon";
  size?: "sm" | "md" | "lg";
  className?: string;
  "aria-label"?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "rounded-xl text-white",
        variant === "ghost" && "rounded-xl border",
        variant === "ink" && "rounded-xl",
        variant === "icon" && "rounded-lg",
        size === "sm" && variant !== "icon" && "h-9 px-3 text-sm",
        size === "md" && variant !== "icon" && "h-10 px-4 text-sm",
        size === "lg" && variant !== "icon" && "h-11 px-5 text-[15px]",
        variant === "icon" && (size === "sm" ? "h-8 w-8" : "h-9 w-9"),
        className
      )}
      style={
        variant === "primary"
          ? { background: "var(--accent)" }
          : variant === "ink"
            ? { background: "var(--ink)", color: "var(--bg)" }
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("lock-scroll");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("lock-scroll");
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          "relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border p-4 shadow-lift sm:rounded-2xl sm:p-5",
          wide ? "max-w-lg" : "max-w-md"
        )}
        style={{
          borderColor: "var(--border)",
          background: "var(--card)",
          color: "var(--ink)",
          paddingBottom: "calc(16px + var(--safe-b))",
        }}
      >
        <div className="mb-2 flex justify-center sm:hidden">
          <span className="h-1 w-10 rounded-full" style={{ background: "var(--border)" }} />
        </div>
        {title && (
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ color: "var(--muted)" }}
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="flex-1 text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ color: "var(--muted)" }}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {!title && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--muted)" }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm"
      style={{ color: danger ? "#dc2626" : "var(--ink)" }}
    >
      <Icon className="h-4 w-4 opacity-70" />
      <span className="flex-1 font-medium">{label}</span>
      {value && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {value}
        </span>
      )}
      <ChevronRight className="h-4 w-4" style={{ color: "var(--soft)" }} />
    </button>
  );
}

/* ── Main (wrapped for useSearchParams) ───────────────────── */

function DashboardInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [plan, setPlan] = useState<Plan>("free");
  const [modal, setModal] = useState<
    | "settings"
    | "profile"
    | "skills"
    | "login"
    | "checkout"
    | "plans"
    | "feedback"
    | "help"
    | null
  >(null);
  const [modalStack, setModalStack] = useState<string[]>([]);

  const openModal = (m: NonNullable<typeof modal>) => {
    setModalStack((s) => (modal ? [...s, modal] : s));
    setModal(m);
  };
  const closeModal = () => {
    setModalStack((s) => {
      if (s.length) {
        const prev = s[s.length - 1] as typeof modal;
        setModal(prev);
        return s.slice(0, -1);
      }
      setModal(null);
      return s;
    });
  };
  const closeAllModals = () => {
    setModalStack([]);
    setModal(null);
  };

  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [dark, setDark] = useState(false);
  const [skills, setSkills] = useState<string[]>(["Web development"]);
  const [customSkill, setCustomSkill] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [authNext, setAuthNext] = useState<"upload" | "download" | "pro" | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [userName, setUserName] = useState("Guest");
  const [userEmail, setUserEmail] = useState("");
  const [listening, setListening] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [payMethod, setPayMethod] = useState<"upi" | "card" | "netbanking">("upi");
  const [checkoutInfo, setCheckoutInfo] = useState({
    displayAmount: "₹500",
    planName: "BUILDWE PRO",
    demo: true,
  });

  const initials = useMemo(() => {
    if (!loggedIn || userName === "Guest") return "G";
    return (
      userName
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "U"
    );
  }, [loggedIn, userName]);

  // Unified activity history
  const [activities, setActivities] = useState<Activity[]>([
    {
      id: "a_welcome",
      title: "Welcome",
      mode: "chat",
      preview: "Hey — I'm BUILDWE.",
      updatedAt: Date.now() - 60000,
      messages: [
        {
          id: "m0",
          role: "assistant",
          content:
            "Hey — I'm **BUILDWE**.\n\nChat, code, images, audio — or use **Auto** and I’ll pick the tool.\n\nWhat are you working on?",
          createdAt: Date.now() - 60000,
        },
      ],
    },
  ]);
  const [activeId, setActiveId] = useState("a_welcome");
  const active = activities.find((a) => a.id === activeId) || activities[0];

  // Shared input — FIXED height behavior (never blocks viewport)
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Code canvas
  const [codeFiles, setCodeFiles] = useState<CodeFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [codeView, setCodeView] = useState<CodeView>("files");
  const [pendingQ, setPendingQ] = useState<string[] | null>(null);
  const [clarify, setClarify] = useState<Record<string, string>>({});
  const [seedPrompt, setSeedPrompt] = useState("");
  const [showCanvasMobile, setShowCanvasMobile] = useState(false);

  // Image / audio
  const [aspect, setAspect] = useState("1:1");
  const [images, setImages] = useState<ImageGen[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [voice, setVoice] = useState("nova");
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [audios, setAudios] = useState<AudioGen[]>([]);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [usage, setUsage] = useState({ code: 0, image: 0, audio: 0 });
  const [headline] = useState(
    () => CHAT_HEADLINES[Math.floor(Math.random() * CHAT_HEADLINES.length)]
  );

  const history = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...activities]
      .filter((a) => !q || a.title.toLowerCase().includes(q) || a.preview.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activities, search]);

  const activeFile = codeFiles.find((f) => f.id === activeFileId) || codeFiles[0];
  const meta = MODES.find((m) => m.id === mode)!;

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

  /* open checkout from /?checkout=pro */
  useEffect(() => {
    if (searchParams.get("checkout") === "pro") {
      setModal("checkout");
      router.replace("/", { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, streaming]);

  useEffect(
    () => () => {
      if (audioTimer.current) clearInterval(audioTimer.current);
      recognitionRef.current?.stop?.();
    },
    []
  );

  /* stable textarea grow — capped so it never eats the screen */
  const growInput = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = typeof window !== "undefined" && window.innerWidth < 768 ? 100 : 140;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, []);

  useEffect(() => {
    // reset height on mode switch so oversized state never sticks
    if (taRef.current) {
      taRef.current.style.height = "auto";
    }
    growInput();
  }, [mode, growInput]);

  const requireAuth = (reason: "upload" | "download" | "pro") => {
    if (loggedIn) return true;
    setAuthNext(reason);
    openModal("login");
    return false;
  };

  const hiddenLimit = (f: "code" | "image" | "audio") =>
    plan === "free" && usage[f] >= FREE_LIMITS[f];

  const stopStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  };

  const switchMode = (m: Mode) => {
    if (streaming) stopStream();
    setMode(m);
    setDrawer(false);
    setShowCanvasMobile(false);
    if (m !== "audio") setShowAllVoices(false);
    setInput("");
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.style.height = "44px";
      }
    });
  };

  const newChat = () => {
    const id = uid("a");
    const item: Activity = {
      id,
      title: "New chat",
      mode: "chat",
      preview: "",
      messages: [],
      updatedAt: Date.now(),
    };
    setActivities((p) => [item, ...p]);
    setActiveId(id);
    setMode("chat");
    setInput("");
    setCodeFiles([]);
    setPendingQ(null);
    setDrawer(false);
  };

  const deleteActivity = (id: string) => {
    setActivities((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || "");
      return next.length
        ? next
        : [
            {
              id: uid("a"),
              title: "New chat",
              mode: "chat",
              preview: "",
              messages: [],
              updatedAt: Date.now(),
            },
          ];
    });
  };

  const pushMessages = (actId: string, msgs: Message[], title?: string, m?: Mode) => {
    setActivities((prev) =>
      prev.map((a) =>
        a.id !== actId
          ? a
          : {
              ...a,
              title: title || a.title,
              mode: m || a.mode,
              preview: msgs[msgs.length - 1]?.content.slice(0, 80) || a.preview,
              messages: msgs,
              updatedAt: Date.now(),
            }
      )
    );
  };

  const ensureActivity = (text: string, m: Mode) => {
    let id = activeId;
    let act = activities.find((a) => a.id === id);
    if (!act || (act.messages.length === 0 && act.title === "New chat")) {
      // reuse empty or create
      if (!act) {
        id = uid("a");
        act = {
          id,
          title: titleFrom(text),
          mode: m,
          preview: text.slice(0, 80),
          messages: [],
          updatedAt: Date.now(),
        };
        setActivities((p) => [act!, ...p]);
        setActiveId(id);
      } else {
        setActivities((p) =>
          p.map((a) =>
            a.id === id
              ? { ...a, title: titleFrom(text), mode: m, updatedAt: Date.now() }
              : a
          )
        );
      }
    } else if (act.mode !== m && act.messages.length > 0) {
      // continue same thread but tag latest mode in title lightly
      setActivities((p) =>
        p.map((a) => (a.id === id ? { ...a, mode: m, updatedAt: Date.now() } : a))
      );
    }
    return id;
  };

  /* ── send ──────────────────────────────────────────────── */

  const runAssistant = async (
    actId: string,
    userText: string,
    resolvedMode: Exclude<Mode, "auto">,
    prior: Message[]
  ) => {
    const userMsg: Message = {
      id: uid("m"),
      role: "user",
      content: userText,
      createdAt: Date.now(),
    };
    const aId = uid("m");
    const assistant: Message = {
      id: aId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      streaming: true,
    };
    const base = [...prior, userMsg, assistant];
    pushMessages(actId, base, prior.length === 0 ? titleFrom(userText) : undefined, resolvedMode);

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      if (resolvedMode === "image") {
        await doImage(userText);
        const reply = `Image ready for:\n\n> ${userText.slice(0, 160)}\n\nCheck the preview panel.`;
        await streamDemoText(
          reply,
          (partial) => {
            pushMessages(
              actId,
              base.map((m) =>
                m.id === aId ? { ...m, content: partial, streaming: true } : m
              )
            );
          },
          ctrl.signal
        );
      } else if (resolvedMode === "audio") {
        await doAudio(userText);
        const reply = `Audio generated with **${VOICES.find((v) => v.id === voice)?.label || voice}**. Use the player to play, share, or download.`;
        await streamDemoText(
          reply,
          (partial) => {
            pushMessages(
              actId,
              base.map((m) =>
                m.id === aId ? { ...m, content: partial, streaming: true } : m
              )
            );
          },
          ctrl.signal
        );
      } else if (resolvedMode === "code") {
        const project = buildProject(userText);
        setCodeFiles(project.files);
        setActiveFileId(project.files[0]?.id || null);
        setSlides(project.slides);
        setActiveSlide(0);
        setShowCanvasMobile(true);
        setUsage((u) => ({ ...u, code: u.code + 1 }));
        const reply = demoReply("code", userText, skills) + `\n\n**${project.summary}**\nFiles: ${project.files.map((f) => `\`${f.name}\``).join(", ")}`;
        await streamDemoText(
          reply,
          (partial) => {
            pushMessages(
              actId,
              base.map((m) =>
                m.id === aId ? { ...m, content: partial, streaming: true } : m
              )
            );
          },
          ctrl.signal
        );
      } else {
        const reply = demoReply("chat", userText, skills);
        await streamDemoText(
          reply,
          (partial) => {
            pushMessages(
              actId,
              base.map((m) =>
                m.id === aId ? { ...m, content: partial, streaming: true } : m
              )
            );
          },
          ctrl.signal
        );
      }

      setActivities((prev) =>
        prev.map((a) =>
          a.id !== actId
            ? a
            : {
                ...a,
                messages: a.messages.map((m) =>
                  m.id === aId ? { ...m, streaming: false } : m
                ),
              }
        )
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setActivities((prev) =>
          prev.map((a) =>
            a.id !== actId
              ? a
              : {
                  ...a,
                  messages: a.messages.map((m) =>
                    m.id === aId
                      ? {
                          ...m,
                          content: "Something went wrong. Try again.",
                          streaming: false,
                        }
                      : m
                  ),
                }
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const doImage = async (prompt: string) => {
    if (hiddenLimit("image")) {
      openModal("plans");
      throw new DOMException("limit", "AbortError");
    }
    const id = uid("img");
    setImages((p) => [
      { id, prompt, aspect, url: "", createdAt: Date.now(), status: "loading" },
      ...p,
    ]);
    setActiveImageId(id);
    setImageLoading(true);
    setUsage((u) => ({ ...u, image: u.image + 1 }));
    await new Promise((r) => setTimeout(r, 1200));
    const a = ASPECTS.find((x) => x.id === aspect) || ASPECTS[0];
    const w = a.w * 100;
    const h = a.h * 100;
    const hue = 20 + Math.floor(Math.random() * 40);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},42%,93%)"/><stop offset="100%" stop-color="hsl(${hue + 20},38%,74%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="system-ui" font-size="14" fill="rgba(28,28,28,.4)">BUILDWE</text></svg>`;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    setImages((p) => p.map((i) => (i.id === id ? { ...i, url, status: "done" } : i)));
    setImageLoading(false);
  };

  const doAudio = async (text: string) => {
    if (hiddenLimit("audio")) {
      openModal("plans");
      throw new DOMException("limit", "AbortError");
    }
    const id = uid("aud");
    const duration = Math.max(3, Math.round(text.split(/\s+/).length / 2.5 / speed));
    setAudios((p) => [
      {
        id,
        text,
        voice,
        speed,
        duration,
        createdAt: Date.now(),
        status: "loading",
      },
      ...p,
    ]);
    setActiveAudioId(id);
    setAudioLoading(true);
    setUsage((u) => ({ ...u, audio: u.audio + 1 }));
    await new Promise((r) => setTimeout(r, 900));
    setAudios((p) => p.map((a) => (a.id === id ? { ...a, status: "done" } : a)));
    setAudioLoading(false);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;

    let resolved: Exclude<Mode, "auto"> =
      mode === "auto" ? detectIntent(text) : mode;

    // complex code → optional questions
    if (
      resolved === "code" &&
      isComplexCodePrompt(text) &&
      !pendingQ &&
      codeFiles.length === 0
    ) {
      setSeedPrompt(text);
      setInput("");
      if (taRef.current) taRef.current.style.height = "44px";
      setPendingQ([
        "Project name?",
        "UI / UX style? (minimal, playful, premium…)",
        "Look & vibe? (colors, references)",
      ]);
      setClarify({});
      const actId = ensureActivity(text, "code");
      const act = activities.find((a) => a.id === actId);
      const prior = act?.messages || [];
      pushMessages(
        actId,
        [
          ...prior,
          { id: uid("m"), role: "user", content: text, createdAt: Date.now() },
          {
            id: uid("m"),
            role: "assistant",
            content:
              "Quick details (or **Skip**):\n\n1. Project name?\n2. UI / UX style?\n3. Look & vibe?",
            createdAt: Date.now(),
          },
        ],
        titleFrom(text),
        "code"
      );
      setMode("code");
      return;
    }

    if (resolved === "code" && hiddenLimit("code")) {
      openModal("plans");
      return;
    }

    setInput("");
    if (taRef.current) taRef.current.style.height = "44px";

    if (mode === "auto") {
      // softly switch UI to resolved tool
      setMode(resolved);
    }

    const actId = ensureActivity(text, resolved);
    const act = activities.find((a) => a.id === actId);
    const prior = act?.id === actId ? act.messages : [];
    // re-read latest
    const latest = activities.find((a) => a.id === actId)?.messages || prior;
    await runAssistant(actId, text, resolved, latest.length ? latest : []);
  };

  const confirmBuild = async () => {
    const line =
      seedPrompt +
      "\n" +
      Object.entries(clarify)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    setPendingQ(null);
    setSeedPrompt("");
    const actId = activeId;
    const prior = activities.find((a) => a.id === actId)?.messages || [];
    await runAssistant(actId, line, "code", prior);
  };

  const skipBuild = async () => {
    const line = seedPrompt || "New project";
    setPendingQ(null);
    setSeedPrompt("");
    const actId = activeId;
    const prior = activities.find((a) => a.id === actId)?.messages || [];
    await runAssistant(actId, line, "code", prior);
  };

  const onUpload = (file: File) => {
    if (!requireAuth("upload")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "").slice(0, 6000);
      setInput((v) => (v ? v + "\n\n" : "") + `[Uploaded: ${file.name}]\n${text}`);
      requestAnimationFrame(growInput);
    };
    if (
      file.type.startsWith("text/") ||
      /\.(txt|md|json|js|ts|tsx|py|css|html|csv)$/i.test(file.name)
    ) {
      reader.readAsText(file);
    } else {
      setInput((v) => (v ? v + "\n" : "") + `[Attached: ${file.name}]`);
    }
  };

  const toggleMic = () => {
    const w = window as unknown as {
      SpeechRecognition?: typeof SpeechRecognition;
      webkitSpeechRecognition?: typeof SpeechRecognition;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input needs Chrome / Edge.");
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let t = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setInput((v) => (v ? v + " " : "") + t);
      requestAnimationFrame(growInput);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  };

  const guardedDownload = (fn: () => void) => {
    if (!requireAuth("download")) return;
    fn();
  };

  const togglePlay = (id: string) => {
    const item = audios.find((a) => a.id === id);
    if (!item || item.status !== "done") return;
    if (audioTimer.current) {
      clearInterval(audioTimer.current);
      audioTimer.current = null;
    }
    const playing = !!item.playing;
    setAudios((p) => p.map((a) => ({ ...a, playing: a.id === id ? !playing : false })));
    if (playing) return;
    setActiveAudioId(id);
    setAudioProgress(0);
    const start = Date.now();
    const dur = item.duration * 1000;
    audioTimer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / dur);
      setAudioProgress(p);
      if (p >= 1) {
        if (audioTimer.current) clearInterval(audioTimer.current);
        setAudios((prev) =>
          prev.map((a) => (a.id === id ? { ...a, playing: false } : a))
        );
        setAudioProgress(0);
      }
    }, 50);
  };

  /* checkout */
  const startCheckout = async () => {
    setCheckoutError("");
    if (!loggedIn) {
      setAuthNext("pro");
      openModal("login");
      return;
    }
    if (!agreeTerms) {
      setCheckoutError("Agree to Terms & Privacy to continue.");
      return;
    }
    setCheckoutBusy(true);
    try {
      const res = await fetch("/api/checkout/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userEmail || "user_demo" }),
      });
      const data = await res.json();
      setCheckoutInfo({
        displayAmount: data.displayAmount || "₹500",
        planName: data.planName || "BUILDWE PRO",
        demo: Boolean(data.demo),
      });

      // DEMO payment success path (replace with Razorpay Checkout.js)
      // TODO(prod): new (window as any).Razorpay({ key, amount, order_id, handler }).open()
      const verify = await fetch("/api/checkout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razorpay_order_id: data.order?.id || "order_demo",
          razorpay_payment_id: `pay_demo_${Date.now()}`,
          razorpay_signature: "demo",
          method: payMethod,
        }),
      });
      const v = await verify.json();
      if (v.ok) {
        setPlan("pro");
        closeAllModals();
      } else {
        setCheckoutError(v.error || "Payment failed");
      }
    } catch {
      setCheckoutError("Network error. Try again.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const switchToFree = () => {
    setPlan("free");
    closeAllModals();
  };

  const placeholder =
    mode === "auto"
      ? "Describe anything — I’ll choose Chat, Code, Image, or Audio…"
      : mode === "code"
        ? "Describe what to build…"
        : mode === "image"
          ? "Describe the image…"
          : mode === "audio"
            ? "Text to speak…"
            : "Message BUILDWE…";

  /* ── render ────────────────────────────────────────────── */

  return (
    <div
      className="flex h-[100dvh] w-full overflow-hidden"
      style={{ background: "var(--bg)", color: "var(--ink)" }}
    >
      {/* SIDEBAR 3-layer */}
      <aside
        className={clsx(
          "relative z-20 hidden shrink-0 flex-col border-r transition-[width] duration-200 lg:flex",
          sidebarOpen ? "w-60" : "w-[68px]"
        )}
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
      >
        <div
          className="flex h-14 shrink-0 items-center gap-2.5 border-b px-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
            style={{ background: "var(--ink)", color: "var(--bg)" }}
          >
            B
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">BUILDWE</div>
              <div className="text-[10px]" style={{ color: "var(--soft)" }}>
                <a href="/about" className="hover:underline">
                  buildwe.online · About
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="p-2.5">
            <button
              type="button"
              onClick={newChat}
              className={clsx(
                "flex w-full items-center gap-2 rounded-xl border py-2.5 text-sm font-medium",
                sidebarOpen ? "px-3" : "justify-center"
              )}
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <Plus className="h-4 w-4" style={{ color: "var(--accent)" }} />
              {sidebarOpen && "New chat"}
            </button>
          </div>

          <nav className="space-y-0.5 px-2.5 pb-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => switchMode(m.id)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-xl py-2.5 text-sm font-medium",
                    sidebarOpen ? "px-3" : "justify-center"
                  )}
                  style={
                    on
                      ? { background: "var(--accent-soft)", color: "var(--accent)" }
                      : { color: "var(--muted)" }
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {sidebarOpen && m.label}
                </button>
              );
            })}
          </nav>

          <div
            className="flex min-h-0 flex-1 flex-col border-t"
            style={{ borderColor: "var(--border)" }}
          >
            {sidebarOpen && (
              <>
                <div
                  className="px-3.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--soft)" }}
                >
                  History
                </div>
                <div className="px-2.5 pb-2">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                      style={{ color: "var(--soft)" }}
                    />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search"
                      className="h-8 w-full rounded-lg pl-8 pr-2 text-xs outline-none"
                      style={{ background: "var(--secondary)" }}
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                  {history.map((a) => {
                    const Icon =
                      MODES.find((m) => m.id === a.mode)?.icon || MessageSquare;
                    return (
                      <div
                        key={a.id}
                        className="group flex items-center rounded-lg"
                        style={
                          a.id === activeId ? { background: "var(--secondary)" } : undefined
                        }
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId(a.id);
                            setMode(a.mode === "auto" ? "chat" : a.mode);
                          }}
                          className="min-w-0 flex-1 px-2.5 py-2 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon
                              className="h-3 w-3 shrink-0"
                              style={{ color: "var(--soft)" }}
                            />
                            <span className="truncate text-[13px] font-medium">
                              {a.title}
                            </span>
                          </div>
                          <div className="truncate text-[10px]" style={{ color: "var(--soft)" }}>
                            {formatTime(a.updatedAt)}
                            {a.preview ? ` · ${a.preview.slice(0, 28)}` : ""}
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label="Delete"
                          onClick={() => deleteActivity(a.id)}
                          className="mr-1 hidden h-6 w-6 items-center justify-center rounded group-hover:flex"
                          style={{ color: "var(--soft)" }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div
          className="shrink-0 space-y-1 border-t p-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={() => openModal("settings")}
            className={clsx(
              "flex w-full items-center gap-2.5 rounded-xl py-2.5 text-sm",
              sidebarOpen ? "px-3" : "justify-center"
            )}
            style={{ color: "var(--muted)" }}
          >
            <Settings className="h-4 w-4" />
            {sidebarOpen && "Settings"}
          </button>
          {loggedIn ? (
            <>
              <button
                type="button"
                onClick={() => openModal("profile")}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-xl py-2 text-sm",
                  sidebarOpen ? "px-3" : "justify-center"
                )}
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {initials}
                </span>
                {sidebarOpen && (
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-[12px] font-medium">{userName}</span>
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                      {plan === "pro" ? "PRO" : "Free"}
                    </span>
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoggedIn(false);
                  setUserName("Guest");
                  setUserEmail("");
                  setPlan("free");
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-xl py-2 text-sm",
                  sidebarOpen ? "px-3" : "justify-center"
                )}
                style={{ color: "var(--muted)" }}
              >
                <LogOut className="h-4 w-4" />
                {sidebarOpen && "Log out"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => openModal("login")}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-xl py-2.5 text-sm font-medium",
                sidebarOpen ? "px-3" : "justify-center"
              )}
              style={{ background: "var(--ink)", color: "var(--bg)" }}
            >
              <LogIn className="h-4 w-4" />
              {sidebarOpen && "Log in"}
            </button>
          )}
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-12 shrink-0 items-center gap-2 border-b px-2.5 sm:px-4"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)",
          }}
        >
          <Btn variant="icon" className="lg:hidden" aria-label="Menu" onClick={() => setDrawer(true)}>
            <Menu className="h-5 w-5" />
          </Btn>
          <Btn
            variant="icon"
            className="hidden lg:inline-flex"
            aria-label="Toggle sidebar"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeft className="h-[18px] w-[18px]" />
            )}
          </Btn>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{meta.label}</div>
            <div className="hidden truncate text-[11px] sm:block" style={{ color: "var(--muted)" }}>
              {meta.hint}
              {plan === "pro" ? " · PRO" : " · Free"}
            </div>
          </div>
          {plan === "pro" ? (
            <button
              type="button"
              onClick={() => openModal("plans")}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "var(--ink)", color: "var(--bg)" }}
            >
              <Star className="h-3 w-3" /> PRO
            </button>
          ) : (
            <Btn size="sm" onClick={() => openModal("checkout")}>
              <Zap className="h-3.5 w-3.5" /> PRO
            </Btn>
          )}
        </header>

        {/* Workspace + fixed composer */}
        <div className="flex min-h-0 flex-1 flex-col pb-mobile-nav md:pb-0">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {/* Messages + tool panels */}
            <div
              className={clsx(
                "flex h-full",
                mode === "code" && codeFiles.length > 0 ? "flex-col lg:flex-row" : "flex-col"
              )}
            >
              {/* Conversation column */}
              <div
                className={clsx(
                  "flex min-h-0 flex-col",
                  mode === "code" && codeFiles.length > 0 && showCanvasMobile
                    ? "hidden lg:flex lg:w-[42%]"
                    : mode === "code" && codeFiles.length > 0
                      ? "flex flex-1 lg:w-[42%]"
                      : "flex flex-1"
                )}
              >
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <div className="mx-auto flex min-h-full max-w-2xl flex-col px-3 py-4 sm:px-5">
                    {(!active || active.messages.length === 0) && (
                      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                        <div
                          className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
                          style={{
                            background: "var(--card)",
                            boxShadow: "0 0 0 1px var(--border)",
                          }}
                        >
                          <meta.icon className="h-5 w-5" style={{ color: "var(--accent)" }} />
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                          {mode === "image"
                            ? "Bring your ideas to life."
                            : mode === "audio"
                              ? "Make your voice heard."
                              : mode === "code"
                                ? "Ready to build something?"
                                : mode === "auto"
                                  ? "What should we do?"
                                  : headline}
                        </h1>
                        <p className="mt-1.5 max-w-sm text-sm" style={{ color: "var(--muted)" }}>
                          {mode === "auto"
                            ? "One box. AI routes to the right tool."
                            : mode === "image"
                              ? "Turn imagination into visuals."
                              : mode === "audio"
                                ? "Natural AI audio in seconds."
                                : mode === "code"
                                  ? "Describe it. BUILDWE CODE brings it to life."
                                  : "Ask anything · create ideas · solve problems."}
                        </p>
                        <div className="mt-6 grid w-full max-w-md gap-2">
                          {(SUGGESTIONS[mode] || SUGGESTIONS.chat).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => send(s)}
                              className="rounded-xl border px-3.5 py-3 text-left text-sm"
                              style={{
                                borderColor: "var(--border)",
                                background: "var(--card)",
                              }}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {active && active.messages.length > 0 && (
                      <div className="space-y-4 pb-2">
                        {active.messages.map((m) => {
                          const isUser = m.role === "user";
                          return (
                            <div
                              key={m.id}
                              className={clsx("flex", isUser ? "justify-end" : "justify-start")}
                            >
                              <div className="max-w-[min(100%,34rem)]">
                                {!isUser && (
                                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                                    <span
                                      className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                                      style={{ background: "var(--accent)" }}
                                    >
                                      B
                                    </span>
                                    BUILDWE
                                  </div>
                                )}
                                <div
                                  className={clsx(
                                    "rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed",
                                    isUser ? "rounded-br-md" : "rounded-bl-md border",
                                    m.streaming && !isUser && "typing-caret"
                                  )}
                                  style={
                                    isUser
                                      ? { background: "var(--ink)", color: "var(--bg)" }
                                      : {
                                          background: "var(--card)",
                                          borderColor: "var(--border)",
                                        }
                                  }
                                >
                                  {isUser ? (
                                    <p className="whitespace-pre-wrap">{m.content}</p>
                                  ) : (
                                    <div
                                      className="prose-buildwe"
                                      dangerouslySetInnerHTML={{
                                        __html: roughMarkdown(m.content || ""),
                                      }}
                                    />
                                  )}
                                </div>
                                {!isUser && m.content && !m.streaming && (
                                  <div className="mt-1 flex gap-0.5">
                                    <Btn
                                      variant="icon"
                                      size="sm"
                                      aria-label="Copy"
                                      onClick={() => {
                                        navigator.clipboard.writeText(m.content);
                                        setCopiedId(m.id);
                                        setTimeout(() => setCopiedId(null), 1200);
                                      }}
                                    >
                                      {copiedId === m.id ? (
                                        <Check className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                    </Btn>
                                    <Btn
                                      variant="icon"
                                      size="sm"
                                      aria-label="Download"
                                      onClick={() =>
                                        guardedDownload(() =>
                                          downloadText("buildwe-chat.txt", m.content)
                                        )
                                      }
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </Btn>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {pendingQ && (
                          <div
                            className="rounded-2xl border p-3"
                            style={{ borderColor: "var(--border)", background: "var(--card)" }}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-sm font-semibold">Quick details</span>
                              <button
                                type="button"
                                className="text-[11px] font-medium"
                                style={{ color: "var(--accent)" }}
                                onClick={skipBuild}
                              >
                                Skip · build now
                              </button>
                            </div>
                            {pendingQ.map((q) => (
                              <label key={q} className="mb-2 block">
                                <span className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>
                                  {q}
                                </span>
                                <input
                                  value={clarify[q] || ""}
                                  onChange={(e) =>
                                    setClarify((c) => ({ ...c, [q]: e.target.value }))
                                  }
                                  className="h-10 w-full rounded-lg border px-3 text-sm outline-none"
                                  style={{
                                    borderColor: "var(--border)",
                                    background: "var(--bg)",
                                  }}
                                />
                              </label>
                            ))}
                            <Btn className="mt-1 w-full" onClick={confirmBuild} disabled={streaming}>
                              <Sparkles className="h-4 w-4" /> Build project
                            </Btn>
                          </div>
                        )}

                        {/* Inline tool previews for image/audio on mobile */}
                        {mode === "image" && activeImageId && (
                          <ImageStrip
                            images={images}
                            activeId={activeImageId}
                            setActive={setActiveImageId}
                            loading={imageLoading}
                            onFull={(u) => setFullscreenImage(u)}
                            onDownload={(img) =>
                              guardedDownload(() => {
                                const a = document.createElement("a");
                                a.href = img.url;
                                a.download = `buildwe-${img.id}.svg`;
                                a.click();
                              })
                            }
                          />
                        )}
                        {mode === "audio" && activeAudioId && (
                          <AudioPlayer
                            item={audios.find((a) => a.id === activeAudioId)}
                            progress={audioProgress}
                            onToggle={() => activeAudioId && togglePlay(activeAudioId)}
                            onRegen={() => {
                              const it = audios.find((a) => a.id === activeAudioId);
                              if (it) send(it.text);
                            }}
                            onShare={async (it) => {
                              try {
                                if (navigator.share)
                                  await navigator.share({ text: it.text, title: "BUILDWE Audio" });
                                else await navigator.clipboard.writeText(it.text);
                              } catch {
                                /* ignore */
                              }
                            }}
                            onDownload={(it) =>
                              guardedDownload(() =>
                                downloadText(`buildwe-audio.txt`, it.text)
                              )
                            }
                          />
                        )}

                        <div ref={endRef} />
                      </div>
                    )}
                  </div>
                </div>

                {/* FIXED COMPOSER — never oversized */}
                <div
                  className="shrink-0 border-t px-3 py-2 sm:px-5"
                  style={{
                    borderColor: "var(--border)",
                    background:
                      "color-mix(in srgb, var(--bg-elevated) 96%, transparent)",
                  }}
                >
                  <div className="mx-auto max-w-2xl">
                    {/* mode chips — compact */}
                    {(mode === "image" || mode === "audio") && (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        {mode === "image" &&
                          ASPECTS.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setAspect(a.id)}
                              className="rounded-lg border px-2 py-1 text-[11px] font-medium"
                              style={
                                aspect === a.id
                                  ? {
                                      borderColor: "var(--accent)",
                                      background: "var(--accent-soft)",
                                      color: "var(--accent)",
                                    }
                                  : {
                                      borderColor: "var(--border)",
                                      color: "var(--muted)",
                                    }
                              }
                            >
                              {a.label}
                            </button>
                          ))}
                        {mode === "audio" && (
                          <>
                            {(showAllVoices
                              ? VOICES
                              : VOICES.slice(0, VOICE_PREVIEW_COUNT)
                            ).map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => setVoice(v.id)}
                                title={`${v.lang} · ${v.region} · ${v.tone}`}
                                className="rounded-lg border px-2 py-1 text-[11px] font-medium"
                                style={
                                  voice === v.id
                                    ? {
                                        borderColor: "var(--accent)",
                                        background: "var(--accent-soft)",
                                        color: "var(--accent)",
                                      }
                                    : {
                                        borderColor: "var(--border)",
                                        color: "var(--muted)",
                                      }
                                }
                              >
                                {v.label}
                                {showAllVoices && (
                                  <span className="ml-1 opacity-60">{v.lang.slice(0, 2)}</span>
                                )}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setShowAllVoices((v) => !v)}
                              className="rounded-lg border px-2 py-1 text-[11px] font-semibold"
                              style={{
                                borderColor: "var(--border)",
                                color: "var(--accent)",
                              }}
                            >
                              {showAllVoices
                                ? "Show less"
                                : `Show more (+${VOICES.length - VOICE_PREVIEW_COUNT})`}
                            </button>
                            {[0.75, 1, 1.25, 1.5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setSpeed(s)}
                                className="rounded-lg border px-2 py-1 text-[11px]"
                                style={
                                  speed === s
                                    ? {
                                        borderColor: "var(--accent)",
                                        color: "var(--accent)",
                                      }
                                    : {
                                        borderColor: "var(--border)",
                                        color: "var(--muted)",
                                      }
                                }
                              >
                                {s}×
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    <div
                      className="rounded-2xl border shadow-soft"
                      style={{ borderColor: "var(--border)", background: "var(--card)" }}
                    >
                      <textarea
                        ref={taRef}
                        value={input}
                        rows={1}
                        placeholder={placeholder}
                        onChange={(e) => {
                          setInput(e.target.value);
                          growInput();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        className="max-h-[100px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 text-[15px] outline-none placeholder:opacity-50 md:max-h-[140px]"
                        style={{ color: "var(--ink)" }}
                      />
                      <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
                        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                          {MODES.map((m) => {
                            const Icon = m.icon;
                            const on = mode === m.id;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => switchMode(m.id)}
                                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium"
                                style={
                                  on
                                    ? {
                                        background: "var(--accent-soft)",
                                        color: "var(--accent)",
                                      }
                                    : { color: "var(--muted)" }
                                }
                              >
                                <Icon className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{m.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <input
                          ref={fileRef}
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onUpload(f);
                            e.target.value = "";
                          }}
                        />
                        <Btn
                          variant="icon"
                          size="sm"
                          aria-label="Upload"
                          onClick={() => fileRef.current?.click()}
                        >
                          <Paperclip className="h-4 w-4" />
                        </Btn>
                        <Btn
                          variant="icon"
                          size="sm"
                          aria-label="Voice"
                          onClick={toggleMic}
                          className={listening ? "!text-[var(--accent)]" : ""}
                        >
                          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </Btn>
                        {streaming ? (
                          <Btn
                            variant="ink"
                            className="!h-9 !w-9 !p-0"
                            aria-label="Stop"
                            onClick={stopStream}
                          >
                            <Square className="h-3.5 w-3.5 fill-current" />
                          </Btn>
                        ) : (
                          <Btn
                            className="!h-9 !w-9 !p-0"
                            aria-label="Send"
                            disabled={!input.trim()}
                            onClick={() => send()}
                          >
                            <Send className="h-4 w-4" />
                          </Btn>
                        )}
                      </div>
                    </div>
                    {mode === "code" && codeFiles.length > 0 && (
                      <button
                        type="button"
                        className="mt-1.5 text-xs font-medium lg:hidden"
                        style={{ color: "var(--accent)" }}
                        onClick={() => setShowCanvasMobile(true)}
                      >
                        Open code canvas →
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Code canvas */}
              {mode === "code" && codeFiles.length > 0 && (
                <div
                  className={clsx(
                    "min-h-0 flex-col border-l lg:flex lg:flex-1",
                    showCanvasMobile ? "flex flex-1" : "hidden lg:flex"
                  )}
                  style={{
                    background: "var(--code-bg)",
                    color: "var(--code-fg)",
                    borderColor: "transparent",
                  }}
                >
                  <div className="flex items-center gap-2 border-b border-white/10 px-2 py-2">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-xs text-white/60 lg:hidden"
                      onClick={() => setShowCanvasMobile(false)}
                    >
                      ← Back
                    </button>
                    <div className="flex rounded-lg bg-white/5 p-0.5">
                      <button
                        type="button"
                        onClick={() => setCodeView("files")}
                        className={clsx(
                          "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                          codeView === "files" ? "bg-white/15 text-white" : "text-white/50"
                        )}
                      >
                        <FolderOpen className="h-3.5 w-3.5" /> Files
                      </button>
                      <button
                        type="button"
                        onClick={() => setCodeView("slides")}
                        className={clsx(
                          "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                          codeView === "slides" ? "bg-white/15 text-white" : "text-white/50"
                        )}
                      >
                        <Presentation className="h-3.5 w-3.5" /> Slides
                      </button>
                    </div>
                    <div className="flex-1" />
                    {activeFile && codeView === "files" && (
                      <>
                        <button
                          type="button"
                          className="px-2 text-[11px] text-white/55"
                          onClick={() => {
                            navigator.clipboard.writeText(activeFile.content);
                            setCopiedId("file");
                            setTimeout(() => setCopiedId(null), 1000);
                          }}
                        >
                          {copiedId === "file" ? "Copied" : "Copy"}
                        </button>
                        <button
                          type="button"
                          className="px-2 text-[11px] text-white/55"
                          onClick={() =>
                            guardedDownload(() =>
                              downloadText(activeFile.name, activeFile.content)
                            )
                          }
                        >
                          Save
                        </button>
                      </>
                    )}
                  </div>
                  {codeView === "files" ? (
                    <div className="flex min-h-0 flex-1">
                      <div className="w-32 shrink-0 overflow-y-auto border-r border-white/10 py-1 sm:w-40">
                        {codeFiles.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setActiveFileId(f.id)}
                            className={clsx(
                              "flex w-full items-center gap-1 truncate px-2 py-2 text-left text-[12px]",
                              f.id === activeFile?.id
                                ? "bg-white/10 text-white"
                                : "text-white/55"
                            )}
                          >
                            <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                            {f.name}
                          </button>
                        ))}
                      </div>
                      <div className="min-w-0 flex-1 overflow-auto p-3">
                        <pre className="font-mono text-[12px] leading-relaxed sm:text-[13px]">
                          <code>{activeFile?.content}</code>
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
                      {slides[activeSlide] && (
                        <div className="w-full max-w-md rounded-2xl bg-gradient-to-br from-[#F8F6F1] to-[#E8E4DB] p-8 text-[#1C1C1C]">
                          <div className="text-xs font-semibold text-[#C45C26]">
                            Slide {activeSlide + 1}/{slides.length}
                          </div>
                          <h3 className="mt-2 text-2xl font-semibold">
                            {slides[activeSlide].title}
                          </h3>
                          <p className="mt-3 whitespace-pre-line text-sm text-[#444]">
                            {slides[activeSlide].body}
                          </p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={activeSlide === 0}
                          onClick={() => setActiveSlide((s) => s - 1)}
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          disabled={activeSlide >= slides.length - 1}
                          onClick={() => setActiveSlide((s) => s + 1)}
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md md:hidden"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--bg-elevated) 95%, transparent)",
            paddingBottom: "var(--safe-b)",
          }}
        >
          <div className="flex h-14">
            {MODES.filter((m) => m.id !== "auto")
              .concat(MODES.filter((m) => m.id === "auto"))
              .slice(0, 5)
              .map((m) => {
                const Icon = m.icon;
                const on = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => switchMode(m.id)}
                    className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
                    style={{ color: on ? "var(--accent)" : "var(--muted)" }}
                  >
                    <span
                      className="flex h-7 w-11 items-center justify-center rounded-full"
                      style={on ? { background: "var(--accent-soft)" } : undefined}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    {m.label}
                  </button>
                );
              })}
          </div>
        </nav>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setDrawer(false)}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-[min(100%,280px)] flex-col"
            style={{ background: "var(--bg-elevated)", paddingTop: "var(--safe-t)" }}
          >
            <div
              className="flex h-12 items-center justify-between border-b px-3"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="font-semibold">BUILDWE</span>
              <Btn variant="icon" aria-label="Close" onClick={() => setDrawer(false)}>
                <X className="h-4 w-4" />
              </Btn>
            </div>
            <div className="p-3">
              <Btn className="w-full" onClick={newChat}>
                <Plus className="h-4 w-4" /> New chat
              </Btn>
            </div>
            <nav className="space-y-0.5 px-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => switchMode(m.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium"
                    style={
                      mode === m.id
                        ? { background: "var(--accent-soft)", color: "var(--accent)" }
                        : { color: "var(--muted)" }
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {m.label}
                  </button>
                );
              })}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto border-t px-2 pt-2" style={{ borderColor: "var(--border)" }}>
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--soft)" }}>
                History
              </div>
              {history.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setActiveId(a.id);
                    setMode(a.mode === "auto" ? "chat" : a.mode);
                    setDrawer(false);
                  }}
                  className="flex w-full rounded-lg px-2.5 py-2 text-left text-[13px]"
                  style={a.id === activeId ? { background: "var(--secondary)" } : undefined}
                >
                  <span className="truncate font-medium">{a.title}</span>
                </button>
              ))}
            </div>
            <div
              className="space-y-1 border-t p-3"
              style={{
                borderColor: "var(--border)",
                paddingBottom: "calc(12px + var(--safe-b))",
              }}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
                style={{ color: "var(--muted)" }}
                onClick={() => {
                  setDrawer(false);
                  openModal("settings");
                }}
              >
                <Settings className="h-4 w-4" /> Settings
              </button>
              {loggedIn ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
                  style={{ color: "var(--muted)" }}
                  onClick={() => {
                    setLoggedIn(false);
                    setPlan("free");
                    setUserName("Guest");
                    setDrawer(false);
                  }}
                >
                  <LogOut className="h-4 w-4" /> Log out
                </button>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium"
                  style={{ background: "var(--ink)", color: "var(--bg)" }}
                  onClick={() => {
                    setDrawer(false);
                    openModal("login");
                  }}
                >
                  <LogIn className="h-4 w-4" /> Log in
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                onClick={() => {
                  setDrawer(false);
                  openModal("plans");
                }}
              >
                Plans · Free / PRO
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLANS overview — Free ↔ PRO both work */}
      {modal === "plans" && (
        <Sheet onClose={closeModal} title="Your plan" wide>
          <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
            Everyone starts on <strong style={{ color: "var(--ink)" }}>Free</strong>. PRO
            unlocks only after payment is verified.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div
              className="rounded-xl border p-4"
              style={{
                borderColor: plan === "free" ? "var(--accent)" : "var(--border)",
                background: "var(--secondary)",
              }}
            >
              <div className="text-xs font-semibold" style={{ color: "var(--soft)" }}>
                FREE {plan === "free" && "· CURRENT"}
              </div>
              <div className="mt-1 text-2xl font-semibold">$0</div>
              <ul className="mt-3 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
                <li>✓ Unlimited normal chat</li>
                <li>✓ Limited code / image / audio</li>
                <li>✓ Standard models</li>
              </ul>
              <Btn
                variant={plan === "free" ? "ghost" : "primary"}
                className="mt-4 w-full"
                size="sm"
                onClick={switchToFree}
                disabled={plan === "free"}
              >
                {plan === "free" ? "Current plan" : "Switch to Free"}
              </Btn>
            </div>
            <div
              className="rounded-xl border-2 p-4"
              style={{
                borderColor: "var(--accent)",
                background: "var(--card)",
              }}
            >
              <div className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                PRO {plan === "pro" && "· CURRENT"}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                $5<span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/mo</span>
              </div>
              <ul className="mt-3 space-y-1 text-xs">
                <li>✓ Priority models</li>
                <li>✓ No hard daily image/audio caps</li>
                <li>✓ Higher code limits</li>
                <li>✓ Faster generation</li>
              </ul>
              {plan === "pro" ? (
                <Btn variant="ghost" className="mt-4 w-full" size="sm" disabled>
                  Current plan
                </Btn>
              ) : (
                <Btn
                  className="mt-4 w-full"
                  size="sm"
                  onClick={() => openModal("checkout")}
                >
                  Switch to PRO →
                </Btn>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: "var(--soft)" }}>
            <Link href="/pricing" className="underline" onClick={closeAllModals}>
              Full pricing page
            </Link>
            <Link href="/terms" className="underline" onClick={closeAllModals}>
              Terms
            </Link>
            <Link href="/privacy" className="underline" onClick={closeAllModals}>
              Privacy
            </Link>
          </div>
        </Sheet>
      )}

      {/* CHECKOUT — amount, method, agree */}
      {modal === "checkout" && (
        <Sheet onClose={closeModal} title="Checkout · BUILDWE PRO" wide>
          <div
            className="mb-4 rounded-xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--secondary)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{checkoutInfo.planName}</div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                  Billed monthly · cancel anytime
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold">{checkoutInfo.displayAmount}</div>
                <div className="text-[10px]" style={{ color: "var(--soft)" }}>
                  ≈ $5 USD
                </div>
              </div>
            </div>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
            Payment method
          </p>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {(
              [
                ["upi", "UPI"],
                ["card", "Card"],
                ["netbanking", "NetBank"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPayMethod(id)}
                className="rounded-xl border py-2.5 text-xs font-semibold"
                style={
                  payMethod === id
                    ? {
                        borderColor: "var(--accent)",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                      }
                    : { borderColor: "var(--border)", color: "var(--muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <label className="mb-4 flex items-start gap-2 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="underline" style={{ color: "var(--accent)" }} target="_blank">
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline" style={{ color: "var(--accent)" }} target="_blank">
                Privacy Policy
              </Link>{" "}
              and authorize this PRO purchase.
            </span>
          </label>

          {checkoutError && (
            <p className="mb-3 text-xs text-red-600">{checkoutError}</p>
          )}

          <Btn className="w-full" size="lg" disabled={checkoutBusy} onClick={startCheckout}>
            {checkoutBusy ? "Processing…" : `Pay ${checkoutInfo.displayAmount} · Get PRO`}
          </Btn>
          <Btn variant="ghost" className="mt-2 w-full" onClick={closeModal}>
            ← Back
          </Btn>
          <p className="mt-3 text-center text-[10px]" style={{ color: "var(--soft)" }}>
            {checkoutInfo.demo
              ? "TEST mode — Razorpay keys go in .env (see .env.example). Demo verifies without real charge."
              : "Secured by Razorpay"}
          </p>
          <div className="mt-2 flex justify-center gap-2 text-[10px]" style={{ color: "var(--soft)" }}>
            <Shield className="h-3 w-3" /> PCI via Razorpay · No card data on BUILDWE servers
          </div>
        </Sheet>
      )}

      {modal === "login" && (
        <Sheet onClose={closeModal} title="Log in">
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            {authNext === "upload"
              ? "Log in to upload files."
              : authNext === "download"
                ? "Log in to download."
                : authNext === "pro"
                  ? "Log in to buy PRO."
                  : "Guest chat works. Log in for uploads, downloads, PRO."}
          </p>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            placeholder="you@email.com"
            className="mb-3 h-11 w-full rounded-xl border px-3 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          />
          <Btn
            className="w-full"
            size="lg"
            onClick={() => {
              const email = (loginEmail || "alex@buildwe.online").trim();
              const nice = email
                .split("@")[0]
                .replace(/[._-]/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
              setUserEmail(email);
              setUserName(nice);
              setLoggedIn(true);
              setLoginEmail("");
              const next = authNext;
              setAuthNext(null);
              if (next === "pro") openModal("checkout");
              else closeModal();
            }}
          >
            Continue
          </Btn>
          <Btn
            variant="ghost"
            className="mt-2 w-full"
            onClick={() => {
              setUserEmail("alex@buildwe.online");
              setUserName("Alex Rivera");
              setLoggedIn(true);
              const next = authNext;
              setAuthNext(null);
              if (next === "pro") openModal("checkout");
              else closeModal();
            }}
          >
            Continue with Google
          </Btn>
        </Sheet>
      )}

      {modal === "settings" && (
        <Sheet onClose={closeModal} title="Settings">
          <button
            type="button"
            onClick={() => openModal("profile")}
            className="mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left"
            style={{ borderColor: "var(--border)", background: "var(--secondary)" }}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {loggedIn ? userName : "Guest"}
              </span>
              <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                {loggedIn ? userEmail : "Tap profile"}
              </span>
            </span>
            <ChevronRight className="h-4 w-4" style={{ color: "var(--soft)" }} />
          </button>
          <Row icon={Sparkles} label="Skills" value={String(skills.length)} onClick={() => openModal("skills")} />
          <Row
            icon={CreditCard}
            label="Plan"
            value={plan === "pro" ? "PRO" : "Free"}
            onClick={() => openModal("plans")}
          />
          <div className="my-2 px-1 text-[10px] font-semibold uppercase" style={{ color: "var(--soft)" }}>
            Theme
          </div>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            {(
              [
                ["system", Monitor, "System"],
                ["light", Sun, "Light"],
                ["dark", Moon, "Dark"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setThemePref(id)}
                className="flex items-center justify-center gap-1 rounded-lg border py-2 text-[11px] font-medium"
                style={
                  themePref === id
                    ? {
                        borderColor: "var(--accent)",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                      }
                    : { borderColor: "var(--border)", color: "var(--muted)" }
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <Row icon={MessageCircle} label="Feedback" onClick={() => openModal("feedback")} />
          <Row icon={HelpCircle} label="Help" onClick={() => openModal("help")} />
          <a
            href="/about"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"
          >
            <Bot className="h-4 w-4 opacity-70" />
            <span className="flex-1">About BUILDWE</span>
            <ExternalLink className="h-3.5 w-3.5" style={{ color: "var(--soft)" }} />
          </a>
          <a
            href="/privacy"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"
          >
            <Shield className="h-4 w-4 opacity-70" />
            <span className="flex-1">Privacy</span>
            <ExternalLink className="h-3.5 w-3.5" style={{ color: "var(--soft)" }} />
          </a>
          <a
            href="/terms"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"
          >
            <FileCode2 className="h-4 w-4 opacity-70" />
            <span className="flex-1">Terms</span>
            <ExternalLink className="h-3.5 w-3.5" style={{ color: "var(--soft)" }} />
          </a>
          {loggedIn ? (
            <Row
              icon={LogOut}
              label="Log out"
              danger
              onClick={() => {
                setLoggedIn(false);
                setPlan("free");
                setUserName("Guest");
                closeAllModals();
              }}
            />
          ) : (
            <Row icon={LogIn} label="Log in" onClick={() => openModal("login")} />
          )}
        </Sheet>
      )}

      {modal === "skills" && (
        <Sheet onClose={closeModal} title="Skills">
          <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
            Add skills or a short style prompt for better answers.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSkills((p) => p.filter((x) => x !== s))}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {s} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SKILL_PRESETS.filter((s) => !skills.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSkills((p) => [...p, s])}
                className="rounded-full px-2.5 py-1 text-[11px]"
                style={{ background: "var(--secondary)", color: "var(--muted)" }}
              >
                + {s}
              </button>
            ))}
          </div>
          <textarea
            value={customSkill}
            onChange={(e) => setCustomSkill(e.target.value)}
            rows={3}
            placeholder='Custom: "Senior Next.js" or "Write like a founder"'
            className="w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          />
          <Btn
            className="mt-2 w-full"
            size="sm"
            disabled={!customSkill.trim()}
            onClick={() => {
              setSkills((p) => Array.from(new Set([...p, customSkill.trim()])));
              setCustomSkill("");
            }}
          >
            Add skill
          </Btn>
        </Sheet>
      )}

      {modal === "profile" && (
        <Sheet onClose={closeModal} title="Profile">
          {!loggedIn ? (
            <div className="space-y-3 text-center">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                You&apos;re browsing as Guest.
              </p>
              <Btn className="w-full" onClick={() => openModal("login")}>
                Log in
              </Btn>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-full text-base font-semibold"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {initials}
                </span>
                <div>
                  <div className="text-lg font-medium">{userName}</div>
                  <div className="text-sm" style={{ color: "var(--muted)" }}>
                    {userEmail}
                  </div>
                </div>
              </div>
              <div
                className="grid grid-cols-2 gap-2 rounded-xl border p-3 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--secondary)" }}
              >
                <div>
                  <div className="text-[10px] uppercase" style={{ color: "var(--soft)" }}>
                    Plan
                  </div>
                  <div className="font-medium">{plan === "pro" ? "PRO" : "Free"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase" style={{ color: "var(--soft)" }}>
                    Skills
                  </div>
                  <div className="font-medium">{skills.length}</div>
                </div>
              </div>
              <Row icon={Sparkles} label="Edit skills" onClick={() => openModal("skills")} />
              <Row
                icon={CreditCard}
                label="Change plan"
                onClick={() => openModal("plans")}
              />
            </div>
          )}
        </Sheet>
      )}

      {modal === "feedback" && (
        <Sheet onClose={closeModal} title="Feedback">
          <textarea
            rows={4}
            placeholder="What should we improve?"
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <Btn className="mt-3 w-full" onClick={closeModal}>
            Send
          </Btn>
        </Sheet>
      )}

      {modal === "help" && (
        <Sheet onClose={closeModal} title="Help">
          <div className="space-y-2 text-sm" style={{ color: "var(--muted)" }}>
            <p>
              <strong style={{ color: "var(--ink)" }}>Auto</strong> — AI picks Chat / Code /
              Image / Audio from your prompt.
            </p>
            <p>
              <strong style={{ color: "var(--ink)" }}>Free</strong> — default. Chat is free
              for normal use.
            </p>
            <p>
              <strong style={{ color: "var(--ink)" }}>PRO</strong> — pay via checkout; features
              unlock after verify.
            </p>
            <p>support@buildwe.online</p>
            <a href="/about" className="block font-medium underline" style={{ color: "var(--accent)" }}>
              About, models & policies →
            </a>
          </div>
        </Sheet>
      )}

      {fullscreenImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-3"
          onClick={() => setFullscreenImage(null)}
        >
          <button
            type="button"
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
            onClick={() => setFullscreenImage(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullscreenImage}
            alt=""
            className="max-h-full max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function ImageStrip({
  images,
  activeId,
  setActive,
  loading,
  onFull,
  onDownload,
}: {
  images: ImageGen[];
  activeId: string;
  setActive: (id: string) => void;
  loading: boolean;
  onFull: (url: string) => void;
  onDownload: (img: ImageGen) => void;
}) {
  const img = images.find((i) => i.id === activeId);
  if (!img) return null;
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="mb-2 flex gap-2">
        {img.status === "done" && (
          <>
            <Btn variant="ghost" size="sm" onClick={() => onFull(img.url)}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => onDownload(img)}>
              <Download className="h-3.5 w-3.5" />
            </Btn>
          </>
        )}
      </div>
      {img.status === "loading" || loading ? (
        <div className="shimmer h-40 rounded-xl" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.url}
          alt=""
          className="max-h-56 w-auto rounded-xl"
          onClick={() => onFull(img.url)}
        />
      )}
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {images.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setActive(i.id)}
            className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2"
            style={{
              borderColor: i.id === activeId ? "var(--accent)" : "transparent",
            }}
          >
            {i.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="shimmer h-full w-full" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function AudioPlayer({
  item,
  progress,
  onToggle,
  onRegen,
  onShare,
  onDownload,
}: {
  item?: AudioGen;
  progress: number;
  onToggle: () => void;
  onRegen: () => void;
  onShare: (i: AudioGen) => void;
  onDownload: (i: AudioGen) => void;
}) {
  if (!item) return null;
  if (item.status === "loading") {
    return (
      <div
        className="rounded-2xl border p-4 text-center text-sm"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        Synthesizing…
      </div>
    );
  }
  return (
    <div
      className="rounded-2xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <p className="text-sm leading-relaxed line-clamp-4">{item.text}</p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--ink)", color: "var(--bg)" }}
        >
          {item.playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="h-1.5 rounded-full" style={{ background: "var(--secondary)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${(item.playing ? progress : 0) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <div className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
            {formatDuration(item.duration)}
          </div>
        </div>
        <Btn variant="ghost" size="sm" onClick={onRegen} aria-label="Regenerate">
          <RefreshCw className="h-3.5 w-3.5" />
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => onShare(item)} aria-label="Share">
          <Share2 className="h-3.5 w-3.5" />
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => onDownload(item)} aria-label="Download">
          <Download className="h-3.5 w-3.5" />
        </Btn>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div
          className="flex h-[100dvh] items-center justify-center text-sm"
          style={{ background: "#F8F6F1", color: "#737373" }}
        >
          Loading BUILDWE…
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}

/* SpeechRecognition */
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};
