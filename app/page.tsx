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
  ThumbsUp,
  ThumbsDown,
  Download,
  Layers,
  Globe,
  Share2,
  FolderPlus,
  FolderOpen,
  ImagePlus,
  XCircle,
  Eye,
  KeyRound,
  Terminal,
  Printer,
  Users,
  UserPlus,
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
  sendFeedback,
  fetchModels,
  fetchSkills,
  saveSkills,
  visionApi,
  analyzeFileApi,
  createShare,
  fetchProjects,
  createProject,
  assignProject,
  deleteProjectApi,
  fetchByok,
  saveByok,
  fetchTeams,
  createTeam,
  teamInvite,
  joinTeam,
  leaveTeamApi,
  assignTeam,
  type TeamView,
  type MeResponse,
} from "@/lib/client/api";
import { ImageStudio, type StudioImage } from "@/components/workspace/ImageStudio";
import { AudioStudio } from "@/components/workspace/AudioStudio";
import { AdSlot } from "@/components/AdSlot";

type Mode = "auto" | "chat" | "code" | "image" | "audio";
type ThemePref = "system" | "light" | "dark";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  image?: string;
  sources?: { title: string; url: string; host: string }[];
};

type HistItem = {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
  preview: string;
  projectId?: string | null;
  teamId?: string | null;
  mine?: boolean;
};

type ProjectItem = { id: string; name: string; createdAt: string };

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
    "Search: latest AI news this week",
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

