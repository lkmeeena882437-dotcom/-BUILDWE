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
  LogOut,
  LogIn,
  CreditCard,
  Star,
  PanelLeftClose,
  PanelLeft,
  Bot,
  Shield,
  ExternalLink,
  ArrowRight,
  FileCode2,
  Loader2,
  ArrowRightLeft,
  RotateCcw,
  Play,
  FlaskConical,
  Wrench,
  LayoutGrid,
  Recycle,
  SquarePen,
  ThumbsUp,
  ThumbsDown,
  Download,
  Layers,
  Share2,
  FolderPlus,
  FolderOpen,
  Eye,
  KeyRound,
  Terminal,
  Printer,
  Users,
  UserPlus,
  Chrome,
  Github,
  HelpCircle,
  AlertTriangle,
  Wand2,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import {
  detectAuto,
  deleteHistory,
  fetchHistory,
  fetchGenerations,
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
  verifyApi,
  compareApi,
  codeActionApi,
  runAgentApi,
  type AgentEvent as AgentEv,
  fetchProjectFiles,
  readProjectFile,
  saveProjectFileApi,
  deleteProjectFileApi,
  type ProjectFileMeta,
  type TeamView,
  type MeResponse,
} from "@/lib/client/api";
import { ImageStudio, type StudioImage } from "@/components/workspace/ImageStudio";
import { AudioStudio } from "@/components/workspace/AudioStudio";
import { AdSlot } from "@/components/AdSlot";
import { renderSafeMarkdown } from "@/lib/safe-md";
import { useProPrice } from "@/components/billing/useProPrice";
import { WalletChip, openCredits, useWallet } from "@/components/billing/CreditsUI";
import { PromptBar } from "@/components/workspace/PromptBar";
import { Btn } from "@/lib/ui/Btn";
import { MODE_META, type Mode } from "@/lib/client/modes";
import { ProfileFlyout } from "@/components/workspace/ProfileFlyout";
import { SegmentedControl } from "@/lib/ui/SegmentedControl";
import { THEME_ITEMS, type ThemePref } from "@/lib/client/theme";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  image?: string;
  sources?: { title: string; url: string; host: string }[];
  understood?: string;
  clarifier?: string;
  quality?: { label: "good" | "review"; notes: string[] };
  fallbackNote?: string;
  /** true when the reply came from offline mode (no live provider reached) */
  offline?: boolean;
  recovery?: {
    text: string;
    mode: "chat" | "code";
    useSearch: boolean;
    altModel?: number;
    code?: string;
    hint?: string;
  };
  verified?: {
    verdict: string;
    message: string;
    claims: { claim: string; kind: string; verdict: string; source?: { title: string; url: string; host: string; official?: boolean } }[];
  };
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
  // Shared hardened renderer (audit C2): the inline version escaped `& < >`
  // but not quotes, so a fence label or a link target could close an
  // attribute and run script in every reader's browser.
  return renderSafeMarkdown(text);
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
    null | "auth" | "settings" | "plans" | "profile" | "models" | "skills" | "byok" | "teams" | "compare"
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
  /** past voice generations restored from the server (Update #1 §4.5) */
  const [audioHistory, setAudioHistory] = useState<
    { id: string; text: string; voice: string; createdAt: string }[]
  >([]);
  const [imgLoading, setImgLoading] = useState(false);
  // Generation-job failure state, kept per studio so a failed image job shows
  // its own retry affordance instead of only a transient global error strip.
  const [imgFailure, setImgFailure] = useState<string | null>(null);
  const [imgLastPrompt, setImgLastPrompt] = useState("");
  const [audioFailure, setAudioFailure] = useState<string | null>(null);
  const [audioLastScript, setAudioLastScript] = useState("");
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
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [skillList, setSkillList] = useState<string[]>([]);
  const [modelsCatalog, setModelsCatalog] = useState<
    { id: string; name: string; blurb: string; status: string; badge?: string; family: string }[]
  >([]);

  // web search + vision attachment
  const [webSearchOn, setWebSearchOn] = useState(false);
  const [comparePrompt, setComparePrompt] = useState("");
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareResult, setCompareResult] = useState<Awaited<ReturnType<typeof compareApi>> | null>(null);
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
  const [canvasTab, setCanvasTab] = useState<"code" | "preview" | "files">("code");
  // Project files panel (Update #1 §3.1/§3.6 — the API existed, the UI didn't)
  const [projFiles, setProjFiles] = useState<ProjectFileMeta[]>([]);
  const [projFilesBusy, setProjFilesBusy] = useState(false);
  const [projFilesErr, setProjFilesErr] = useState("");
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [newFilePath, setNewFilePath] = useState("");
  // Coding Agent run state — the agent works autonomously, so the user needs
  // to see each step as it happens rather than a single opaque spinner.
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<
    { label: string; ok?: boolean; kind: "step" | "tool" | "check" | "msg" | "error" }[]
  >([]);
  const [agentResult, setAgentResult] = useState<{
    ok: boolean;
    summary: string;
    filesChanged: string[];
    verified: boolean;
  } | null>(null);
  const agentAbort = useRef<AbortController | null>(null);
  const [canvasVersions, setCanvasVersions] = useState<
    { ts: number; code: string; lang: string }[]
  >([]);
  const [canvasActionBusy, setCanvasActionBusy] = useState<string | null>(null);
  const [canvasConsole, setCanvasConsole] = useState<{
    kind: "run" | "test" | "note";
    ok: boolean;
    text: string;
  } | null>(null);
  const [verMenu, setVerMenu] = useState(false);

  // response style (human-language controls)
  const [depth, setDepth] = useState<"short" | "balanced" | "detailed" | "deep">("balanced");
  const [tone, setTone] = useState<"simple" | "standard" | "expert">("standard");
  const [streamPhase, setStreamPhase] = useState("");
  const lastPrompt = useRef("");
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // share
  const [shareNote, setShareNote] = useState("");
  const [projMenu, setProjMenu] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);

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
  // one shared wallet read (module-level cache in CreditsUI) - the pill needs the
  // server's own message ceiling for its counter, nothing more.
  const wallet = useWallet();
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

  /**
   * Restore past image/audio creations (Update #1 §4.5).
   * These were always saved server-side, but the studios started empty on
   * every reload, so a user's own gallery looked lost. Purely additive:
   * restored rows sit behind anything made in the current session.
   */
  const refreshGenerations = useCallback(async () => {
    try {
      const [imgs, auds] = await Promise.all([
        fetchGenerations("image", 30),
        fetchGenerations("audio", 30),
      ]);

      const restored: StudioImage[] = imgs
        // vision analyses are stored as type "image" too — those have no URL
        .filter((g) => Boolean(g.outputUrl))
        .map((g) => ({
          id: g.id,
          url: g.outputUrl as string,
          prompt: g.prompt,
          userPrompt: String(
            (g.meta as { userPrompt?: string } | undefined)?.userPrompt || g.prompt
          ),
          aspect: String((g.meta as { aspect?: string } | undefined)?.aspect || "1:1"),
          model: String((g.meta as { model?: string } | undefined)?.model || "BUILDWE Vision"),
        }));

      if (restored.length) {
        setImages((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...restored.filter((r) => !seen.has(r.id))];
        });
      }
      setAudioHistory(
        auds.map((g) => ({
          id: g.id,
          text: g.outputText || g.prompt,
          voice: String((g.meta as { voice?: string } | undefined)?.voice || "nova"),
          createdAt: g.createdAt,
        }))
      );
    } catch {
      /* history is a bonus — never block the workspace */
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
    refreshGenerations();
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
  }, [refreshMe, refreshHistory, refreshGenerations, refreshProjects, refreshTeams]);

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

  // OAuth redirects: /?oauth=setup|failed|unknown or /?welcome=1
  const oauthTried = useRef(false);
  useEffect(() => {
    if (oauthTried.current) return;
    oauthTried.current = true;
    const q = new URLSearchParams(window.location.search);
    const oauth = q.get("oauth");
    if (q.get("welcome")) {
      window.history.replaceState({}, "", window.location.pathname);
      refreshMe();
      setTeamNote("Logged in ✓ — welcome to your workspace");
      setTimeout(() => setTeamNote(""), 3500);
      return;
    }
    if (!oauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    setAuthTab("login");
    setModal("auth");
    setAuthNotice(
      oauth === "setup"
        ? "Social sign-in needs provider keys on the server — use email for now (it works great)."
        : "Sign-in with that provider didn't complete. Try again or use email."
    );
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
          .map((m: { id: string; role: string; content: string; meta?: { sources?: Msg["sources"]; understood?: string; qualityLabel?: "good" | "review" } }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            sources: m.meta?.sources,
            understood: m.meta?.understood,
            ...(m.meta?.qualityLabel ? { quality: { label: m.meta.qualityLabel, notes: [] } } : {}),
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
          pushCanvasVersion(blocks[blocks.length - 1].code, blocks[blocks.length - 1].lang);
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

  const streamPhaseRef = useRef("");

  const doVerify = async (m: Msg) => {
    if (verifying) return;
    setVerifying(m.id);
    try {
      const v = await verifyApi(m.content);
      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, verified: v } : x)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifying(null);
    }
  };

  const doCompare = async () => {
    const p = comparePrompt.trim();
    if (!p || compareBusy) return;
    setCompareBusy(true);
    setError("");
    try {
      const r = await compareApi(p);
      setCompareResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCompareBusy(false);
    }
  };

  const openCompare = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    setComparePrompt(input.trim() || lastUser.slice(0, 500));
    setCompareResult(null);
    setModal("compare");
  };

  const pushCanvasVersion = (code: string, lang: string) => {
    setCanvasVersions((vs) => {
      if (vs.length && vs[0].code === code) return vs;
      return [{ ts: Date.now(), code, lang }, ...vs].slice(0, 12);
    });
  };

  // ── Code Canvas actions (Update #1 P1 #8 — v1.7.0) ──────
  // Sandboxed JS run: Web Worker + console capture, 3s timeout,
  // no DOM, no network. User code NEVER runs on the server.
  const runInSandbox = (js: string, timeoutMs = 3000) =>
    new Promise<{ ok: boolean; logs: string[]; error?: string }>((resolve) => {
      const src = `
        const __logs = [];
        const __fmt = (a) => {
          if (typeof a === "object" && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
          return String(a);
        };
        console.log = (...a) => __logs.push(a.map(__fmt).join(" "));
        console.info = console.warn = console.error = console.log;
        console.assert = (c, ...a) => __logs.push((c ? "PASS ✓ " : "FAIL ✗ ") + a.map(__fmt).join(" "));
        try {
          ${js}
          postMessage({ ok: true, logs: __logs.slice(0, 200) });
        } catch (e) {
          postMessage({ ok: false, logs: __logs.slice(0, 200), error: String(e) });
        }
      `;
      let blobUrl: string | null = null;
      try {
        blobUrl = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
        const w = new Worker(blobUrl);
        const t = setTimeout(() => {
          w.terminate();
          resolve({ ok: false, logs: [], error: "Timeout (3s) — infinite loop ya bahut slow code lagta hai." });
        }, timeoutMs);
        w.onmessage = (ev) => {
          clearTimeout(t);
          w.terminate();
          resolve(ev.data as { ok: boolean; logs: string[]; error?: string });
        };
        w.onerror = (ev) => {
          clearTimeout(t);
          w.terminate();
          resolve({ ok: false, logs: [], error: (ev as ErrorEvent).message || "Runtime error" });
        };
      } catch (e) {
        resolve({ ok: false, logs: [], error: (e as Error).message });
      } finally {
        if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl!), 5000);
      }
    });

  const runCanvasAction = async (
    action: "run" | "test" | "fix" | "optimize" | "refactor"
  ) => {
    if (canvasActionBusy) return;
    const code = codePanel;
    if (!code.trim() || code.startsWith("// generated code")) {
      setCanvasConsole({
        kind: "note",
        ok: false,
        text: "Canvas me abhi koi code nahi hai — chat me kuch likho jaise 'landing page banao', code yahan aa jayega.",
      });
      return;
    }

    const isHtml =
      /html|xml/.test(codeLang) ||
      /^\s*<!doctype html/i.test(code) ||
      /<html[\s>]/i.test(code);
    const isJs = /javascript|js|typescript|ts/.test(codeLang) && !isHtml;
    const stripModules = (s: string) => s.replace(/^\s*(import|export)\b.*$/gm, "");

    // RUN — always client-side, never on the server
    if (action === "run") {
      if (isHtml) {
        setCanvasTab("preview");
        setCanvasConsole({ kind: "run", ok: true, text: "Preview khul gaya — live result dekho. (Scripts sandboxed hain.)" });
        return;
      }
      if (isJs) {
        setCanvasConsole({ kind: "run", ok: true, text: "Chal raha hai… (sandboxed worker)" });
        const r = await runInSandbox(stripModules(code));
        setCanvasConsole({
          kind: "run",
          ok: r.ok,
          text: [
            ...(r.logs?.length ? r.logs : ["(koi output nahi — code me console.log() use karo)"]),
            ...(r.error ? ["❌ " + r.error] : []),
          ].join("\n"),
        });
        return;
      }
      setCanvasConsole({
        kind: "note",
        ok: false,
        text: `${codeLang} browser me run nahi hota. HTML/JS yahan chalte hain — Save dabao aur file apne system me chalao.`,
      });
      return;
    }

    // FIX / OPTIMIZE / REFACTOR / TEST — live model actions
    setCanvasActionBusy(action);
    setCanvasConsole({ kind: "note", ok: true, text: `${action === "test" ? "Tests" : action} chal raha hai…` });
    try {
      const r = await codeActionApi(code, codeLang, action);
      if (r.available === false) {
        setCanvasConsole({ kind: "note", ok: false, text: r.message || "Live model chahiye." });
        return;
      }
      if (action === "test") {
        const testCode = r.code || "";
        if (testCode && isJs) {
          setCanvasConsole({ kind: "test", ok: true, text: "Tests ban gaye — sandbox me chal raha hai…" });
          const run = await runInSandbox(stripModules(code) + "\n;\n" + stripModules(testCode), 5000);
          setCanvasConsole({
            kind: "test",
            ok: run.ok,
            text: [r.notes || "", "— test run (sandboxed browser worker) —", ...(run.logs || []), ...(run.error ? ["❌ " + run.error] : [])]
              .filter(Boolean)
              .join("\n"),
          });
        } else {
          setCanvasConsole({
            kind: "test",
            ok: true,
            text: [r.notes, testCode || r.raw || ""].filter(Boolean).join("\n\n"),
          });
        }
        return;
      }
      if (r.code) {
        setCodePanel(r.code);
        pushCanvasVersion(r.code, codeLang);
        setCanvasConsole({
          kind: "note",
          ok: true,
          text: `✓ ${r.title} applied${r.notes ? " — " + r.notes : ""}\n(Purana version History me safe hai — wapas jaa sakte ho)`,
        });
      } else {
        setCanvasConsole({ kind: "note", ok: false, text: r.raw || "Model ne code block nahi diya — dobara try karo." });
      }
    } catch (e) {
      const err = e as Error & { hint?: string };
      setCanvasConsole({ kind: "note", ok: false, text: err.message + (err.hint ? "\nTip: " + err.hint : "") });
    } finally {
      setCanvasActionBusy(null);
    }
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
    setImgFailure(null);
    setImgLastPrompt(promptText);
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
      const msg = (e as Error).message || "Image generation failed.";
      setError(msg);
      setImgFailure(msg);
    } finally {
      setImgLoading(false);
    }
  };

  const runAudioGenerate = async (text?: string) => {
    const script = (text ?? audioText).trim();
    if (!script || audioBusy) return;
    setError("");
    setAudioFailure(null);
    setAudioLastScript(script);
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
      const msg = (e as Error).message || "Voice generation failed.";
      setError(msg);
      setAudioFailure(msg);
    } finally {
      setAudioBusy(false);
    }
  };



  /* ── Project files (Coding Agent workspace) ─────────────── */

  const currentProjectId = convProjectId ?? activeProject ?? null;

  const loadProjFiles = useCallback(async () => {
    if (!currentProjectId) {
      setProjFiles([]);
      return;
    }
    setProjFilesBusy(true);
    setProjFilesErr("");
    try {
      setProjFiles(await fetchProjectFiles(currentProjectId));
    } catch (e) {
      setProjFilesErr((e as Error).message || "Couldn't load project files.");
    } finally {
      setProjFilesBusy(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (canvasTab === "files") void loadProjFiles();
  }, [canvasTab, loadProjFiles]);

  const openProjFile = async (id: string) => {
    setProjFilesErr("");
    try {
      const f = await readProjectFile(id);
      setCodePanel(f.content);
      setCodeLang(f.lang || "text");
      setOpenFileId(id);
      setCanvasTab("code");
    } catch (e) {
      setProjFilesErr((e as Error).message || "Couldn't open that file.");
    }
  };

  const saveCanvasToFile = async (path?: string) => {
    if (!currentProjectId) {
      setProjFilesErr("Pick a project first — files are saved inside a project.");
      return;
    }
    const target =
      path ||
      projFiles.find((f) => f.id === openFileId)?.path ||
      newFilePath.trim();
    if (!target) {
      setProjFilesErr("Give the file a name, e.g. index.html");
      return;
    }
    setProjFilesBusy(true);
    setProjFilesErr("");
    try {
      await saveProjectFileApi({
        projectId: currentProjectId,
        path: target,
        content: codePanel,
        lang: codeLang,
      });
      setNewFilePath("");
      beat("project_file_save");
      await loadProjFiles();
    } catch (e) {
      setProjFilesErr((e as Error).message || "Save failed.");
    } finally {
      setProjFilesBusy(false);
    }
  };

  const removeProjFile = async (id: string) => {
    setProjFilesBusy(true);
    setProjFilesErr("");
    try {
      await deleteProjectFileApi(id);
      if (openFileId === id) setOpenFileId(null);
      await loadProjFiles();
    } catch (e) {
      setProjFilesErr((e as Error).message || "Delete failed.");
    } finally {
      setProjFilesBusy(false);
    }
  };


  /* ── Coding Agent run ───────────────────────────────────── */

  const runCodingAgent = async (goalText?: string) => {
    const goal = (goalText ?? input).trim();
    if (!goal || agentBusy) return;

    setError("");
    setAgentBusy(true);
    setAgentLog([]);
    setAgentResult(null);
    setView("app");
    setMode("code");
    setInput("");
    if (taRef.current) taRef.current.style.height = "48px";
    beat("agent_run");

    const ctrl = new AbortController();
    agentAbort.current = ctrl;

    // Show the goal in the transcript so the run has context in the thread.
    setMessages((ms) => [...ms, { id: rid(), role: "user", content: goal }]);

    try {
      const result = await runAgentApi(
        {
          goal,
          projectId: convProjectId ?? activeProject ?? undefined,
          canvasCode: codePanel || undefined,
          canvasLang: codeLang || undefined,
        },
        (ev: AgentEv) => {
          if (ev.type === "step") {
            setAgentLog((l) => [...l, { kind: "step", label: `${ev.label}…` }]);
          } else if (ev.type === "tool") {
            setAgentLog((l) => [
              ...l,
              {
                kind: "tool",
                ok: ev.ok,
                label: `${ev.tool.replace(/_/g, " ")}${ev.path ? ` · ${ev.path}` : ""} — ${ev.detail}`,
              },
            ]);
          } else if (ev.type === "check") {
            setAgentLog((l) => [
              ...l,
              {
                kind: "check",
                ok: ev.ok,
                label: ev.ok
                  ? "Checks passed"
                  : `Found ${ev.issues.length} issue(s) — fixing`,
              },
            ]);
          } else if (ev.type === "message") {
            setAgentLog((l) => [...l, { kind: "msg", label: ev.text }]);
          } else if (ev.type === "error") {
            setAgentLog((l) => [...l, { kind: "error", ok: false, label: ev.text }]);
          }
        },
        ctrl.signal
      );

      if (result) {
        setAgentResult({
          ok: result.ok,
          summary: result.summary,
          filesChanged: result.filesChanged,
          verified: result.verified,
        });

        // Drop the finished artifact straight into the canvas.
        if (result.primaryFile) {
          setCodePanel(result.primaryFile.content);
          setCodeLang(result.primaryFile.lang || "html");
          setCanvasTab("code");
        }

        setMessages((ms) => [
          ...ms,
          {
            id: rid(),
            role: "assistant",
            content: [
              result.summary,
              result.filesChanged.length
                ? `\n\n**Files changed:** ${result.filesChanged.join(", ")}`
                : "",
              result.verified ? "\n\n✓ Verified — checks passed." : "",
            ]
              .filter(Boolean)
              .join(""),
          },
        ]);

        void loadProjFiles();
        refreshMe();
      }
    } catch (e) {
      const msg = (e as Error).message || "The agent couldn't finish.";
      setError(msg);
      setAgentLog((l) => [...l, { kind: "error", ok: false, label: msg }]);
    } finally {
      setAgentBusy(false);
      agentAbort.current = null;
    }
  };

  const stopAgent = () => {
    agentAbort.current?.abort();
    agentAbort.current = null;
    setAgentBusy(false);
    setAgentLog((l) => [...l, { kind: "msg", label: "Stopped by you." }]);
  };

  const send = async (
    override?: string,
    retry?: { altModel?: number; baseMessages?: Msg[] }
  ) => {
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
    const history = retry?.baseMessages ?? messages;
    const userMsg: Msg = { id: rid(), role: "user", content: text };
    const aId = rid();
    const nextMessages = retry?.baseMessages
      ? [
          ...retry.baseMessages,
          { id: aId, role: "assistant" as const, content: "", streaming: true },
        ]
      : [
          ...messages,
          userMsg,
          { id: aId, role: "assistant" as const, content: "", streaming: true },
        ];
    setMessages(nextMessages);
    setStreaming(true);
    lastPrompt.current = effectiveText;

    // progress states: Understanding → Writing
    setStreamPhase("Understanding…");
    if (phaseTimer.current) clearTimeout(phaseTimer.current);
    phaseTimer.current = setTimeout(() => setStreamPhase("Writing…"), 1100);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let acc = "";
      const t0 = Date.now();
      let firstTokenSeen = false;
      await streamAI(
        endpoint,
        {
          messages: retry?.baseMessages
            ? retry.baseMessages.map((m) => ({ role: m.role, content: m.content }))
            : [
                ...messages.map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: effectiveText },
              ],
          conversationId: convId,
          webSearch: useSearch,
          projectId: convProjectId ?? activeProject ?? null,
          teamId: convTeamId ?? activeTeam ?? null,
          depth,
          tone,
          ...(retry?.altModel ? { altModel: retry.altModel } : {}),
        },
        (ev) => {
          if (ev.meta && typeof ev.meta === "object") {
            const meta = ev.meta as {
              conversationId?: string;
              model?: string;
              live?: boolean;
              sources?: Msg["sources"];
              understood?: string;
              clarifier?: string;
              fallbackNote?: string;
            };
            if (meta.conversationId) setConvId(meta.conversationId);
            if (meta.model) setModelTag(String(meta.model));
            if (
              meta.understood ||
              meta.sources?.length ||
              meta.fallbackNote ||
              meta.live === false
            ) {
              setMessages((ms) =>
                ms.map((m) =>
                  m.id === aId
                    ? {
                        ...m,
                        ...(meta.understood ? { understood: meta.understood } : {}),
                        ...(meta.clarifier ? { clarifier: meta.clarifier } : {}),
                        ...(meta.sources?.length ? { sources: meta.sources } : {}),
                        ...(meta.fallbackNote ? { fallbackNote: meta.fallbackNote } : {}),
                        ...(meta.live === false ? { offline: true } : {}),
                      }
                    : m
                )
              );
            }
          }
          if (ev.token) {
            if (streamPhaseRef.current !== "Writing…") {
              streamPhaseRef.current = "Writing…";
              setStreamPhase("Writing…");
              if (phaseTimer.current) clearTimeout(phaseTimer.current);
            }
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              beat("ttft", Date.now() - t0);
            }
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
          if (ev.error) {
            const errEv = ev as { error?: string; code?: string; hint?: string };
            // error handling (Update #2 P0): useful explanation + recovery actions
            setMessages((ms) =>
              ms.map((m) =>
                m.id === aId
                  ? {
                      ...m,
                      content: errEv.error || "Something went wrong. Try again.",
                      streaming: false,
                      recovery: {
                        text: effectiveText,
                        mode: resolved === "code" ? "code" : "chat",
                        useSearch,
                        altModel: (retry?.altModel || 0) + 1,
                        ...(errEv.code ? { code: errEv.code } : {}),
                        ...(errEv.hint ? { hint: errEv.hint } : {}),
                      },
                    }
                  : m
              )
            );
          }
          if (ev.done) {
            const q = (ev as { quality?: Msg["quality"] }).quality;
            setMessages((ms) =>
              ms.map((m) =>
                m.id === aId
                  ? { ...m, streaming: false, ...(q ? { quality: q } : {}) }
                  : m
              )
            );
          }
        },
        ctrl.signal
      );
      refreshMe();
      refreshHistory();
      // keep a version snapshot for the canvas
      if (resolved === "code") {
        const blocks = extractCode(acc);
        if (blocks.length) {
          pushCanvasVersion(blocks[blocks.length - 1].code, blocks[blocks.length - 1].lang);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const err = e as Error & { code?: string; hint?: string };
        // show a useful error + recovery actions instead of a dead bubble
        setMessages((ms) =>
          ms.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  content: err.message || "Something went wrong. Try again.",
                  streaming: false,
                  recovery: {
                    text: effectiveText,
                    mode: resolved === "code" ? "code" : "chat",
                    useSearch,
                    altModel: (retry?.altModel || 0) + 1,
                    ...(err.code ? { code: err.code } : {}),
                    ...(err.hint ? { hint: err.hint } : {}),
                  },
                }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setStreamPhase("");
      streamPhaseRef.current = "";
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
    }
  };

  const retrySend = async (rec: NonNullable<Msg["recovery"]>) => {
    if (streaming || visionBusy) return;
    const last = messages[messages.length - 1];
    const base = last?.role === "assistant" && last.recovery ? messages.slice(0, -1) : messages;
    setMode(rec.mode);
    beat(rec.altModel ? "recovery_use_another_model" : "recovery_try_again");
    await send(rec.text, { altModel: rec.altModel || undefined, baseMessages: base });
  };

  // internal metrics beat (Update #2) — fire-and-forget, never blocks UX
  const beat = (kind: string, ms?: number) => {
    try {
      void fetch("/api/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...(ms !== undefined ? { ms } : {}) }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* */
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

  const doDeleteAccount = async () => {
    const user = me?.user;
    const isOauth = (user as unknown as { provider?: string })?.provider === "google" ||
      (user as unknown as { provider?: string })?.provider === "github";
    const answer = window.prompt(
      isOauth
        ? `This PERMANENTLY deletes your account, chats, projects, teams, and keys. Type DELETE to confirm:`
        : `This PERMANENTLY deletes your account, chats, projects, teams, and keys.\nEnter your password to confirm:`
    );
    if (!answer) return;
    setAuthBusy(true);
    try {
      const r = await fetch("/api/auth/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isOauth ? { confirm: answer } : { password: answer }
        ),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't delete account");
      newChat();
      setHistory([]);
      setTeams([]);
      setProjects([]);
      setModal(null);
      await refreshMe();
      setTeamNote("Account deleted. We're sorry to see you go.");
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
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
            <Link href="/how-it-works" className="hover:opacity-80">How it works</Link>
            <Link href="/about" className="hover:opacity-80">About</Link>
            <Link href="/pricing" className="hover:opacity-80">Pricing</Link>
            <Link href="/security" className="hover:opacity-80">Security</Link>
            <Link href="/status" className="hover:opacity-80">Status</Link>
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
              <Sparkles className="h-3.5 w-3.5" /> BUILDWE · Free AI workspace
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl sm:leading-[1.05]">
              AI that understands the work.
              <br />
              <span style={{ color: "var(--accent)" }}>Not just the words.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg" style={{ color: "var(--muted)" }}>
              Tell BUILDWE what you want in plain language. It picks the right tool, does the work, checks the result, and hands you the answer — chat, code, images, and voice in one calm workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Btn size="lg" onClick={() => setView("app")}>
                Start free — no signup needed <ArrowRight className="h-4 w-4" />
              </Btn>
              <Link
                href="/how-it-works"
                className="inline-flex h-12 items-center rounded-2xl border px-5 text-[15px] font-medium"
                style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--ink)" }}
              >
                How it works
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--soft)" }}>
              <span>Free forever plan</span>·<span>Guest mode</span>·<span>Works on mobile</span>·<span>Installable app</span>·<span>No card needed</span>
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
                  {["Auto route", "Streaming chat", "Web search", "File analysis", "Code canvas", "Vision", "Voice", "Projects & teams", "Share links", "History", "Guest mode"].map((label) => (
                    <span key={label} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: "var(--border)", background: "var(--card)" }}>{label}</span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
                  <Link href="/how-it-works" className="inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                    How it works <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                  <Link href="/help" className="inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                    Help &amp; FAQ <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                  <Link href="/security" className="inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                    Security <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="border-t px-4 py-6" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px]" style={{ color: "var(--soft)" }}>
            <span className="font-semibold" style={{ color: "var(--muted)" }}>BUILDWE.ONLINE</span>
            <Link href="/how-it-works" className="hover:opacity-80">How it works</Link>
            <Link href="/about" className="hover:opacity-80">About</Link>
            <Link href="/pricing" className="hover:opacity-80">Pricing</Link>
            <Link href="/security" className="hover:opacity-80">Security</Link>
            <Link href="/status" className="hover:opacity-80">Status</Link>
            <Link href="/help" className="hover:opacity-80">Help</Link>
            <Link href="/contact" className="hover:opacity-80">Contact</Link>
            <Link href="/privacy" className="hover:opacity-80">Privacy</Link>
            <Link href="/terms" className="hover:opacity-80">Terms</Link>
            <Link href="/acceptable-use" className="hover:opacity-80">Acceptable use</Link>
            <Link href="/developers" className="hover:opacity-80">Developers</Link>
          </div>
        </footer>

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

        {/* Purpose-built generators live at /tools — the sidebar links to the
            real routes, it doesn't reimplement a second copy of the catalogue
            that could drift from the registry. */}
        <nav className="space-y-0.5 px-2.5 pb-2">
          {[
            { href: "/tools", label: "Tools", icon: Wrench },
            { href: "/studios", label: "Studios", icon: LayoutGrid },
          ].map((l) => {
            const Icon = l.icon;
            return (
              <a
                key={l.href}
                href={l.href}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm font-medium",
                  sidebarOpen ? "px-3" : "justify-center"
                )}
                style={{ color: "var(--muted)" }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {sidebarOpen && l.label}
              </a>
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
              {me?.kind === "guest" && !!history.length && (
                <div className="anim-rise mx-2 mb-2 rounded-2xl border p-2.5" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
                  <div className="text-[11px] font-semibold">Guest = Try · Account = Own</div>
                  <p className="mt-0.5 text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
                    History is saved on this device only. Log in to own your workspace, sync devices, and unlock PRO &amp; your own API keys.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setAuthTab("register"); setModal("auth"); }}
                    className="mt-1.5 w-full rounded-xl py-1.5 text-[11px] font-semibold text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    Create free account
                  </button>
                </div>
              )}
              <div className="bw-side-list min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
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
              <AdSlot
                plan={plan}
                slot="sidebar"
                onGoPro={() => setModal("plans")}
                onAddKey={() => setModal("byok")}
              />
            </div>
          )}
          {/* aria-label always, title only when collapsed: with the labels hidden these rows
              were icon-only buttons with no accessible name at all. */}
          <button type="button" onClick={() => setModal("settings")} aria-label="Settings" title={sidebarOpen ? undefined : "Settings"} className={clsx("bw-side-row flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm", sidebarOpen ? "px-3" : "justify-center")} style={{ color: "var(--muted)" }}>
            <Settings className="h-4 w-4" />
            {sidebarOpen && "Settings"}
          </button>
          {loggedIn ? (
            <ProfileFlyout
              collapsed={!sidebarOpen}
              name={me?.name}
              email={me?.user?.email}
              plan={plan}
              byokActive={byokActive}
              teamName={teams.find((t) => t.id === activeTeam)?.name}
              themePref={themePref}
              onTheme={setThemePref}
              onOpenProfile={() => setModal("profile")}
              onOpenPlans={() => setModal("plans")}
              onOpenTeams={() => setModal("teams")}
              onOpenByok={() => setModal("byok")}
              onSignOut={doLogout}
            />
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
          <WalletChip />
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
              failure={imgFailure}
              onRetry={() => {
                if (!imgLastPrompt) return;
                setImgFailure(null);
                void runImageGenerate(imgLastPrompt);
              }}
              onDismissFailure={() => {
                setImgFailure(null);
                setError("");
              }}
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
              history={audioHistory}
              onGenerate={() => runAudioGenerate()}
              failure={audioFailure}
              onRetry={() => {
                if (!audioLastScript) return;
                setAudioFailure(null);
                void runAudioGenerate(audioLastScript);
              }}
              onDismissFailure={() => {
                setAudioFailure(null);
                setError("");
              }}
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
                        <AdSlot plan={plan} slot="chat-empty" onGoPro={() => setModal("plans")} onAddKey={() => setModal("byok")} />
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
                                  {m.quality && !m.streaming && (
                                    <span
                                      className={clsx("ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide")}
                                      style={
                                        m.quality.label === "good"
                                          ? { background: "var(--ok-soft)", color: "var(--ok)" }
                                          : { background: "var(--warn-soft)", color: "var(--warn)" }
                                      }
                                      title={m.quality.notes.join(" · ")}
                                    >
                                      {m.quality.label === "good" ? "✓ Checked" : "⚠ Review"}
                                    </span>
                                  )}
                                </div>
                              )}
                              {!isUser && m.understood && (
                                <p className="mb-1 max-w-[min(100%,36rem)] truncate text-[10px] italic" style={{ color: "var(--soft)" }} title={m.understood}>
                                  Understood: {m.understood}
                                </p>
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
                              {!isUser && m.fallbackNote && !m.streaming && (
                                <p
                                  className="mt-1.5 flex items-start gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px]"
                                  style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
                                  title="Provider transparency — what happened behind the scenes"
                                >
                                  <span aria-hidden>{m.offline ? "◍" : "⚙"}</span>
                                  <span>
                                    <strong className="font-semibold">
                                      {m.offline ? "Offline mode:" : "Model switched:"}
                                    </strong>{" "}
                                    {m.fallbackNote}
                                  </span>
                                </p>
                              )}
                              {/* Offline replies are not errors, so they never got the
                                  recovery bar — but the user still needs a way out.
                                  Give them a retry and a one-tap route to connect a key. */}
                              {!isUser && m.offline && !m.recovery && !m.streaming && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <Btn
                                    size="sm"
                                    variant="ghost"
                                    disabled={streaming || visionBusy}
                                    onClick={() => {
                                      const idx = messages.findIndex((x) => x.id === m.id);
                                      const prevUser = [...messages.slice(0, idx)]
                                        .reverse()
                                        .find((x) => x.role === "user");
                                      if (!prevUser || streaming) return;
                                      beat("offline_retry_live");
                                      setMessages((ms) => ms.filter((x) => x.id !== m.id));
                                      setTimeout(() => send(prevUser.content), 30);
                                    }}
                                    title="Try the live model again"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" /> Retry live
                                  </Btn>
                                  <Btn
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      beat("offline_open_keys");
                                      setModal("byok");
                                    }}
                                    title="Connect your own model key for full-quality answers"
                                  >
                                    <KeyRound className="h-3.5 w-3.5" /> Connect a key
                                  </Btn>
                                </div>
                              )}
                              {!isUser && m.recovery && !m.streaming && (
                                <div
                                  className="mt-1.5 rounded-2xl border px-3 py-2"
                                  style={{ borderColor: "var(--warn)", background: "var(--warn-soft)" }}
                                  role="alert"
                                >
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Btn
                                      size="sm"
                                      onClick={() => retrySend({ ...m.recovery!, altModel: 0 })}
                                      disabled={streaming || visionBusy}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" /> Try Again
                                    </Btn>
                                    <Btn
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => retrySend({ ...m.recovery!, altModel: Math.min(m.recovery!.altModel || 1, 3) })}
                                      disabled={streaming || visionBusy}
                                      title="Send the same request to a different AI model"
                                    >
                                      <ArrowRightLeft className="h-3.5 w-3.5" /> Use another model
                                    </Btn>
                                  </div>
                                  {m.recovery.hint && (
                                    <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
                                      Tip: {m.recovery.hint}
                                    </p>
                                  )}
                                </div>
                              )}
                              {!isUser && m.content && !m.streaming && !m.recovery && (
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
                                      beat("regenerate");
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
                                  <span className="mx-1 h-3 w-px" style={{ background: "var(--border)" }} />
                                  {[
                                    ["Simplify", "Rewrite your previous answer in simple, beginner-friendly language — keep every fact."],
                                    ["Shorten", "Rewrite your previous answer much shorter — only the essentials, keep it accurate."],
                                    ["Expand", "Expand your previous answer with more detail and useful examples — keep it accurate."],
                                    ["Explain", "Explain your previous answer step by step like I'm new to this topic."],
                                    ["Example", "Give one concrete example for your previous answer."],
                                    ["Document", "Turn your previous answer into a clean shareable document: a clear title, short intro, well-organised sections with headings, and a one-line summary at the end. Keep every fact exactly as stated."],
                                    ["Table", "Turn your previous answer into a markdown table with clear column headers — one row per item. Keep every fact exactly as stated, and add a one-line note under the table."],
                                    ["Report", "Turn your previous answer into a short professional report: Title, Key findings (bullets), Details, Risks or caveats, and Recommended next steps. Keep every fact exactly as stated."],
                                  ].map(([label, instruction]) => (
                                    <button
                                      key={label}
                                      type="button"
                                      disabled={streaming}
                                      onClick={() => send(instruction)}
                                      className="rounded-lg px-1.5 py-1 text-[10px] font-semibold transition hover:opacity-80 disabled:opacity-40"
                                      style={{ background: "var(--secondary)", color: "var(--muted)" }}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Verify claims"
                                    title="Verify — check facts against live sources"
                                    disabled={verifying === m.id}
                                    onClick={() => doVerify(m)}
                                  >
                                    {verifying === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                                  </Btn>
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Use as prompt"
                                    title="Use this answer as your next prompt"
                                    onClick={() => {
                                      setInput(m.content.slice(0, 2000));
                                      requestAnimationFrame(grow);
                                      taRef.current?.focus();
                                    }}
                                  >
                                    <SquarePen className="h-3.5 w-3.5" />
                                  </Btn>
                                  <Btn
                                    variant="icon"
                                    size="sm"
                                    aria-label="Save answer"
                                    title="Save this answer to a file"
                                    onClick={() => {
                                      const blob = new Blob([m.content], { type: "text/plain" });
                                      const a = document.createElement("a");
                                      a.href = URL.createObjectURL(blob);
                                      a.download = "buildwe-answer.txt";
                                      a.click();
                                    }}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </Btn>
                                </div>
                              )}
                              {!isUser && m.clarifier && !m.streaming && (
                                <p className="mt-1 rounded-xl px-2.5 py-1.5 text-[11px]" style={{ background: "var(--info-soft)", color: "var(--info)" }}>
                                  {m.clarifier}
                                </p>
                              )}
                              {!isUser && m.verified && (
                                <div className="anim-rise mt-1.5 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                                  <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                                    <ShieldCheck className="h-3.5 w-3.5" style={{ color: m.verified.verdict === "verified" ? "var(--ok)" : "var(--warn)" }} />
                                    <span style={{ color: m.verified.verdict === "verified" ? "var(--ok)" : "var(--warn)" }}>
                                      {m.verified.verdict === "verified" ? "Verified" : m.verified.verdict === "nothing-to-check" ? "Nothing to check" : "Needs verification"}
                                    </span>
                                    <span className="font-normal" style={{ color: "var(--soft)" }}>· {m.verified.message}</span>
                                  </div>
                                  {!!m.verified.claims.length && (
                                    <ul className="mt-1.5 space-y-1">
                                      {m.verified.claims.map((c, ci) => (
                                        <li key={ci} className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
                                          <span
                                            className="mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase"
                                            style={c.verdict === "verified" ? { background: "var(--ok-soft)", color: "var(--ok)" } : { background: "var(--warn-soft)", color: "var(--warn)" }}
                                          >
                                            {c.verdict === "verified" ? "source ✓" : "uncertain"}
                                          </span>
                                          <span className="min-w-0 flex-1">
                                            {c.claim.slice(0, 140)}
                                            {c.claim.length > 140 ? "…" : ""}
                                            {c.source && (
                                              <> — <a href={c.source.url} target="_blank" rel="noopener noreferrer" className="font-semibold" style={{ color: "var(--accent)" }}>{c.source.host}</a></>
                                            )}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
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

              <PromptBar
                mode={mode}
                input={input}
                setInput={setInput}
                attachment={attachment}
                setAttachment={setAttachment}
                error={error}
                setError={setError}
                streaming={streaming}
                streamPhase={streamPhase}
                depth={depth}
                setDepth={setDepth}
                tone={tone}
                setTone={setTone}
                webSearchOn={webSearchOn}
                setWebSearchOn={setWebSearchOn}
                listening={listening}
                setListening={setListening}
                imgLoading={imgLoading}
                audioBusy={audioBusy}
                visionBusy={visionBusy}
                plan={plan}
                me={me}
                byokActive={byokActive}
                lastPromptText={lastPrompt.current}
                taRef={taRef}
                fileRef={fileRef}
                imgAttachRef={imgAttachRef}
                onSend={send}
                maxMessageChars={wallet.limits?.messageChars}
                onGrow={grow}
                onMode={switchMode}
                setMode={setMode}
                onCompare={openCompare}
                onStop={stop}
                onUpgrade={() => setModal("plans")}
              />
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
                    <button
                      type="button"
                      onClick={() => setCanvasTab("files")}
                      title="Project files — read, edit and save files the agent can see"
                      className={clsx("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium", canvasTab === "files" ? "bg-white/15 text-white" : "text-white/45 hover:bg-white/10")}
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Files
                      {projFiles.length > 0 && (
                        <span className="rounded bg-white/15 px-1 text-[9px]">{projFiles.length}</span>
                      )}
                    </button>
                    {canvasVersions.length > 1 && (
                      <div className="relative ml-1">
                        <button
                          type="button"
                          onClick={() => setVerMenu((v) => !v)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-white/45 hover:bg-white/10"
                        >
                          <RotateCcw className="h-3 w-3" /> History · {canvasVersions.length}
                        </button>
                        {verMenu && (
                          <>
                            <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close history" onClick={() => setVerMenu(false)} />
                            <div className="absolute left-0 z-50 mt-2 max-h-56 w-56 overflow-y-auto rounded-2xl border border-white/10 bg-[#1e1b18] p-1.5 shadow-lg">
                              {canvasVersions.map((v, vi) => (
                                <button
                                  key={v.ts}
                                  type="button"
                                  onClick={() => {
                                    setCodePanel(v.code);
                                    setCodeLang(v.lang);
                                    setVerMenu(false);
                                  }}
                                  className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[11px] text-white/80 hover:bg-white/10"
                                >
                                  <span>{v.code === codePanel ? "Current" : `Version ${canvasVersions.length - vi}`}</span>
                                  <span className="text-white/40">{new Date(v.ts).toLocaleTimeString()}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* The agent is the headline action: it plans, writes files,
                        verifies and fixes on its own, unlike the single-shot
                        Fix/Optimize/Refactor buttons beside it. */}
                    <button
                      type="button"
                      title="Agent: plans, writes project files, verifies and fixes them on its own"
                      aria-label={agentBusy ? "Stop agent" : "Run coding agent"}
                      onClick={() => (agentBusy ? stopAgent() : runCodingAgent())}
                      disabled={!agentBusy && !input.trim()}
                      className={clsx(
                        "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition disabled:opacity-35",
                        agentBusy
                          ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                          : "bg-[var(--accent)] text-white hover:opacity-90"
                      )}
                    >
                      {agentBusy ? (
                        <>
                          <Square className="h-3.5 w-3.5" />
                          <span className="hidden xl:inline">Stop</span>
                        </>
                      ) : (
                        <>
                          <Bot className="h-3.5 w-3.5" />
                          <span className="hidden xl:inline">Agent</span>
                        </>
                      )}
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-white/10" />
                    {([
                      ["run", "Run", Play, "HTML preview me chalao · JS sandboxed worker me"],
                      ["test", "Test", FlaskConical, "AI se runnable tests banao aur chalao"],
                      ["fix", "Fix", Wrench, "Bugs dhundo aur theek karo"],
                      ["optimize", "Optimize", Zap, "Fast/light banao — behaviour same"],
                      ["refactor", "Refactor", Recycle, "Safar sudharo — behaviour same"],
                    ] as const).map(([act, label, Icon, tip]) => (
                      <button
                        key={act}
                        type="button"
                        title={tip}
                        aria-label={label}
                        disabled={canvasActionBusy !== null}
                        onClick={() => runCanvasAction(act)}
                        className={clsx(
                          "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition",
                          act === "run"
                            ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                            : "text-white/55 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {canvasActionBusy === act ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Icon className="h-3.5 w-3.5" />
                        )}
                        <span className="hidden xl:inline">{label}</span>
                      </button>
                    ))}
                    <span className="mx-0.5 h-4 w-px bg-white/10" />
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
                {(agentBusy || agentLog.length > 0) && (
                  <div
                    className="max-h-52 shrink-0 overflow-y-auto border-b border-white/10 px-4 py-2.5"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                        <Bot className="h-3 w-3" />
                        {agentBusy ? "Agent working" : "Agent run"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {agentBusy && (
                          <Loader2 className="h-3 w-3 animate-spin text-white/50" />
                        )}
                        {!agentBusy && (
                          <button
                            type="button"
                            aria-label="Clear agent log"
                            className="rounded px-1.5 text-[11px] text-white/40 hover:bg-white/10 hover:text-white/80"
                            onClick={() => {
                              setAgentLog([]);
                              setAgentResult(null);
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    <ol className="flex flex-col gap-0.5">
                      {agentLog.map((entry, i) => (
                        <li
                          key={i}
                          className={clsx(
                            "flex items-start gap-1.5 font-mono text-[11px] leading-relaxed",
                            entry.kind === "error"
                              ? "text-red-300"
                              : entry.ok === false
                                ? "text-amber-300"
                                : entry.kind === "check" && entry.ok
                                  ? "text-emerald-300"
                                  : entry.kind === "step"
                                    ? "text-white/75"
                                    : "text-white/45"
                          )}
                        >
                          <span aria-hidden className="shrink-0">
                            {entry.kind === "error"
                              ? "✕"
                              : entry.kind === "check"
                                ? entry.ok
                                  ? "✓"
                                  : "⚠"
                                : entry.kind === "step"
                                  ? "▸"
                                  : "·"}
                          </span>
                          <span className="min-w-0 break-words">{entry.label}</span>
                        </li>
                      ))}
                    </ol>
                    {agentResult && (
                      <div
                        className={clsx(
                          "mt-2 rounded-xl px-2.5 py-2 text-[11px]",
                          agentResult.verified
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "bg-amber-500/15 text-amber-200"
                        )}
                      >
                        <strong className="font-semibold">
                          {agentResult.verified ? "✓ Verified · " : "Finished · "}
                        </strong>
                        {agentResult.summary}
                        {agentResult.filesChanged.length > 0 && (
                          <div className="mt-1 text-white/50">
                            {agentResult.filesChanged.join(" · ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {canvasTab === "files" ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                    {!currentProjectId ? (
                      <div className="m-auto max-w-xs text-center text-[12px] text-white/55">
                        <FolderOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
                        <p className="font-medium text-white/80">No project selected</p>
                        <p className="mt-1">
                          Pick or create a project in the sidebar. Files saved there stay with
                          your account and are given to the agent as context.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 flex items-center gap-2">
                          <input
                            value={newFilePath}
                            onChange={(e) => setNewFilePath(e.target.value)}
                            placeholder="index.html"
                            aria-label="New file path"
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-white/30"
                          />
                          <button
                            type="button"
                            disabled={projFilesBusy}
                            onClick={() => void saveCanvasToFile()}
                            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                            style={{ background: "var(--accent)" }}
                            title="Save what's in the canvas to this path"
                          >
                            Save canvas
                          </button>
                          <button
                            type="button"
                            disabled={projFilesBusy}
                            onClick={() => void loadProjFiles()}
                            aria-label="Refresh file list"
                            className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-white/60 hover:bg-white/10 disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {projFilesErr && (
                          <p className="mb-2 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-[11px] text-red-300" role="alert">
                            {projFilesErr}
                          </p>
                        )}

                        {projFilesBusy && !projFiles.length ? (
                          <p className="text-[12px] text-white/45">Loading files…</p>
                        ) : !projFiles.length ? (
                          <p className="text-[12px] text-white/45">
                            No files yet. Write something in the canvas, name it above and hit
                            <strong className="text-white/70"> Save canvas</strong>.
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {projFiles.map((f) => (
                              <li
                                key={f.id}
                                className={clsx(
                                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px]",
                                  openFileId === f.id ? "bg-white/15" : "hover:bg-white/10"
                                )}
                              >
                                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-white/40" />
                                <button
                                  type="button"
                                  onClick={() => void openProjFile(f.id)}
                                  className="min-w-0 flex-1 truncate text-left text-white/85"
                                  title={`Open ${f.path}`}
                                >
                                  {f.path}
                                </button>
                                <span className="shrink-0 text-[10px] text-white/35">
                                  {f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void removeProjFile(f.id)}
                                  aria-label={`Delete ${f.path}`}
                                  className="shrink-0 rounded px-1.5 text-[11px] text-white/35 hover:bg-white/10 hover:text-red-300"
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-3 text-[10px] leading-relaxed text-white/35">
                          Files are private to your account and are sent to the agent as project
                          context so it can reason across your whole project, not just one snippet.
                        </p>
                      </>
                    )}
                  </div>
                ) : canvasTab === "preview" ? (
                  <iframe
                    title="Live preview"
                    sandbox="allow-scripts"
                    srcDoc={codePanel}
                    className="flex-1 bg-white"
                  />
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                      <pre className="font-mono text-[13px] leading-relaxed"><code>{codePanel}</code></pre>
                    </div>
                    {canvasConsole && (
                      <div
                        className="max-h-48 shrink-0 overflow-y-auto border-t border-white/10 px-4 py-2.5"
                        role={canvasConsole.ok ? "status" : "alert"}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span
                            className={clsx(
                              "text-[10px] font-bold uppercase tracking-wider",
                              canvasConsole.kind === "run"
                                ? "text-emerald-300"
                                : canvasConsole.kind === "test"
                                  ? "text-sky-300"
                                  : canvasConsole.ok ? "text-amber-300" : "text-red-300"
                            )}
                          >
                            {canvasConsole.kind === "run"
                              ? "▶ Output"
                              : canvasConsole.kind === "test"
                                ? "✓ Tests"
                                : canvasConsole.ok ? "ℹ Info" : "⚠ Note"}
                          </span>
                          <button
                            type="button"
                            aria-label="Close console"
                            className="rounded px-1.5 text-[11px] text-white/40 hover:bg-white/10 hover:text-white/80"
                            onClick={() => setCanvasConsole(null)}
                          >
                            ✕
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-white/75">
                          {canvasConsole.text}
                        </pre>
                      </div>
                    )}
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
          notice={authNotice}
          busy={authBusy}
          onSubmit={onAuth}
          onClose={() => { setModal(null); setAuthNotice(""); }}
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

      {modal === "compare" && (
        <Sheet onClose={() => setModal(null)} title="Compare models">
          <div className="space-y-3">
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              Ask the same question to 3 different AI models at once — then read the combined
              synthesis. Same prompt, three perspectives, one answer.
            </p>
            <textarea
              value={comparePrompt}
              onChange={(e) => setComparePrompt(e.target.value)}
              placeholder="Type the question you want to compare…"
              rows={3}
              className="w-full resize-none rounded-2xl border px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "inherit" }}
            />
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={doCompare} disabled={!comparePrompt.trim() || compareBusy}>
                {compareBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                {compareBusy ? "Asking 3 models…" : "Run comparison"}
              </Btn>
              {compareResult && (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setInput(comparePrompt);
                    requestAnimationFrame(grow);
                    setModal(null);
                    taRef.current?.focus();
                  }}
                >
                  <SquarePen className="h-3.5 w-3.5" /> Continue in chat
                </Btn>
              )}
            </div>

            {compareResult && !compareResult.available && (
              <div className="rounded-2xl border px-3 py-3 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--muted)" }}>
                {compareResult.synthesis}
              </div>
            )}

            {compareResult?.available && (
              <>
                <div className="grid gap-2">
                  {compareResult.lanes.map((l) => (
                    <div key={l.label} className="rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                          {l.label}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[10px]" style={{ color: "var(--soft)" }}>{l.model}</span>
                          <Btn variant="icon" size="sm" aria-label={`Copy ${l.label}`} onClick={() => copy(l.reply, `cmp-${l.label}`)}>
                            {copied === `cmp-${l.label}` ? <Check className="h-3.5 w-3.5" style={{ color: "var(--ok)" }} /> : <Copy className="h-3.5 w-3.5" />}
                          </Btn>
                        </span>
                      </div>
                      <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                        {l.reply.trim() ? l.reply : "— offline (no live provider for this seat) —"}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                    Best combined answer
                  </div>
                  <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed">
                    {compareResult.synthesis}
                  </p>
                </div>
                <p className="text-center text-[10px]" style={{ color: "var(--soft)" }}>
                  Model agreement is not proof — verify important facts with the ✓ Verify button.
                </p>
              </>
            )}
          </div>
        </Sheet>
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
            {/* Same THEME_ITEMS the flyout submenu lists, in the shared control: these three
                buttons marked the active one with colour alone, which a screen reader cannot
                read, and left the sheet and the menu free to drift apart. */}
            <SegmentedControl items={THEME_ITEMS} value={themePref} onChange={setThemePref} ariaLabel="Theme" full dark={false} />
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
              <a href="/help" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><HelpCircle className="h-4 w-4 opacity-70" /> Help &amp; FAQ <ExternalLink className="ml-auto h-3.5 w-3.5" style={{ color: "var(--soft)" }} /></a>
              <a href="/how-it-works" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Wand2 className="h-4 w-4 opacity-70" /> How BUILDWE works <ExternalLink className="ml-auto h-3.5 w-3.5" style={{ color: "var(--soft)" }} /></a>
              <a href="/about" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Bot className="h-4 w-4 opacity-70" /> About BUILDWE <ExternalLink className="ml-auto h-3.5 w-3.5" style={{ color: "var(--soft)" }} /></a>
              <a href="/privacy" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Shield className="h-4 w-4 opacity-70" /> Privacy</a>
              <a href="/terms" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><FileCode2 className="h-4 w-4 opacity-70" /> Terms</a>
              <button type="button" onClick={() => setModal("plans")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><CreditCard className="h-4 w-4 opacity-70" /> Plan · {plan}</button>
              {loggedIn ? (
                <>
                  <button type="button" onClick={doLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600"><LogOut className="h-4 w-4" /> Log out</button>
                  <button type="button" onClick={doDeleteAccount} disabled={authBusy} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium" style={{ color: "var(--err)" }}>
                    <AlertTriangle className="h-3.5 w-3.5" /> {authBusy ? "Deleting…" : "Delete account (permanent)"}
                  </button>
                </>
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
  notice?: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"auth" | "forgot">("auth");
  const [forgotEmail, setForgotEmail] = useState(props.email);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotNote, setForgotNote] = useState("");

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotNote("");
    try {
      const r = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't start reset");
      setForgotNote(j.message || "If that email has an account, a reset link is on its way.");
      if (j.devLink) setForgotNote((n) => `${n} (dev link: ${j.devLink})`);
    } catch (err) {
      setForgotNote((err as Error).message);
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <Sheet onClose={props.onClose} title={props.tab === "login" ? "Welcome back" : "Create account"}>
      {view === "forgot" ? (
        <div className="anim-sheet">
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Enter your account email — we&apos;ll send a secure link to set a new password (valid 1 hour).
          </p>
          <form onSubmit={submitForgot} className="space-y-3">
            <input
              type="email"
              required
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="Your account email"
              className="h-11 w-full rounded-2xl border px-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            />
            {forgotNote && <p className="text-xs" style={{ color: "var(--accent)" }}>{forgotNote}</p>}
            <Btn type="submit" className="w-full" size="lg" disabled={forgotBusy}>
              {forgotBusy ? "Sending…" : "Send reset link"}
            </Btn>
            <button type="button" className="w-full text-center text-xs font-semibold" style={{ color: "var(--muted)" }} onClick={() => setView("auth")}>
              ← Back to log in
            </button>
          </form>
        </div>
      ) : (
        <div className="anim-sheet">
          <div className="grid grid-cols-2 gap-2">
            <a
              href="/api/auth/oauth/google"
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border text-sm font-medium transition hover:opacity-85"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <Chrome className="h-4 w-4" /> Google
            </a>
            <a
              href="/api/auth/oauth/github"
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border text-sm font-medium transition hover:opacity-85"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <Github className="h-4 w-4" /> GitHub
            </a>
          </div>
          <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--soft)" }}>
            <span className="h-px flex-1" style={{ background: "var(--border)" }} /> or use email <span className="h-px flex-1" style={{ background: "var(--border)" }} />
          </div>

          <div className="mb-4 flex rounded-2xl border p-1" style={{ borderColor: "var(--border)" }}>
            {(["login", "register"] as const).map((t) => (
              <button key={t} type="button" onClick={() => props.setTab(t)} className="flex-1 rounded-xl py-2 text-sm font-medium capitalize" style={props.tab === t ? { background: "var(--ink)", color: "var(--bg)" } : { color: "var(--muted)" }}>{t === "login" ? "log in" : "sign up"}</button>
            ))}
          </div>
          <form onSubmit={props.onSubmit} className="space-y-3">
            {props.tab === "register" && (
              <input value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="Name" className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
            )}
            <input type="email" required value={props.email} onChange={(e) => props.setEmail(e.target.value)} placeholder="Email" className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
            <input type="password" required minLength={6} value={props.password} onChange={(e) => props.setPassword(e.target.value)} placeholder="Password (min 6)" className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
            {props.tab === "login" && (
              <button type="button" className="text-xs font-semibold" style={{ color: "var(--accent)" }} onClick={() => setView("forgot")}>
                Forgot password?
              </button>
            )}
            {(props.err || props.notice) && (
              <p className="text-xs" style={{ color: "var(--err)" }}>{props.err || props.notice}</p>
            )}
            <Btn type="submit" className="w-full" size="lg" disabled={props.busy}>
              {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.busy ? "Just a sec…" : props.tab === "login" ? "Log in" : "Sign up free"}
            </Btn>
          </form>
          <p className="mt-3 text-center text-[11px]" style={{ color: "var(--soft)" }}>
            Guest = Try BUILDWE · Account = Own your workspace
          </p>
        </div>
      )}
    </Sheet>
  );
}

function PlansSheet({ plan, onClose, onPro }: { plan: string; onClose: () => void; onPro: () => void }) {
  // Price comes from the server's checkout config — the same number the order
  // endpoint charges. It used to be hand-written here as "$5" while /pricing
  // said "₹500" and Razorpay was configured for 50000 paise (audit A6).
  const proPrice = useProPrice();
  // Credit numbers come from the wallet endpoint for the same reason.
  const wallet = useWallet();
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
            <li>✓ {wallet.welcome} credits free at signup</li>
            <li>✓ Ad-supported experience</li>
          </ul>
        </div>
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--accent)" }}>PRO</div>
          <div className="mt-1 text-2xl font-semibold">{proPrice.label}<span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/mo</span></div>
          <ul className="mt-3 space-y-1.5 text-xs">
            <li>✓ Higher creative limits</li>
            <li>✓ Priority generation</li>
            <li>✓ Calmer, fewer ads</li>
            <li>✓ {wallet.proMonthly.toLocaleString()} credits every month</li>
            <li>✓ Built for daily heavy use</li>
          </ul>
          <Btn className="mt-4 w-full" size="sm" onClick={onPro}>Upgrade to PRO</Btn>
        </div>
      </div>
      {/* The other way to buy: a credit pack, no subscription. People who only
          need 50 more generations this month should not have to commit. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <span style={{ color: "var(--muted)" }}>
          Just need more credits? Balance:{" "}
          <b style={{ color: "var(--ink)" }}>{wallet.loaded ? wallet.balance : "···"}</b>{" "}
          {wallet.packs.length > 0
            ? ` · ${wallet.packs.map((p) => `${p.displayAmount} = ${p.credits} credits`).join(", ")}`
            : ""}
        </span>
        <button
          type="button"
          className="font-semibold"
          style={{ color: "var(--accent)" }}
          onClick={() => {
            onClose();
            openCredits();
          }}
        >
          Top up credits →
        </button>
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