const VOICES: { id: string; label: string; lang: string; tone: string; tier?: "live" | "soon" }[] = [
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
  // Studio seats — Coming soon
  { id: "thomas", label: "Thomas Studio", lang: "Multi", tone: "Deep", tier: "soon" },
  { id: "priya", label: "Priya Studio", lang: "HI", tone: "Warm", tier: "soon" },
  { id: "clone", label: "Voice Clone", lang: "Custom", tone: "You", tier: "soon" },
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
  style,
  title,
  "aria-label": al,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "ink" | "icon" | "soft";
  size?: "sm" | "md" | "lg";
  className?: string;
  type?: "button" | "submit";
  style?: React.CSSProperties;
  title?: string;
  "aria-label"?: string;
}) {
  const base =
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
            : { color: "var(--muted)" };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={al}
      title={title || al}
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
      style={style ? { ...base, ...style } : base}
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
    null | "auth" | "settings" | "plans" | "profile" | "models" | "skills" | "byok" | "teams"
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
  const [images, setImages] = useState<StudioImage[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [activeImg, setActiveImg] = useState<string | null>(null);
  const [imageModelId, setImageModelId] = useState("flux");
  const [imagePrompt, setImagePrompt] = useState("");
  const [lastImagePrompt, setLastImagePrompt] = useState("");

  // audio
  const [voice, setVoice] = useState("nova");
  const [showVoices, setShowVoices] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioText, setAudioText] = useState("");
  const [lastSpoken, setLastSpoken] = useState<{ text: string; voice: string; audioUrl?: string } | null>(null);
  const [listening, setListening] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // auth form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [skillList, setSkillList] = useState<string[]>([]);
  const [modelsCatalog, setModelsCatalog] = useState<
    { id: string; name: string; blurb: string; status: string; badge?: string; family: string }[]
  >([]);

  // web search + vision attachment
  const [webSearchOn, setWebSearchOn] = useState(false);
  const [attachment, setAttachment] = useState<{ dataUrl: string; name: string } | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);

  // projects
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [convProjectId, setConvProjectId] = useState<string | null>(null);

  // teams
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [convTeamId, setConvTeamId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [teamNote, setTeamNote] = useState("");

  // canvas
  const [canvasTab, setCanvasTab] = useState<"code" | "preview">("code");

  // share
  const [shareNote, setShareNote] = useState("");
  const [projMenu, setProjMenu] = useState(false);

  // BYOK
  const [byokKeys, setByokKeys] = useState<{ groq: string | null; openrouter: string | null }>({ groq: null, openrouter: null });
  const [byokActive, setByokActive] = useState(false);
  const [byokDraft, setByokDraft] = useState({ groq: "", openrouter: "" });
  const [byokBusy, setByokBusy] = useState(false);
  const [byokNote, setByokNote] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgAttachRef = useRef<HTMLInputElement>(null);

  const meta = MODE_META.find((m) => m.id === mode)!;
  const plan = me?.plan || "free";
  const loggedIn = me?.kind === "user";

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter(
      (h) =>
        (activeTeam
          ? h.teamId === activeTeam
          : !activeProject || h.projectId === activeProject) &&
        (!q || h.title.toLowerCase().includes(q) || h.preview.toLowerCase().includes(q))
    );
  }, [history, search, activeProject, activeTeam]);

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
          projectId: (c as { projectId?: string | null }).projectId ?? null,
          teamId: (c as { teamId?: string | null }).teamId ?? null,
          mine: (c as { mine?: boolean }).mine ?? true,
        }))
      );
    } catch {
      /* */
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const p = await fetchProjects();
      setProjects(p.projects || []);
    } catch {
      /* */
    }
  }, []);

  const refreshTeams = useCallback(async () => {
    try {
      const t = await fetchTeams();
      setTeams(t.teams || []);
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    refreshMe();
    refreshHistory();
    refreshProjects();
    refreshTeams();
    fetchByok()
      .then((b) => {
        if (!b.requireAuth) {
          setByokKeys(b.keys);
          setByokActive(Boolean(b.active));
        }
      })
      .catch(() => {});
    fetchModels()
      .then((m) => setModelsCatalog(m.all || []))
      .catch(() => {});
  }, [refreshMe, refreshHistory, refreshProjects, refreshTeams]);

  const doSaveByok = async (which: "groq" | "openrouter", clear?: boolean) => {
    setByokBusy(true);
    setByokNote("");
    try {
      const payload = clear
        ? { clear: which }
        : { [which]: byokDraft[which].trim() };
      const r = await saveByok(payload as { groq?: string; openrouter?: string });
      setByokKeys(r.keys);
      setByokActive(Boolean(r.active));
      setByokDraft((d) => ({ ...d, [which]: "" }));
      setByokNote(clear ? "Key removed." : `Saved — ${which === "groq" ? "Groq" : "OpenRouter"} key is now powering your chats ⚡`);
    } catch (e) {
      setByokNote((e as Error).message);
    } finally {
      setByokBusy(false);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // invite-link auto-join: /?join=CODE
  const joinTried = useRef(false);
  useEffect(() => {
    if (joinTried.current) return;
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    joinTried.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    if (!code.trim()) return;
    joinTeam(code.trim())
      .then(({ team }) => {
        setTeams((ts) => (ts.some((t) => t.id === team.id) ? ts : [...ts, team]));
        setTeamNote(`Joined “${team.name}” ✓ — switched to team chats`);
        setActiveTeam(team.id);
      })
      .catch((e: Error) => setTeamNote(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setConvProjectId(null);
    setConvTeamId(null);
    setCanvasTab("code");
    setAttachment(null);
  };

  const openHist = async (id: string) => {
    try {
      const c = await loadConversation(id);
      setConvId(c.id);
      setMessages(
        (c.messages || [])
          .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
          .map((m: { id: string; role: string; content: string; meta?: { sources?: Msg["sources"] } }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            sources: m.meta?.sources,
          }))
      );
      setMode((c.mode as Mode) || "chat");
      setConvProjectId((c as { projectId?: string | null }).projectId ?? null);
      setConvTeamId((c as { teamId?: string | null }).teamId ?? null);
      setCanvasTab("code");
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

  const doShare = async () => {
    if (!convId) return;
    try {
      const s = await createShare(convId);
      const url = `${window.location.origin}${s.url}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareNote("Share link copied to clipboard ✓");
      } catch {
        setShareNote(url);
      }
      setTimeout(() => setShareNote(""), 4500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doAssignProject = async (projectId: string | null) => {
    setProjMenu(false);
    if (!convId) {
      setActiveProject(projectId);
      return;
    }
    try {
      await assignProject(convId, projectId);
      setConvProjectId(projectId);
      setActiveProject(projectId);
      refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doNewProject = async () => {
    setProjMenu(false);
    const name = window.prompt("Project name? (e.g. Startup site, DSA prep)");
    if (!name?.trim()) return;
    try {
      const { project } = await createProject(name.trim());
      const item: ProjectItem = { ...project, createdAt: new Date().toISOString() };
      setProjects((ps) => [...ps, item]);
      await doAssignProject(item.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doAssignTeam = async (teamId: string | null) => {
    setProjMenu(false);
    if (!convId) {
      setActiveTeam(teamId);
      setActiveProject(null);
      return;
    }
    try {
      await assignTeam(convId, teamId);
      setConvTeamId(teamId);
      setActiveTeam(teamId);
      setActiveProject(null);
      refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doNewTeam = async () => {
    const name = window.prompt("Team name? (e.g. Studio crew, College project)");
    if (!name?.trim()) return;
    try {
      const { team } = await createTeam(name.trim());
      setTeams((ts) => [...ts, team]);
      setTeamNote(`Team “${team.name}” created — invite friends with the code below.`);
    } catch (e) {
      setTeamNote((e as Error).message);
    }
  };

  const doInvite = async (teamId: string) => {
    try {
      const { code } = await teamInvite(teamId);
      const url = `${window.location.origin}/?join=${code}`;
      try {
        await navigator.clipboard.writeText(url);
        setTeamNote(`Invite link copied ✓ — share it with your team`);
      } catch {
        setTeamNote(`Invite code: ${code}`);
      }
      setTimeout(() => setTeamNote(""), 4000);
    } catch (e) {
      setTeamNote((e as Error).message);
    }
  };

  const doJoin = async () => {
    const code = joinCode.trim();
    if (!code) return;
    try {
      // accept full links or raw codes
      const raw = code.includes("join=") ? (code.split("join=")[1] || "") : code;
      const { team } = await joinTeam(raw);
      setTeams((ts) => [...ts, team]);
      setJoinCode("");
      setTeamNote(`Joined “${team.name}” ✓ — switch to it from the sidebar`);
    } catch (e) {
      setTeamNote((e as Error).message);
    }
  };

  const doLeaveTeam = async (teamId: string, name: string) => {
    if (!window.confirm(`Leave “${name}”?${teams.find((t) => t.id === teamId)?.myRole === "owner" ? " You own it — the team will be deleted." : ""}`)) return;
    try {
      await leaveTeamApi(teamId);
      setTeams((ts) => ts.filter((t) => t.id !== teamId));
      if (activeTeam === teamId) setActiveTeam(null);
      if (convTeamId === teamId) setConvTeamId(null);
      refreshHistory();
      setTeamNote("Left the team.");
    } catch (e) {
      setTeamNote((e as Error).message);
    }
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


  const runImageGenerate = async (text: string) => {
    const promptText = text.trim();
    if (!promptText || imgLoading) return;
    setError("");
    setImgLoading(true);
    setView("app");
    setMode("image");
    try {
      const img = await generateImage(promptText, aspect === "yt" ? "16:9" : aspect, {
        basePrompt: lastImagePrompt || undefined,
        modelId: imageModelId,
      });
      const row: StudioImage = {
        id: img.id,
        url: img.url,
        prompt: img.promptUsed || promptText,
        userPrompt: promptText,
        aspect,
        model: img.model,
      };
      setImages((prev) => [row, ...prev]);
      setActiveImg(img.id);
      setLastImagePrompt(img.promptUsed || promptText);
      setImagePrompt("");
      setModelTag(img.model || "BUILDWE Vision");
      refreshMe();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImgLoading(false);
    }
  };

  const runAudioGenerate = async (text?: string) => {
    const script = (text ?? audioText).trim();
    if (!script || audioBusy) return;
    setError("");
    setAudioBusy(true);
    setView("app");
    setMode("audio");
    try {
      const a = await generateAudio(script, voice, speed);

      if (a.type === "mp3" && a.audioUrl) {
        // Real MP3 back from the studio
        setLastSpoken({ text: a.text, voice, audioUrl: a.audioUrl });
        setModelTag(a.model || "BUILDWE Voice Studio");
        try {
          const au = new Audio(a.audioUrl);
          void au.play().catch(() => {
            /* autoplay blocked — user presses play */
          });
        } catch {
          /* */
        }
      } else {
        // Browser voice fallback
        setLastSpoken({ text: a.text, voice });
        setModelTag("BUILDWE Voice");
        if (typeof window !== "undefined" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(a.text);
          u.rate = speed;
          const sys = window.speechSynthesis.getVoices();
          const pref = VOICES.find((x) => x.id === voice);
          const match =
            sys.find((v) =>
              pref?.lang?.startsWith("HI")
                ? /hi|hindi/i.test(v.lang + v.name)
                : /en/i.test(v.lang)
            ) || sys[0];
          if (match) u.voice = match;
          window.speechSynthesis.speak(u);
        }
      }
      refreshMe();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAudioBusy(false);
    }
  };


  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if ((!text && !attachment) || streaming || visionBusy) return;
    setError("");
    setView("app");
    setInput("");
    if (taRef.current) taRef.current.style.height = "48px";

    let resolved: Mode = mode;
    if (mode === "auto" && !attachment) {
      try {
        const d = await detectAuto(text);
        resolved = (d.mode as Mode) || "chat";
        setMode(resolved === "auto" ? "chat" : resolved);
      } catch {
        resolved = "chat";
      }
    }

    if (resolved === "image" && !attachment) {
      await runImageGenerate(text);
      return;
    }

    if (resolved === "audio" && !attachment) {
      setAudioText(text);
      await runAudioGenerate(text);
      return;
    }

    // ── Vision flow: image attached → understand it ────────
    if (attachment) {
      const att = attachment;
      setAttachment(null);
      const vId = rid();
      const aId = rid();
      setMessages((ms) => [
        ...ms,
        {
          id: vId,
          role: "user",
          content: text || `What's in this image? (${att.name})`,
          image: att.dataUrl,
        },
        { id: aId, role: "assistant", content: "", streaming: true },
      ]);
      setVisionBusy(true);
      try {
        const v = await visionApi(att.dataUrl, text || "Describe this image in detail.");
        setMessages((ms) =>
          ms.map((m) =>
            m.id === aId ? { ...m, content: v.text, streaming: false } : m
          )
        );
        setModelTag(v.model);
        refreshMe();
        refreshHistory();
      } catch (e) {
        setError((e as Error).message);
        setMessages((ms) =>
          ms.map((m) =>
            m.id === aId
              ? { ...m, content: (e as Error).message, streaming: false }
              : m
          )
        );
      } finally {
        setVisionBusy(false);
      }
      return;
    }

    if (!text) return;

    // "search: …" prefix → auto web-search grounding
    const searchPrefix = /^(search|google|web)\s*:\s*/i.exec(text);
    const effectiveText = searchPrefix ? text.replace(searchPrefix[0], "") : text;
    const useSearch = (webSearchOn || Boolean(searchPrefix)) && resolved === "chat";

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

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let acc = "";
      await streamAI(
        endpoint,
        {
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: effectiveText },
          ],
          conversationId: convId,
          webSearch: useSearch,
          projectId: convProjectId ?? activeProject ?? null,
          teamId: convTeamId ?? activeTeam ?? null,
        },
        (ev) => {
          if (ev.meta && typeof ev.meta === "object") {
            const meta = ev.meta as {
              conversationId?: string;
              model?: string;
              live?: boolean;
              sources?: Msg["sources"];
            };
            if (meta.conversationId) setConvId(meta.conversationId);
            if (meta.model) setModelTag(String(meta.model));
            if (meta.sources?.length) {
              setMessages((ms) =>
                ms.map((m) => (m.id === aId ? { ...m, sources: meta.sources } : m))
              );
            }
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
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveProject(null)}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={!activeProject ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    All
                  </button>
                  {projects.map((p) => (
                    <span key={p.id} className="group inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => setActiveProject(p.id)}
                        className="rounded-l-full px-2 py-1 text-[10px] font-semibold"
                        style={activeProject === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${p.name}`}
                        className="rounded-r-full px-1 py-1 opacity-0 transition group-hover:opacity-100"
                        style={{ color: "var(--soft)" }}
                        onClick={async () => {
                          await deleteProjectApi(p.id);
                          setProjects((ps) => ps.filter((x) => x.id !== p.id));
                          if (activeProject === p.id) setActiveProject(null);
                          if (convProjectId === p.id) setConvProjectId(null);
                          refreshHistory();
                        }}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    aria-label="New project"
                    onClick={doNewProject}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={{ background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    <Plus className="mr-0.5 inline h-2.5 w-2.5" />Project
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => { setActiveTeam(null); setActiveProject(null); }}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={!activeTeam ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    Personal
                  </button>
                  {teams.map((t) => (
                    <span key={t.id} className="group inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => { setActiveTeam(t.id); setActiveProject(null); }}
                        className="rounded-l-full px-2 py-1 text-[10px] font-semibold"
                        style={activeTeam === t.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                      >
                        <Users className="mr-0.5 inline h-2.5 w-2.5" />{t.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Leave ${t.name}`}
                        className="rounded-r-full px-1 py-1 opacity-0 transition group-hover:opacity-100"
                        style={{ color: "var(--soft)" }}
                        onClick={() => doLeaveTeam(t.id, t.name)}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    aria-label="Teams"
                    onClick={() => setModal("teams")}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={{ background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    <UserPlus className="mr-0.5 inline h-2.5 w-2.5" />Team
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                {filteredHistory.map((h) => (
                  <div key={h.id} className="group flex items-center rounded-xl" style={h.id === convId ? { background: "var(--secondary)" } : undefined}>
                    <button type="button" onClick={() => openHist(h.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                      <div className="truncate text-[13px] font-medium">{h.mine === false && <Users className="mr-1 inline h-3 w-3" style={{ color: "var(--accent)" }} />}{h.title}</div>
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
          {sidebarOpen && plan === "free" && (
            <div className="mb-2">
              <AdSlot plan={plan} slot="sidebar" onGoPro={() => setModal("plans")} />
            </div>
          )}
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
            <div className="flex items-center gap-1.5 truncate text-sm font-semibold tracking-tight">
              <span className="truncate">{meta.label}</span>
              {activeTeam && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Users className="h-2.5 w-2.5" /> {teams.find((t) => t.id === activeTeam)?.name || "Team"}
                </span>
              )}
              {webSearchOn && (mode === "chat" || mode === "auto") ? <span className="shrink-0 text-[10px] font-medium" style={{ color: "var(--accent)" }}>· Web</span> : null}
            </div>
            <div className="hidden truncate text-[11px] sm:block" style={{ color: "var(--muted)" }}>{meta.headline}{modelTag ? ` · ${modelTag}` : ""}</div>
          </div>
          <div className="relative">
            <Btn
              variant="icon"
              size="sm"
              aria-label="Move to project"
              onClick={() => setProjMenu((v) => !v)}
              style={convProjectId ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
            >
              <FolderOpen className="h-4 w-4" />
            </Btn>
            {projMenu && (
              <>
                <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setProjMenu(false)} />
                <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border shadow-lg" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>Move chat to</div>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: !convProjectId ? "var(--accent)" : "var(--ink)" }} onClick={() => doAssignProject(null)}>
                    <FolderOpen className="h-3.5 w-3.5" /> No project
                  </button>
                  {projects.map((p) => (
                    <button key={p.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: convProjectId === p.id ? "var(--accent)" : "var(--ink)" }} onClick={() => doAssignProject(p.id)}>
                      <FolderOpen className="h-3.5 w-3.5" /> <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                  <button type="button" className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--accent)" }} onClick={doNewProject}>
                    <FolderPlus className="h-3.5 w-3.5" /> New project
                  </button>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>Shared with team</div>
                  {teams.length ? (
                    <>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: !convTeamId ? "var(--muted)" : "var(--ink)" }} onClick={() => doAssignTeam(null)}>
                        <FolderOpen className="h-3.5 w-3.5" /> Not shared
                      </button>
                      {teams.map((t) => (
                        <button key={t.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: convTeamId === t.id ? "var(--accent)" : "var(--ink)" }} onClick={() => doAssignTeam(t.id)}>
                          <Users className="h-3.5 w-3.5" /> <span className="truncate">{t.name}</span>
                          <span className="ml-auto text-[9px]" style={{ color: "var(--soft)" }}>{t.memberCount}</span>
                        </button>
                      ))}
                    </>
                  ) : (
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: "var(--accent)" }} onClick={() => { setProjMenu(false); setModal("teams"); }}>
                      <UserPlus className="h-3.5 w-3.5" /> Create / join a team
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {convId && !!messages.length && (
            <Btn variant="icon" size="sm" aria-label="Share chat" title="Copy public share link" onClick={doShare}>
              <Share2 className="h-4 w-4" />
            </Btn>
          )}
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
          {error && (mode === "image" || mode === "audio") && (
            <div className="px-4 py-2 text-center text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{error}</div>
          )}
          {mode === "image" ? (
            <ImageStudio
              images={images}
              activeId={activeImg}
              setActiveId={setActiveImg}
              loading={imgLoading}
              aspect={aspect}
              setAspect={setAspect}
              modelId={imageModelId}
              setModelId={setImageModelId}
              prompt={imagePrompt}
              setPrompt={setImagePrompt}
              lastPrompt={lastImagePrompt}
              onGenerate={(text) => runImageGenerate(text)}
            />
          ) : mode === "audio" ? (
            <AudioStudio
              text={audioText}
              setText={setAudioText}
              voice={voice}
              setVoice={setVoice}
              speed={speed}
              setSpeed={setSpeed}
              voices={VOICES}
              loading={audioBusy}
              lastSpoken={lastSpoken}
              onGenerate={() => runAudioGenerate()}
            />
          ) : (
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
                      <div className="mt-4 w-full max-w-md">
                        <AdSlot plan={plan} slot="chat-empty" onGoPro={() => setModal("plans")} />
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
                                {isUser && m.image && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={m.image} alt="attachment" className="mb-2 max-h-56 w-auto rounded-2xl object-contain" />
                                )}
                                {isUser ? (
                                  <p className="whitespace-pre-wrap">{m.content}</p>
                                ) : (
                                  <div className="prose-bw" dangerouslySetInnerHTML={{ __html: md(m.content || "") }} />
                                )}
                                {!isUser && !!m.sources?.length && !m.streaming && (
                                  <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--soft)" }}>Sources</span>
                                    {m.sources.slice(0, 5).map((s, si) => (
                                      <a
                                        key={si}
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={s.title}
                                        className="rounded-full px-2 py-0.5 text-[10px] font-medium transition hover:opacity-80"
                                        style={{ background: "var(--secondary)", color: "var(--muted)" }}
                                      >
                                        [{si + 1}] {s.host}
                                      </a>
                                    ))}
                                  </div>
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
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Good reply"
                                    onClick={async () => {
                                      await sendFeedback("up", "helpful and on-topic");
                                      setCopied("up-" + m.id);
                                      setTimeout(() => setCopied(null), 1000);
                                    }}
                                  >
                                    <ThumbsUp className="h-3.5 w-3.5" />
                                  </Btn>
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Bad reply"
                                    onClick={async () => {
                                      await sendFeedback("down", "missed my message or too generic");
                                      setCopied("down-" + m.id);
                                      setTimeout(() => setCopied(null), 1000);
                                    }}
                                  >
                                    <ThumbsDown className="h-3.5 w-3.5" />
                                  </Btn>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

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

                  <div className="rounded-3xl border shadow-sm" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    {attachment && (
                      <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border p-2" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={attachment.dataUrl} alt={attachment.name} className="h-12 w-12 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{attachment.name}</div>
                          <div className="text-[10px]" style={{ color: "var(--muted)" }}>Image attached — ask anything about it</div>
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
                      placeholder={
                        mode === "auto"
                          ? "What are we making?"
                          : mode === "code"
                            ? "Describe the build…"
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
                      <input ref={fileRef} type="file" className="hidden" accept="text/*,.md,.json,.js,.ts,.tsx,.py,.css,.html,.csv" onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const t = await f.text();
                        try {
                          const a = await analyzeFileApi(f.name, t);
                          setInput((v) => (v ? v + "\n\n" : "") + `[Attached file: ${f.name}]\n${a.summary}\n\nMy question: `);
                        } catch {
                          setInput((v) => (v ? v + "\n\n" : "") + `[File: ${f.name}]\n${t.slice(0, 8000)}`);
                        }
                        e.target.value = "";
                        requestAnimationFrame(grow);
                      }} />
                      <input ref={imgAttachRef} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 5 * 1024 * 1024) {
                          setError("Image too large — keep it under 5 MB.");
                          e.target.value = "";
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          setAttachment({ dataUrl: String(reader.result), name: f.name });
                          setMode((m) => (m === "image" || m === "audio" ? "chat" : m));
                        };
                        reader.readAsDataURL(f);
                        e.target.value = "";
                      }} />
                      {(mode === "chat" || mode === "auto") && (
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
                      <Btn variant="icon" size="sm" aria-label="Attach image" title="Attach image — AI vision" onClick={() => imgAttachRef.current?.click()}><ImagePlus className="h-4 w-4" /></Btn>
                      <Btn variant="icon" size="sm" aria-label="Upload file" title="Attach text/CSV file" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Btn>
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
                      {streaming || imgLoading || audioBusy || visionBusy ? (
                        <Btn variant="ink" className="!h-10 !w-10 !p-0" aria-label="Stop" onClick={stop}><Square className="h-3.5 w-3.5 fill-current" /></Btn>
                      ) : (
                        <Btn className="!h-10 !w-10 !p-0" aria-label="Send" disabled={!input.trim() && !attachment} onClick={() => send()}>
                          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Btn>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-center text-[10px]" style={{ color: "var(--soft)" }}>
                    {me?.kind === "guest" ? "Browsing free · sign in to sync across devices" : me?.user?.email}
                    {plan === "free" ? " · Free plan" : " · PRO"}
                    {byokActive ? " · Own key ⚡" : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* code canvas + live preview */}
            {mode === "code" && (
              <div className="hidden min-h-0 flex-1 flex-col lg:flex" style={{ background: "var(--code-bg)", color: "var(--code-fg)" }}>
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCanvasTab("code")}
                      className={clsx("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium", canvasTab === "code" ? "bg-white/15 text-white" : "text-white/45 hover:bg-white/10")}
                    >
                      <FileCode2 className="h-3.5 w-3.5" /> Code · {codeLang}
                    </button>
                    {/html|xml/.test(codeLang) || /^\s*<!doctype html/i.test(codePanel) ? (
                      <button
                        type="button"
                        onClick={() => setCanvasTab(canvasTab === "code" ? "preview" : "code")}
                        className={clsx("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium", canvasTab === "preview" ? "bg-white/15 text-white" : "text-white/45 hover:bg-white/10")}
                      >
                        <Eye className="h-3.5 w-3.5" /> Preview
                      </button>
                    ) : null}
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
                {canvasTab === "preview" ? (
                  <iframe
                    title="Live preview"
                    sandbox="allow-scripts"
                    srcDoc={codePanel}
                    className="flex-1 bg-white"
                  />
                ) : (
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="font-mono text-[13px] leading-relaxed"><code>{codePanel}</code></pre>
                  </div>
                )}
              </div>
            )}
          </div>
          )}
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

      {shareNote && (
        <div className="fixed inset-x-0 bottom-[72px] z-[60] flex justify-center px-4 md:bottom-6">
          <div
            className="max-w-full truncate rounded-full border px-4 py-2 text-xs font-medium shadow-lg"
            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--ink)" }}
          >
            {shareNote}
          </div>
        </div>
      )}

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
              <button type="button" onClick={() => setModal("models")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Layers className="h-4 w-4 opacity-70" /> Models <span className="ml-auto text-[10px]" style={{ color: "var(--soft)" }}>Live + Soon</span></button>
              <button type="button" onClick={async () => { try { const s = await fetchSkills(); setSkillList(s.skills || []); } catch {} setModal("skills"); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Sparkles className="h-4 w-4 opacity-70" /> Skills &amp; Mind</button>
              <button type="button" onClick={() => {
                const md = messages.map(m => `## ${m.role}\n\n${m.content}`).join('\n\n');
                const blob = new Blob([md || '# Empty chat'], { type: 'text/markdown' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'buildwe-chat.md';
                a.click();
              }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Download className="h-4 w-4 opacity-70" /> Export chat</button>
              <button type="button" onClick={() => {
                try {
                  sessionStorage.setItem("bw_print", JSON.stringify({
                    title: filteredHistory.find((h) => h.id === convId)?.title || "BUILDWE chat",
                    messages: messages.map((m) => ({ role: m.role, content: m.content })),
                  }));
                  window.open("/print", "_blank");
                } catch {
                  /* */
                }
              }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Printer className="h-4 w-4 opacity-70" /> Print / PDF</button>
              <button type="button" onClick={() => setModal("byok")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><KeyRound className="h-4 w-4 opacity-70" /> API keys <span className="ml-auto text-[10px] font-semibold" style={{ color: byokActive ? "var(--accent)" : "var(--soft)" }}>{byokActive ? "Own key ⚡" : "BYOK"}</span></button>
              <button type="button" onClick={() => setModal("teams")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Users className="h-4 w-4 opacity-70" /> Teams <span className="ml-auto text-[10px] font-semibold" style={{ color: teams.length ? "var(--accent)" : "var(--soft)" }}>{teams.length ? `${teams.length} active` : "Share chats"}</span></button>
              <a href="/developers" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Terminal className="h-4 w-4 opacity-70" /> Developer API <ExternalLink className="ml-auto h-3.5 w-3.5" style={{ color: "var(--soft)" }} /></a>
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

      {modal === "models" && (
        <Sheet onClose={() => setModal(null)} title="Models" wide>
          <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
            Free models are live. Premium seats are reserved — Coming soon when enabled.
          </p>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {(modelsCatalog.length ? modelsCatalog : [
              { id: '1', name: 'BUILDWE AI', blurb: 'Everyday chat', status: 'live', badge: 'Free', family: 'chat' },
              { id: '2', name: 'GPT-class seat', blurb: 'Premium chat seat', status: 'coming_soon', badge: 'Soon', family: 'chat' },
            ]).map((m) => (
              <div key={m.id} className="rounded-2xl border px-3 py-3" style={{ borderColor: "var(--border)", background: m.status === 'live' ? 'var(--card)' : 'var(--secondary)' }}>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{m.name}</div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: m.status === 'live' ? 'var(--accent-soft)' : 'var(--border)', color: m.status === 'live' ? 'var(--accent)' : 'var(--muted)' }}>{m.badge || m.status}</span>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{m.blurb}</p>
                <div className="mt-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--soft)" }}>{m.family} · {m.status === 'live' ? 'Available now' : 'Coming soon'}</div>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {modal === "skills" && (
        <Sheet onClose={() => setModal(null)} title="Skills & Mind">
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Custom instructions help BUILDWE answer more like you need — language, role, tone. Feedback 👍👎 also trains Mind.
          </p>
          {!loggedIn && (
            <p className="mb-3 text-xs" style={{ color: "var(--accent)" }}>Sign in to save Skills across sessions.</p>
          )}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {skillList.map((s) => (
              <button key={s} type="button" onClick={() => setSkillList((x) => x.filter((i) => i !== s))} className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{s} ×</button>
            ))}
          </div>
          <textarea value={skillDraft} onChange={(e) => setSkillDraft(e.target.value)} rows={3} placeholder={'e.g. "Reply in Hinglish" · "I am a beginner in TypeScript" · "Be concise"'} className="w-full resize-none rounded-2xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
          <div className="mt-2 flex gap-2">
            <Btn size="sm" variant="ghost" onClick={() => { if (!skillDraft.trim()) return; setSkillList((x) => Array.from(new Set(x.concat([skillDraft.trim()]))).slice(0, 16)); setSkillDraft(""); }}>Add</Btn>
            <Btn size="sm" disabled={!loggedIn} onClick={async () => { try { await saveSkills(skillList); setModal(null); await refreshMe(); } catch (e) { setError((e as Error).message); } }}>Save Mind</Btn>
          </div>
        </Sheet>
      )}

      {modal === "byok" && (
        <Sheet onClose={() => setModal(null)} title="Your API keys">
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Bring your own key — your chats run on <strong>your</strong> free Groq / OpenRouter account. Keys are AES-encrypted server-side and never shown again.
          </p>
          {!loggedIn && (
            <p className="mb-3 text-xs" style={{ color: "var(--accent)" }}>Sign in to save keys across sessions.</p>
          )}
          {(["groq", "openrouter"] as const).map((which) => (
            <div key={which} className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold">{which === "groq" ? "Groq (fast, free tier)" : "OpenRouter (fallback)"}</span>
                {byokKeys[which] && (
                  <span className="inline-flex items-center gap-1.5">
                    <code className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: "var(--secondary)", color: "var(--muted)" }}>{byokKeys[which]}</code>
                    <button type="button" className="text-[10px] font-semibold text-red-600" onClick={() => doSaveByok(which, true)} disabled={byokBusy}>remove</button>
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={byokDraft[which]}
                  onChange={(e) => setByokDraft((d) => ({ ...d, [which]: e.target.value }))}
                  placeholder={which === "groq" ? "gsk_…" : "sk-or-…"}
                  type="password"
                  className="h-10 flex-1 rounded-2xl border px-3 text-sm outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                />
                <Btn size="sm" disabled={!loggedIn || byokBusy || byokDraft[which].trim().length < 20} onClick={() => doSaveByok(which)}>
                  {byokBusy ? "Saving…" : "Save"}
                </Btn>
              </div>
            </div>
          ))}
          {byokNote && <p className="text-xs" style={{ color: "var(--accent)" }}>{byokNote}</p>}
          <p className="mt-3 text-[11px]" style={{ color: "var(--soft)" }}>
            Get a free Groq key at console.groq.com → API Keys. It powers Chat, Code, and Vision for your account only.
          </p>
        </Sheet>
      )}

      {modal === "teams" && (
        <Sheet onClose={() => setModal(null)} title="Team workspaces">
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Share chats with your crew — a team chat is visible to every member. Switch teams from the sidebar chips.
          </p>
          {!loggedIn && (
            <p className="mb-3 text-xs" style={{ color: "var(--accent)" }}>Sign in to create or join teams.</p>
          )}

          <div className="space-y-1.5">
            {teams.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl border px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Users className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                    {t.memberCount} member{t.memberCount > 1 ? "s" : ""} · you are {t.myRole}
                  </div>
                </div>
                <Btn variant="icon" size="sm" aria-label="Invite" title="Copy invite link" onClick={() => doInvite(t.id)}><UserPlus className="h-3.5 w-3.5" /></Btn>
                <Btn variant="icon" size="sm" aria-label="Leave team" title="Leave team" onClick={() => doLeaveTeam(t.id, t.name)}><LogOut className="h-3.5 w-3.5" /></Btn>
              </div>
            ))}
            {!teams.length && loggedIn && (
              <p className="text-xs" style={{ color: "var(--soft)" }}>No teams yet — create one or join with a code.</p>
            )}
          </div>

          {teamNote && <p className="mt-2 text-xs" style={{ color: "var(--accent)" }}>{teamNote}</p>}

          <div className="mt-4 flex gap-2">
            <Btn size="sm" disabled={!loggedIn} onClick={doNewTeam}><Plus className="h-3.5 w-3.5" /> Create team</Btn>
          </div>

          <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>Join with invite code</div>
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. 7F3A9C2B or invite link"
                className="h-10 flex-1 rounded-2xl border px-3 text-sm outline-none"
                style={{ borderColor: "var(--border)", background: "var(--bg)" }}
              />
              <Btn size="sm" disabled={!loggedIn || !joinCode.trim()} onClick={doJoin}>Join</Btn>
            </div>
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
