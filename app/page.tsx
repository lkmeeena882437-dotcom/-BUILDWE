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
  Download,
  Layers,
  Share2,
  FolderOpen,
  Eye,
  KeyRound,
  Terminal,
  Printer,
  Users,
  User,
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
  saveAnswer,
  shareAnswer,
  createProject,
  assignProject,
  deleteProjectApi,
  fetchByok,
  compareMixApi,
  fetchCompareContract,
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
  type ModelsInfo,
  type CompareContract,
  type CompareRun } from "@/lib/client/api";
import type { MixEntry } from "@/components/workspace/CompareResults";
import { ImageStudio, type StudioImage } from "@/components/workspace/ImageStudio";
import { AudioStudio } from "@/components/workspace/AudioStudio";
import { CanvasHistoryMenu, type CanvasVersion } from "@/components/workspace/CanvasHistoryMenu";
import { ProjectMoveMenu } from "@/components/workspace/ProjectMoveMenu";
import type { PaletteRow } from "@/lib/client/palette";
import { Sheet } from "@/components/workspace/Sheet";
import { MessageActions } from "@/components/workspace/MessageActions";
import { EmptyState } from "@/components/workspace/EmptyState";
import dynamic from "next/dynamic";

/* The creations list is opened by a click, not by a page load: ~3 kB of First Load JS for
   every session that never opens it is the wrong trade, so the panel (and its row menu,
   which is the only thing that pulls in Popover/MenuRow here) arrives as its own chunk. */
/* ⌘K, lazy for the same reason as the panel above: the shortcut is for the person who wants it,
   and a workspace that ships a 31-tool jump list to every first visit pays for it on every load.
   No `loading` shell here — the sheet that arrives IS the loading state, and a skeleton that
   flashes for one frame in a dialog is noise. */
/* The lane picker too: its weight is a list of models nobody needs until they have decided to
   compare, and it renders inside a sheet that is itself conditional. Same shape as the two above —
   no loading shell, because "Reading which models this run can ask…" already is one. */
const CompareLanes = dynamic(
  () => import("@/components/workspace/CompareLanes").then((m) => m.CompareLanes),
  { ssr: false }
);

/* Same reason as the picker above, and it only appears once a comparison has answered. */
const CompareResults = dynamic(
  () => import("@/components/workspace/CompareResults").then((m) => m.CompareResults),
  { ssr: false }
);

const CommandPalette = dynamic(
  () => import("@/components/workspace/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false }
);

const CreationsPanel = dynamic(
  () => import("@/components/workspace/CreationsPanel").then((m) => m.CreationsPanel),
  {
    ssr: false,
    loading: () => (
      <p className="py-6 text-xs" style={{ color: "var(--muted)" }}>
        Opening your creations…
      </p>
    ),
  }
);
import { AdSlot } from "@/components/AdSlot";
import { renderSafeMarkdown } from "@/lib/safe-md";
import { LinkPreviews } from "@/components/chat/LinkPreviews";
import { FileApplyBlocks } from "@/components/chat/FileApplyBlocks";
import { useProPrice } from "@/components/billing/useProPrice";
import { WalletChip, openCredits, useWallet } from "@/components/billing/CreditsUI";
import { PromptBar } from "@/components/workspace/PromptBar";
import { Btn } from "@/lib/ui/Btn";
import { MODE_META, type Mode } from "@/lib/client/modes";
import { ProfileFlyout } from "@/components/workspace/ProfileFlyout";
import { SegmentedControl } from "@/lib/ui/SegmentedControl";
import { THEME_ITEMS, type ThemePref } from "@/lib/client/theme";
import { groupHistory } from "@/lib/client/groupHistory";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  image?: string;
  sources?: { title: string; url: string; host: string }[];
  /**
   * Workspace context, as reported by the server on the stream and stored on the
   * message. It is the *server's* answer, not an echo of what the client asked for,
   * so the line under an answer can say "nothing was read" when that is what
   * actually happened (the file was renamed or deleted after the chip was set).
   */
  context?: {
    attached: boolean;
    openPath?: string | null;
    openAttached?: boolean;
    files?: number;
    included?: number;
    truncated?: number;
    omitted?: number;
    chars?: number;
    requested?: string;
    reason?: "not_found" | "empty_project";
  };
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

/**
 * One line under an answer: which project file it was written against, in the numbers
 * the server reported. Truncation is named because a model that answered about a file
 * it only saw half of is the thing a reader is entitled to know about.
 */
function ContextNote({
  context,
}: {
  context: NonNullable<Msg["context"]>;
}) {
  if (!context.attached) {
    const why =
      context.reason === "empty_project"
        ? "this project has no files yet"
        : "that file is not in this project any more";
    return (
      <p
        className="mt-2 text-[11px] leading-snug"
        style={{ color: "var(--muted)" }}
        data-context-note="none"
      >
        No workspace context was read — {why}.
      </p>
    );
  }
  const k = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);
  const parts = [k(context.chars || 0)];
  const others = (context.included || 0) - (context.openAttached ? 1 : 0);
  if (others > 0) parts.push(`${others} other file${others === 1 ? "" : "s"}`);
  if (context.truncated) parts.push(`${context.truncated} truncated`);
  if (context.omitted) parts.push(`${context.omitted} over budget`);
  return (
    <p
      className="mt-2 text-[11px] leading-snug"
      style={{ color: "var(--muted)" }}
      data-context-note="attached"
    >
      Read <span className="font-mono">{context.openPath || "the project"}</span> ·{" "}
      {parts.join(" · ")} of context
    </p>
  );
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

/* The Models sheet's captions, and the arithmetic its two summaries share. Presentation lives here;
   which models exist, and whether they can be called, comes only from /api/ai/models. */
const MODEL_CAPTION: Record<string, string> = {
  chat: "Chat & reasoning",
  code: "Code",
  image: "Image",
  audio: "Voice",
  stt: "Transcription",
  vision: "Image reading",
};

const readyCount = (info: ModelsInfo) =>
  Object.values(info.ready).reduce((n, r) => n + r.ready, 0);
const readyTotal = (info: ModelsInfo) =>
  Object.values(info.ready).reduce((n, r) => n + r.total, 0);

function Dashboard() {
  const [view, setView] = useState<"home" | "app">("home");
  const [mode, setMode] = useState<Mode>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /* Which history groups the person folded up. Deliberately not persisted: the sidebar renders
     on the client after the session loads, so a preference read from storage at first render
     would either flash the unfolded list or hydrate into a different tree than the server sent.
     The one place a fold is worth keeping across a reload - the rail width - is the same
     trade-off and is left alone for the same reason. */
  const [foldedGroups, setFoldedGroups] = useState<string[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState<
    null | "auth" | "settings" | "plans" | "profile" | "models" | "skills" | "byok" | "teams" | "compare" | "creations"
  >(null);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  /* Not a `modal` value: the palette is orthogonal to which sheet is open (it is how you get to
     one), it closes on its own terms, and folding it into the union would make every sheet's
     `onClose={() => setModal(null)}` a second way to dismiss it by accident. */
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  /* What this deployment can call, from `/api/ai/models`. The sheet used to render the marketing
     ladder (`all`), which lists "coming soon" seats nobody can pick — and when the fetch failed it
     fell back to a hardcoded list containing an invented model. A read-out about *which model
     answers you* is the one place a made-up row is unacceptable, so there is no fallback: the sheet
     says it failed and offers to try again. `null` while loading, and the two are told apart. */
  const [modelsInfo, setModelsInfo] = useState<ModelsInfo | null>(null);
  const [modelsErr, setModelsErr] = useState("");

  // web search + vision attachment
  const [webSearchOn, setWebSearchOn] = useState(false);
  const [comparePrompt, setComparePrompt] = useState("");
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareRun | null>(null);
  /* Which lanes this run should ask. `null` means "the deployment's default set", and the set
     itself is read from the server (`GET /api/ai/compare`) rather than copied into this file —
     three hard-coded seats used to be the only answer anyone could get, and a picker built on a
     guess about them is how a client ends up offering a model the server refuses. */
  const [laneContract, setLaneContract] = useState<CompareContract | null>(null);
  const [laneErr, setLaneErr] = useState("");
  const [laneIds, setLaneIds] = useState<string[] | null>(null);
  const [compareErr, setCompareErr] = useState("");
  /* The mix. `mixes[0]` is the run's own combined answer and every later entry is one the reader
     folded themselves, so the strip can say which is which (and which cost a credit). `null`
     include means "every lane that answered", which is what the run did. */
  const [mixes, setMixes] = useState<MixEntry[]>([]);
  const [mixView, setMixView] = useState(0);
  const [mixInclude, setMixInclude] = useState<string[] | null>(null);
  const [mixBusy, setMixBusy] = useState(false);
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
  // Chat -> workspace (UI step 9): opt-in per file. The chip in the composer is the
  // only way context gets attached, because "silently read whatever is open" is how a
  // chat product ends up spending tokens and quoting files the reader never meant to send.
  const [chatCtxPath, setChatCtxPath] = useState<string | null>(null);
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
  const [canvasVersions, setCanvasVersions] = useState<CanvasVersion[]>([]);
  const [canvasActionBusy, setCanvasActionBusy] = useState<string | null>(null);
  const [canvasConsole, setCanvasConsole] = useState<{
    kind: "run" | "test" | "note";
    ok: boolean;
    text: string;
  } | null>(null);

  // response style (human-language controls)
  const [depth, setDepth] = useState<"short" | "balanced" | "detailed" | "deep">("balanced");
  const [tone, setTone] = useState<"simple" | "standard" | "expert">("standard");
  const [streamPhase, setStreamPhase] = useState("");
  const lastPrompt = useRef("");
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // share
  const [shareNote, setShareNote] = useState("");
  /* Which answer of this chat currently has a link being minted, or a save in flight: the buttons
     show a spinner for that one message only, so twelve answers do not all go idle at once. */
  const [sharingMsg, setSharingMsg] = useState<string | null>(null);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  /* Answers promoted to creations *this session*. It is a hint for the row's label, not the source
     of truth — the panel reads the server — and re-saving is idempotent server-side, so being
     wrong after a reload costs a refresh rather than a duplicate. */
  const [savedAnswers, setSavedAnswers] = useState<string[]>([]);
  /** /api/projects answers with the store's cap; 0 until the first read lands. */
  const [projNameMax, setProjNameMax] = useState(0);
  /* ── Step 11 sweep: name fields, a delete form, and per-chat composer drafts ── */
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteSecret, setDeleteSecret] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  /**
   * One unsent message per conversation, in memory only. A draft that survives switching
   * chats is the difference between "my text is still where I left it" and a half-written
   * message landing in the wrong thread; persisting it to storage would outlive a reload
   * with no way to tell the reader which chat it belonged to, so it does not.
   */
  const draftsRef = useRef(new Map<string, string>());
  const [verifying, setVerifying] = useState<string | null>(null);

  // BYOK
  const [byokKeys, setByokKeys] = useState<{ groq: string | null; openrouter: string | null }>({ groq: null, openrouter: null });
  const [byokActive, setByokActive] = useState(false);
  const [byokDraft, setByokDraft] = useState({ groq: "", openrouter: "" });
  const [byokBusy, setByokBusy] = useState(false);
  const [byokNote, setByokNote] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  /** Bumped when the reader leaves a stream so late tokens cannot rewrite another chat. */
  const streamEpochRef = useRef(0);
  /** Bumped on every history click so a slower load cannot overwrite a later one. */
  const openEpochRef = useRef(0);
  const convIdRef = useRef<string | null>(null);
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

  /* Two mechanisms, two jobs, by design: the chips above narrow the list (a *filter*), the
     headers below organise what is left (a *presentation*). Grouping never removes a chat -
     `groupHistory` places every item by an `else`, and the chips keep working on top of it, so
     "Projects: Launch" still shows only that group. The rules live in lib/client/groupHistory.ts
     where a test can run them. */
  const historyGroups = useMemo(
    () => groupHistory(filteredHistory, { projects, teams }),
    [filteredHistory, projects, teams]
  );

  /* One list, two surfaces (the sidebar and the phone drawer), so one answer to "what does empty
     mean here" — and it has to be the *right* answer. A single fixed sentence over a search that
     matched nothing tells a person their work is gone, which is the one thing an empty state must
     never imply. Null when there is something to show, so both call sites render nothing. */
  const emptyChats = (() => {
    if (filteredHistory.length) return null;
    const q = search.trim();
    if (q) {
      return {
        title: "No chat matches that search",
        body: `Nothing titled or saying “${q.slice(0, 40)}”.`,
        action: { label: "Clear search", onClick: () => setSearch("") },
      };
    }
    const scope = activeTeam
      ? teams.find((t) => t.id === activeTeam)?.name
      : activeProject
        ? projects.find((x) => x.id === activeProject)?.name
        : null;
    if (scope) {
      return {
        title: `Nothing in “${scope}” yet`,
        body: "Chats you start while it is selected get filed here.",
        action: {
          label: "Show all chats",
          onClick: () => {
            setActiveProject(null);
            setActiveTeam(null);
          },
        },
      };
    }
    return {
      title: "Your chats land here",
      body: "Send a message below — this list fills up as soon as you have an answer.",
    };
  })();

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
      const seen = new Set<string>();
      const rows: HistItem[] = [];
      for (const c of h.conversations) {
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        rows.push({
          id: c.id,
          title: c.title,
          mode: c.mode,
          updatedAt: c.updatedAt,
          preview: c.preview,
          projectId: (c as { projectId?: string | null }).projectId ?? null,
          teamId: (c as { teamId?: string | null }).teamId ?? null,
          mine: (c as { mine?: boolean }).mine ?? true,
        });
      }
      setHistory(rows);
    } catch {
      /* keep the rail as-is — an empty list here would look like history was deleted */
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
      setProjNameMax(p.nameMax || 0);
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

  /** Kept separate from the mount effect so the sheet's Retry refetches instead of apologising. */
  const loadModels = useCallback(() => {
    setModelsErr("");
    return fetchModels()
      .then((m) => setModelsInfo(m))
      .catch((e) => {
        // A keyless deployment answers 200 with everything marked unavailable; a 500 or a dead
        // server must not be shown as "you have no models".
        setModelsInfo(null);
        setModelsErr((e as Error).message || "The model list could not be read.");
      });
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
    void loadModels();
  }, [refreshMe, refreshHistory, refreshGenerations, refreshProjects, refreshTeams, loadModels]);


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
      // …and the model lists are refetched, because "which lanes can run" is now answered with
      // this key in mind: /api/ai/models drives both the Models sheet and the compare picker, so
      // without this the row they just made live would still say "no key here" until a reload.
      void loadModels();
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

  // Deep links the auth sheet actually honours. /?welcome=1 used to land back on the
  // marketing page (and stash the toast in the *teams* sheet, which is closed), so a
  // finished Google/GitHub login looked like a no-op. /?auth=login|register is what
  // "Log in & buy" and the reset page point at — without a reader those links were
  // just "/". Guest mode stays: we do not bounce a visitor to a login wall.
  const oauthTried = useRef(false);
  useEffect(() => {
    if (oauthTried.current) return;
    oauthTried.current = true;
    const q = new URLSearchParams(window.location.search);
    const oauth = q.get("oauth");
    const auth = (q.get("auth") || "").toLowerCase();
    const wantsSignup =
      auth === "register" || auth === "signup" || q.get("signup") === "1" || q.get("register") === "1";
    const wantsLogin = auth === "login" || q.get("login") === "1";

    const stripAuthQuery = () => {
      const url = new URL(window.location.href);
      for (const key of ["welcome", "oauth", "auth", "login", "signup", "register", "provider"]) {
        url.searchParams.delete(key);
      }
      const next = url.pathname + url.search + url.hash;
      window.history.replaceState({}, "", next);
    };

    if (q.get("welcome")) {
      stripAuthQuery();
      void refreshMe();
      setView("app");
      setShareNote("Logged in ✓ — welcome to your workspace");
      setTimeout(() => setShareNote(""), 3500);
      return;
    }
    if (oauth) {
      stripAuthQuery();
      setAuthTab("login");
      setModal("auth");
      setAuthNotice(
        oauth === "setup"
          ? "Social sign-in needs provider keys on the server — use email for now (it works great)."
          : "Sign-in with that provider didn't complete. Try again or use email."
      );
      return;
    }
    if (wantsSignup) {
      stripAuthQuery();
      setAuthTab("register");
      setModal("auth");
      return;
    }
    if (wantsLogin) {
      stripAuthQuery();
      setAuthTab("login");
      setModal("auth");
    }
  }, [refreshMe]);

  // A signed-in cookie belongs in the workspace. Refreshing / used to dump a
  // logged-in person back on the marketing page (the header said "Open workspace"
  // so the session was there, the view was not). Guests stay on the landing page.
  // The ref is so tapping the logo to go home is not immediately bounced back.
  const landedInWorkspace = useRef(false);
  useEffect(() => {
    if (me?.kind !== "user" || landedInWorkspace.current) return;
    landedInWorkspace.current = true;
    setView("app");
  }, [me?.kind]);

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

  const abandonStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamEpochRef.current += 1;
    setStreaming(false);
  };

  const newChat = () => {
    // Local composer only — never DELETE / overwrite a stored thread.
    draftsRef.current.set(convId || "__new", input);
    abandonStream();
    convIdRef.current = null;
    setConvId(null);
    setMessages([]);
    setInput("");
    setError("");
    setCodePanel("// generated code lands here\n");
    setModelTag("");
    setView("app");
    setMode("chat");
    setDrawer(false);
    setConvProjectId(null);
    setConvTeamId(null);
    setCanvasTab("code");
    setAttachment(null);
    // A new chat starts with nothing attached - not even the file the last one read.
    setChatCtxPath(null);
  };

  const openHist = async (id: string) => {
    draftsRef.current.set(convId || "__new", input);
    abandonStream();
    const streamAtOpen = streamEpochRef.current;
    const epoch = ++openEpochRef.current;
    convIdRef.current = id;
    setConvId(id);
    setError("");
    setMessages([]);
    setView("app");
    setDrawer(false);
    try {
      const c = await loadConversation(id);
      if (epoch !== openEpochRef.current) return;
      if (streamEpochRef.current !== streamAtOpen) return;
      const seen = new Set<string>();
      const next: Msg[] = [];
      for (const m of c.messages || []) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        if (!m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        next.push({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          sources: m.meta?.sources,
          context: m.meta?.context as Msg["context"],
          understood: m.meta?.understood,
          ...(m.meta?.qualityLabel ? { quality: { label: m.meta.qualityLabel, notes: [] } } : {}),
        });
      }
      setConvId(c.id);
      convIdRef.current = c.id;
      setMessages(next);
      setMode((c.mode as Mode) || "chat");
      setConvProjectId((c as { projectId?: string | null }).projectId ?? null);
      setConvTeamId((c as { teamId?: string | null }).teamId ?? null);
      setCanvasTab("code");
      setInput(draftsRef.current.get(c.id) || "");
      setChatCtxPath(null);
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
      if (epoch !== openEpochRef.current) return;
      setError((e as Error).message);
    }
  };

  /* Both aborts are useCallback with no dependencies — refs and setters only — because the global
     Escape handler below lists them, and a function recreated on every render would tear that
     listener down and rebuild it on every keystroke. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

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

  /**
   * One answer, its own public page: the question and that reply. The chat's own share (the header
   * button) is a different link over a different snapshot, and `/s/[id]` renders both because both
   * are rows in the same `shares` table — that is the whole reason this is 12 lines here.
   */
  const shareThisAnswer = async (m: Msg) => {
    if (!convId || sharingMsg) return;
    setSharingMsg(m.id);
    try {
      const s = await shareAnswer(convId, m.id);
      const url = `${window.location.origin}${s.url}`;
      // Same clipboard-first, show-the-url-fallback path as the chat link: on http:// in a browser
      // that refuses the API, the link is still usable if it is on screen.
      try {
        await navigator.clipboard.writeText(url);
        setShareNote("Answer link copied to clipboard ✓");
      } catch {
        setShareNote(url);
      }
      setTimeout(() => setShareNote(""), 4500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSharingMsg(null);
    }
  };

  const saveThisAnswer = async (m: Msg) => {
    if (!convId || savingMsg) return;
    setSavingMsg(m.id);
    try {
      await saveAnswer(convId, m.id);
      setSavedAnswers((ids) => (ids.includes(m.id) ? ids : [...ids, m.id]));
      setShareNote("Saved to creations — name it, pin it or publish it from there ✓");
      setTimeout(() => setShareNote(""), 4500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingMsg(null);
    }
  };

  const downloadAnswer = (m: Msg) => {
    const blob = new Blob([m.content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "buildwe-answer.txt";
    a.click();
  };

  const rateAnswer = async (vote: "up" | "down", messageId: string) => {
    await sendFeedback(vote, vote === "up" ? "helpful and on-topic" : "missed my message or too generic");
    setCopied(`${vote}-${messageId}`);
    setTimeout(() => setCopied(null), 1000);
  };

  /** The lane list and its price, read when the sheet opens. Separate from `loadModels` on purpose:
   *  the picker needs `/api/ai/models` *and* `/api/ai/compare`, and a retry should say which one
   *  failed rather than silently refetching a list that was fine. */
  const loadLanes = useCallback(() => {
    setLaneErr("");
    return fetchCompareContract()
      .then((c) => setLaneContract(c))
      .catch((e) => {
        setLaneContract(null);
        setLaneErr((e as Error).message || "The comparison settings could not be read.");
      });
  }, []);

  const chosenLanes = useMemo(() => {
    if (laneIds) return laneIds;
    return (laneContract?.defaults || []).map((d) => d.id);
  }, [laneIds, laneContract]);
  /** What the run will be held for, computed from the server's own per-lane price. */
  const compareCost = (laneContract?.perLane || 0) * chosenLanes.length;
  /** 0 unless the wallet has actually been read — an unloaded balance is not a reason to block a
   *  button, and a stale-low one is the reason the server's hold stays the real gate. */
  const compareShort =
    laneContract && wallet.loaded && compareCost > wallet.balance ? compareCost - wallet.balance : 0;
  /* Which answers the combined one is made of. Until the reader touches a checkbox that is
     "every lane that answered" — the same set the run itself was judged on. */
  const mixLanes = useMemo(() => {
    const live = (compareResult?.lanes || []).filter((l) => l.live && l.reply.trim());
    if (!mixInclude) return live.map((l) => l.id);
    return live.filter((l) => mixInclude.includes(l.id)).map((l) => l.id);
  }, [compareResult, mixInclude]);
  const mixCost = laneContract?.mixCost ?? laneContract?.perLane ?? 1;
  const mixShort =
    wallet.loaded && mixes.length > 0 && mixCost > wallet.balance ? mixCost - wallet.balance : 0;

  /** Toggle a lane. Bounded to the range the server enforces, so a click can't produce a 400. */
  const toggleLane = (id: string) => {
    const max = laneContract?.maxLanes || 6;
    const min = laneContract?.minLanes || 2;
    setLaneIds((prev) => {
      const cur = prev || (laneContract?.defaults || []).map((d) => d.id);
      if (cur.includes(id)) {
        return cur.length <= min ? cur : cur.filter((x) => x !== id);
      }
      return cur.length >= max ? cur : [...cur, id];
    });
  };

  const doCompare = async () => {
    const p = comparePrompt.trim();
    if (!p || compareBusy) return;
    setCompareBusy(true);
    setError("");
    setCompareErr("");
    try {
      const r = await compareApi(p, laneContract ? chosenLanes : undefined);
      setCompareResult(r);
      // One entry per combined answer, starting with the one this run produced: the reader can
      // fold a subset and step back to this one rather than losing it.
      const from = r.combinedFrom || r.lanes.filter((l) => l.live).map((l) => l.id);
      setMixes(
        r.available
          ? [{ synthesis: r.synthesis || r.synthesisNote || "", from, paid: false }]
          : []
      );
      setMixView(0);
      setMixInclude(null);
      refreshMe();
    } catch (e) {
      // The route refuses a bad lane list with a `hint` that says what to send instead; a sheet
      // that swallowed that into the page-level toast would hide the only actionable part of it.
      const err = e as Error & { hint?: string };
      setCompareErr(err.hint ? `${err.message} ${err.hint}` : err.message);
    } finally {
      setCompareBusy(false);
    }
  };

  const toggleMixLane = (id: string) => {
    setMixInclude((prev) => {
      const cur = prev || (compareResult?.lanes || []).filter((l) => l.live).map((l) => l.id);
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  };

  /** Fold the checked answers into a new combined one. No model is re-asked, so the price is one
   *  lane's worth and the server says so on the button rather than the client quoting itself. */
  const doMix = async () => {
    const p = comparePrompt.trim();
    if (!p || mixBusy || mixLanes.length < 2) return;
    setMixBusy(true);
    setCompareErr("");
    try {
      const byId = new Map((compareResult?.lanes || []).map((l) => [l.id, l] as const));
      const answers = mixLanes.map((id) => ({ id, reply: byId.get(id)?.reply || "" }));
      const r = await compareMixApi(p, answers);
      if (!r.available) {
        setMixes((m) => [
          ...m,
          {
            synthesis: "",
            from: mixLanes,
            used: r.used,
            paid: true,
            note: r.message || "The combined-answer pass could not run, so nothing was charged.",
          },
        ]);
        setMixView(mixes.length);
        setMixInclude(mixLanes);
        return;
      }
      setMixes((m) => [...m, { synthesis: r.synthesis, from: mixLanes, used: r.used, paid: true }]);
      setMixView(mixes.length);
      // The new entry is built from exactly what was checked, so the checkbox state has to follow
      // it: leaving it behind would make the button look stale one step later.
      setMixInclude(mixLanes);
      refreshMe();
    } catch (e) {
      const err = e as Error & { hint?: string };
      setCompareErr(err.hint ? `${err.message} ${err.hint}` : err.message);
    } finally {
      setMixBusy(false);
    }
  };

  const openCompare = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    setComparePrompt(input.trim() || lastUser.slice(0, 500));
    setCompareResult(null);
    setCompareErr("");
    setMixes([]);
    setMixView(0);
    setMixInclude(null);
    setModal("compare");
  };

  /* Read the lane contract when the sheet opens — from *any* opening. The composer button and the
     ⌘K palette both reach this sheet, and an effect that only the button called left the palette
     route staring at "Reading which models this run can ask…" forever. Refetched on every open
     rather than cached: the default lanes depend on which keys are connected right now. */
  useEffect(() => {
    if (modal === "compare") void loadLanes();
  }, [modal, loadLanes]);

  /**
   * Go back to a saved version without losing the one on screen. The list used to be
   * one-way: picking version 4 replaced the canvas and the content you were looking at was
   * simply not in the list any more, so a mis-click had no way back except undo-by-memory.
   */
  const restoreCanvasVersion = (v: CanvasVersion) => {
    if (v.code === codePanel) return;
    if (codePanel.trim()) pushCanvasVersion(codePanel, codeLang);
    setCodePanel(v.code);
    setCodeLang(v.lang);
    beat("canvas_version_restore");
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

  /**
   * Create a project from whatever the field holds. It rethrows after reporting, because
   * the two callers keep their input on failure and clear it on success — a `window.prompt`
   * could not do the first half, which is why a failed name used to vanish.
   */
  const doNewProject = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const { project } = await createProject(trimmed);
      const item: ProjectItem = { ...project, createdAt: new Date().toISOString() };
      setProjects((ps) => [...ps, item]);
      await doAssignProject(item.id);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };

  const doAssignTeam = async (teamId: string | null) => {
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

  const doNewTeam = async (name?: string) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    try {
      const { team } = await createTeam(trimmed);
      setTeams((ts) => [...ts, team]);
      setNewTeamName("");
      setTeamNote(`Team “${team.name}” created — invite friends with the code below.`);
    } catch (e) {
      // The field keeps its text on failure: the name is the thing worth retrying.
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

  useEffect(() => {
    // A path belonging to another project is not "still selected", it is a bug
    // waiting to be attached. Drop it rather than resolve it against the wrong project.
    setChatCtxPath(null);
  }, [currentProjectId]);

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

  /**
   * Write a code block from an answer into the project. Returns the error *sentence*
   * to show, or null on success - the row owns its own state, so this must not throw
   * over a path the model invented.
   */
  const applyFileBlock = async (block: {
    path: string;
    content: string;
    lang: string | null;
  }): Promise<string | null> => {
    if (!currentProjectId) {
      return "Pick a project first - files are saved inside a project.";
    }
    try {
      await saveProjectFileApi({
        projectId: currentProjectId,
        path: block.path,
        content: block.content,
        ...(block.lang ? { lang: block.lang } : {}),
      });
      // Its own counter: "the model wrote a file" and "the reader pressed Save canvas"
      // are different features, and one number for both hides which one is used.
      beat("project_file_apply");
      await loadProjFiles();
      // If that file is the one open in the canvas, the canvas has to agree with the
      // file straight away - and the version history keeps the previous content first,
      // so the existing Restore affordance covers this with no new machinery.
      const openPath = projFiles.find((f) => f.id === openFileId)?.path;
      if (openPath && openPath === block.path) {
        pushCanvasVersion(codePanel, codeLang);
        setCodePanel(block.content);
        setCodeLang(block.lang || codeLang);
      }
      return null;
    } catch (e) {
      return (e as Error).message || "Save failed.";
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


  /* ── Creations (the artifacts list) ────────────────────── */

  /**
   * Put a stored code answer into the canvas. The content that was in the canvas becomes
   * a version first — the same promise the file-apply rows keep — so the existing History
   * / Restore covers "I opened the wrong thing over my work" without new machinery.
   */
  const openArtifactCode = (code: string, lang: string) => {
    if (codePanel.trim()) pushCanvasVersion(codePanel, codeLang);
    setCodePanel(code);
    setCodeLang(lang);
    setMode("code");
    setCanvasTab("code");
    setModal(null);
    beat("artifact_open_canvas");
  };

  /** The studios restore their own history on mount, so switching is the whole action. */
  const openArtifactStudio = (kind: "image" | "audio") => {
    setMode(kind);
    setModal(null);
    beat("artifact_open_studio");
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
    draftsRef.current.delete(convId || "__new");
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

  const stopAgent = useCallback(() => {
    agentAbort.current?.abort();
    agentAbort.current = null;
    setAgentBusy(false);
    setAgentLog((l) => [...l, { kind: "msg", label: "Stopped by you." }]);
  }, []);

  /**
   * Every palette row lands here. The switch is exhaustive over `PaletteKind` on purpose: a new
   * kind in lib/client/palette.ts does not compile until the page says what it does, which is the
   * only guarantee that a rendered row is never a dead one.
   */
  const pickPaletteRow = (row: PaletteRow) => {
    switch (row.kind) {
      case "new":
        newChat();
        break;
      case "stop":
        if (agentBusy) stopAgent();
        else stop();
        break;
      case "mode":
        switchMode(row.value as Mode);
        break;
      case "modal":
        setModal(row.value as "auth" | "settings" | "plans" | "profile" | "models" | "skills" | "byok" | "teams" | "compare" | "creations");
        break;
      case "theme":
        setThemePref(row.value as ThemePref);
        break;
      case "chat":
        void openHist(row.value);
        break;
      case "tool":
      case "studio":
        // MenuRow renders those as links (`/tools/[slug]`, `/studios/[slug]`), the same plain <a>
        // the sidebar uses for the two index pages. Nothing to do here, and nothing to fake.
        break;
    }
  };

  /**
   * The workspace's three shortcuts. Registered once, on the app view only — the landing page is a
   * document about the product, not a place to run ⌘K.
   *
   * Escape is the one that needed a rule rather than a check: popovers consume it on `document` and
   * `Sheet` consumes it on `window`, both marking the event handled, and `document` fires before
   * `window`. So `e.defaultPrevented` IS the precedence — this listener stops a run only when
   * nothing nearer the keyboard wanted the key. No layer tracks any other layer's open state.
   */
  useEffect(() => {
    if (view !== "app") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Chrome/Safari give ⌘K to the address bar's search; taking it is the point of the shortcut.
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const composer = document.querySelector<HTMLTextAreaElement>("[data-composer]");
        if (!composer) return;
        e.preventDefault();
        composer.focus({ preventScroll: true });
        return;
      }
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (agentBusy) {
          e.preventDefault();
          stopAgent();
        } else if (streaming) {
          e.preventDefault();
          stop();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, agentBusy, streaming, stop, stopAgent]);

  const send = async (
    override?: string,
    retry?: { altModel?: number; baseMessages?: Msg[] }
  ) => {
    const text = (override ?? input).trim();
    if ((!text && !attachment) || streaming || visionBusy) return;
    setError("");
    setView("app");
    setInput("");
    draftsRef.current.delete(convId || "__new");
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
    const epoch = ++streamEpochRef.current;

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
          conversationId: convIdRef.current ?? convId,
          webSearch: useSearch,
          projectId: convProjectId ?? activeProject ?? null,
          teamId: convTeamId ?? activeTeam ?? null,
          depth,
          tone,
          ...(retry?.altModel ? { altModel: retry.altModel } : {}),
          // One file, if the reader pointed at one. No `context` field means the server
          // sends no workspace block at all - the absence is the signal.
          ...(chatCtxPath && currentProjectId
            ? { context: { projectId: currentProjectId, path: chatCtxPath } }
            : {}),
        },
        (ev) => {
          if (epoch !== streamEpochRef.current) return;
          if (ev.meta && typeof ev.meta === "object") {
            const meta = ev.meta as {
              conversationId?: string;
              model?: string;
              live?: boolean;
              sources?: Msg["sources"];
              context?: Msg["context"];
              understood?: string;
              clarifier?: string;
              fallbackNote?: string;
            };
            if (meta.conversationId) {
              const cur = convIdRef.current;
              if (cur === null || cur === meta.conversationId) {
                convIdRef.current = meta.conversationId;
                setConvId(meta.conversationId);
              }
            }
            if (meta.model) setModelTag(String(meta.model));
            if (
              meta.understood ||
              meta.sources?.length ||
              meta.context ||
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
                        ...(meta.context ? { context: meta.context } : {}),
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
      if (epoch === streamEpochRef.current) {
        refreshMe();
        refreshHistory();
        // keep a version snapshot for the canvas
        if (resolved === "code") {
          const blocks = extractCode(acc);
          if (blocks.length) {
            pushCanvasVersion(blocks[blocks.length - 1].code, blocks[blocks.length - 1].lang);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError" && epoch === streamEpochRef.current) {
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
      if (epoch === streamEpochRef.current) {
        setStreaming(false);
        abortRef.current = null;
        setStreamPhase("");
        streamPhaseRef.current = "";
        if (phaseTimer.current) clearTimeout(phaseTimer.current);
      }
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

  const openAuth = (tab: "login" | "register") => {
    setAuthTab(tab);
    setAuthErr("");
    setAuthNotice("");
    setModal("auth");
  };

  const onAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr("");
    setAuthBusy(true);
    try {
      // Autofill often skips React onChange. Read the named fields from the
      // form so a filled-but-"empty" email still reaches POST /api/auth/login.
      const form = e.currentTarget as HTMLFormElement;
      const fd = new FormData(form);
      const emailVal = String(fd.get("email") || email).trim();
      const passwordVal = String(fd.get("password") || password);
      const nameVal = String(fd.get("name") || name);
      setEmail(emailVal);
      setPassword(passwordVal);
      if (authTab === "register") setName(nameVal);
      if (authTab === "login") await apiLogin(emailVal, passwordVal);
      else await apiRegister(emailVal, passwordVal, nameVal || undefined);
      const m = await fetchMe();
      if (m.kind !== "user") throw new Error("Invalid email or password.");
      setMe(m);
      await refreshHistory();
      setModal(null);
      setAuthNotice("");
      setPassword("");
      setDrawer(false);
      // Closing the sheet on the marketing page used to look like a dead click:
      // the header still said "Log in" and nothing else changed.
      setView("app");
      setShareNote(authTab === "register" ? "Account created ✓ — this workspace is yours" : "Logged in ✓");
      setTimeout(() => setShareNote(""), 3500);
    } catch (err) {
      setAuthErr((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  /**
   * Both plans sheets (the workspace one and the mobile drawer's) used to carry their own
   * copy of this, and the drawer's copy forgot the logged-in branch — so a signed-in person
   * tapping "Upgrade to PRO" there got the *login* form. One handler, both call sites.
   */
  const goProFromPlans = () => {
    if (!loggedIn) {
      openAuth("register");
      return;
    }
    setModal(null);
    // Seats and the gateway live on /pricing; the sheet stays a summary rather than a
    // second checkout that could disagree with it.
    window.location.href = "/pricing";
  };

  const doLogout = async () => {
    await apiLogout();
    abandonStream();
    convIdRef.current = null;
    setConvId(null);
    setMessages([]);
    setHistory([]);
    await refreshMe();
    await refreshHistory();
    setModal(null);
  };

  /**
   * Account deletion, inside the app rather than in a browser dialog.
   *
   * This used to ask for the account **password** with `window.prompt`, which is wrong on
   * three counts at once: a prompt renders what you type in plain text, it sits outside the
   * app's focus management (and outside `Sheet`, whose job is exactly that), and some
   * embedded browsers refuse `prompt` outright and return null — so the button did nothing
   * at all, with no message anywhere. Here the field is a real `type="password"`, a refusal
   * is reported where the person is looking, and an OAuth account — which has no password to
   * give — still has to write the word.
   */
  const oauthOnly =
    (me?.user as unknown as { provider?: string } | undefined)?.provider === "google" ||
    (me?.user as unknown as { provider?: string } | undefined)?.provider === "github";

  const doDeleteAccount = async (answer: string) => {
    const value = answer.trim();
    if (!value || authBusy) return;
    const isOauth = oauthOnly;
    setAuthBusy(true);
    setDeleteErr("");
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
      setDeleteArmed(false);
      setDeleteSecret("");
      await refreshMe();
      setTeamNote("Account deleted. We're sorry to see you go.");
    } catch (e) {
      // The strip in the sheet, not window.alert: an alert steals focus, cannot be styled,
      // and is gone the moment it is dismissed — with no way to read the reason again.
      setDeleteErr((e as Error).message);
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
            {loggedIn ? (
              <Btn size="sm" onClick={() => setView("app")}>
                Open workspace <ArrowRight className="h-3.5 w-3.5" />
              </Btn>
            ) : (
              <>
                <Btn variant="ghost" size="sm" onClick={() => openAuth("login")}>
                  Log in
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => openAuth("register")}>
                  Sign up
                </Btn>
                <Btn size="sm" className="hidden sm:inline-flex" onClick={() => setView("app")}>
                  Enter app <ArrowRight className="h-3.5 w-3.5" />
                </Btn>
              </>
            )}
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
            notice={authNotice}
            busy={authBusy}
            onSubmit={onAuth}
            onClose={() => { setModal(null); setAuthNotice(""); }}
          />
        )}
        {modal === "plans" && (
          <PlansSheet plan={plan} onClose={() => setModal(null)} onPro={goProFromPlans} />
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

        <div className="flex items-center gap-1.5 p-2.5">
          <button
            type="button"
            onClick={newChat}
            className={clsx("flex min-w-0 flex-1 items-center gap-2 rounded-2xl border py-2.5 text-sm font-medium", sidebarOpen ? "px-3" : "justify-center")}
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <Plus className="h-4 w-4" style={{ color: "var(--accent)" }} />
            {sidebarOpen && "New chat"}
          </button>
          {/* A shortcut nobody can find is a hidden feature, so the key is printed where the
              action lives. Icon-only in the collapsed rail, same 40px target as its neighbour. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Quick find"
            title="Quick find — chats, modes, sheets, tools (⌘K)"
            className={clsx("flex h-10 shrink-0 items-center gap-1.5 rounded-2xl border px-2 text-[10px] font-semibold", !sidebarOpen && "w-10 justify-center px-0")}
            style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--card)" }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
            {sidebarOpen && (
              <>
                Quick find
                <span className="font-mono text-[9px]" style={{ color: "var(--soft)" }}>⌘K</span>
              </>
            )}
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
                  <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search history" placeholder="Search" className="h-9 w-full rounded-xl pl-8 pr-2 text-xs outline-none" style={{ background: "var(--secondary)" }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveProject(null)}
                    aria-pressed={!activeProject}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={!activeProject ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    All
                  </button>
                  {projects.map((p) => (
                    <span key={p.id} className="bw-side-item group inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => setActiveProject(p.id)}
                        aria-pressed={activeProject === p.id}
                        className="rounded-l-full px-2 py-1 text-[10px] font-semibold"
                        style={activeProject === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${p.name}`}
                        className="bw-side-hover rounded-r-full px-1 py-1"
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
                    aria-expanded={newProjOpen}
                    onClick={() => setNewProjOpen((v) => !v)}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={{ background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    <Plus className="mr-0.5 inline h-2.5 w-2.5" />Project
                  </button>
                  {/* The name is asked for in the row it belongs to, not in a browser dialog:
                      the field keeps what was typed when the server says no, which a
                      window.prompt cannot do — it closes and the name is gone. */}
                  {newProjOpen && (
                    <span className="mt-1 flex w-full items-center gap-1.5">
                      <input
                        autoFocus
                        value={newProjName}
                        onChange={(e) => setNewProjName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setNewProjOpen(false);
                          }
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void doNewProject(newProjName)
                              .then(() => {
                                setNewProjName("");
                                setNewProjOpen(false);
                              })
                              .catch(() => {});
                          }
                        }}
                        {...(projNameMax ? { maxLength: projNameMax } : {})}
                        aria-label="New project name"
                        placeholder="Startup site, DSA prep…"
                        className="h-7 min-w-0 flex-1 rounded-full border px-2 text-[11px] outline-none"
                        style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--ink)" }}
                      />
                      <button
                        type="button"
                        disabled={!newProjName.trim()}
                        onClick={() =>
                          void doNewProject(newProjName)
                            .then(() => {
                              setNewProjName("");
                              setNewProjOpen(false);
                            })
                            .catch(() => {})
                        }
                        className="rounded-full px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                      >
                        Add
                      </button>
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => { setActiveTeam(null); setActiveProject(null); }}
                    aria-pressed={!activeTeam && !activeProject}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={!activeTeam ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                  >
                    Personal
                  </button>
                  {teams.map((t) => (
                    <span key={t.id} className="bw-side-item group inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => { setActiveTeam(t.id); setActiveProject(null); }}
                        aria-pressed={activeTeam === t.id}
                        className="rounded-l-full px-2 py-1 text-[10px] font-semibold"
                        style={activeTeam === t.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--secondary)", color: "var(--muted)" }}
                      >
                        <Users className="mr-0.5 inline h-2.5 w-2.5" />{t.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Leave ${t.name}`}
                        className="bw-side-hover rounded-r-full px-1 py-1"
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
                    onClick={() => openAuth("register")}
                    className="mt-1.5 w-full rounded-xl py-1.5 text-[11px] font-semibold text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    Create free account
                  </button>
                </div>
              )}
              <div className="bw-side-list min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {historyGroups.map((g) => {
                  /* A user with no projects and no teams has exactly one group, and a "Chats"
                     header above a list that was already called History is decoration that also
                     happens to be a button in the tab order. So: headers appear when there is
                     something to choose between. The row markup below stays a single copy. */
                  const plain = historyGroups.length === 1 && historyGroups[0].kind === "chat";
                  const folded = !plain && foldedGroups.includes(g.key);
                  // Folding must not be able to hide which conversation you are looking at.
                  const holdsOpen = g.items.some((h) => h.id === convId);
                  const headId = `bw-side-group-${g.key}`;
                  return (
                    <div key={g.key} className="mb-1">
                      {plain || (
                      <button
                        type="button"
                        id={headId}
                        aria-expanded={!folded}
                        aria-controls={`${headId}-list`}
                        data-action={`group-${g.kind}`}
                        className="bw-side-group__head"
                        title={folded ? `Show ${g.label}${holdsOpen ? " · your open chat is in here" : ""}` : `Hide ${g.label}`}
                        onClick={() =>
                          setFoldedGroups((cur) => (folded ? cur.filter((k) => k !== g.key) : [...cur, g.key]))
                        }
                      >
                        <ChevronRight className="bw-side-group__chev h-3 w-3" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-left">{g.label}</span>
                        {/* The count is outside the button's label so a screen reader reads
                            "Launch, collapsed, 4 items" instead of "Launch 4". */}
                        <span className={clsx("bw-side-group__count", holdsOpen && "is-now")} aria-hidden>{g.items.length}</span>
                      </button>
                      )}
                      {!folded && (
                        <div id={`${headId}-list`} role={plain ? undefined : "group"} aria-labelledby={plain ? undefined : headId} className="space-y-0.5">
                          {g.items.map((h) => (
                            <div key={h.id} className="bw-side-item group flex items-center rounded-xl" style={h.id === convId ? { background: "var(--secondary)" } : undefined}>
                              <button type="button" onClick={() => openHist(h.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                                <div className="truncate text-[13px] font-medium">{h.mine === false && <Users className="mr-1 inline h-3 w-3" style={{ color: "var(--accent)" }} />}{h.title}</div>
                                <div className="truncate text-[10px]" style={{ color: "var(--soft)" }}>{h.mode} · {h.preview}</div>
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${h.title}`}
                                className="bw-side-hover mr-1 flex h-7 w-7 items-center justify-center rounded-lg"
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
                        </div>
                      )}
                    </div>
                  );
                })}
                {emptyChats && (
                  <EmptyState
                    art="chats"
                    compact
                    marker="sidebar-empty"
                    title={emptyChats.title}
                    action={emptyChats.action}
                  >
                    {emptyChats.body}
                  </EmptyState>
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
          <button type="button" onClick={() => setModal("creations")} aria-label="Creations" title={sidebarOpen ? undefined : "Creations"} className={clsx("bw-side-row flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm", sidebarOpen ? "px-3" : "justify-center")} style={{ color: "var(--muted)" }}>
            <Layers className="h-4 w-4" />
            {sidebarOpen && "Creations"}
          </button>
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
            <button type="button" onClick={() => openAuth("login")} className={clsx("flex w-full items-center gap-2.5 rounded-2xl py-2.5 text-sm font-medium", sidebarOpen ? "px-3" : "justify-center")} style={{ background: "var(--ink)", color: "var(--bg)" }}>
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
          <ProjectMoveMenu
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            teams={teams.map((t) => ({ id: t.id, name: t.name, memberCount: t.memberCount }))}
            projectId={convProjectId}
            teamId={convTeamId}
            nameMax={projNameMax}
            onAssignProject={doAssignProject}
            onAssignTeam={doAssignTeam}
            onCreateProject={doNewProject}
            onOpenTeams={() => setModal("teams")}
          />
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
                                {/* One card per link the answer actually cited, read by our own server
                                    (see /api/preview). Not while streaming: a card appearing mid-sentence
                                    moves the text the reader is following. */}
                                {!isUser && !m.streaming && (
                                  <LinkPreviews text={m.content || ""} exclude={m.sources?.map((s) => s.url)} />
                                )}
                                {/* What the answer was built on, in the server's own numbers, and the
                                    Apply rows for any file block in it. Both are assistant-only and
                                    hidden while streaming: a button for a block that has not finished
                                    arriving is a bug. */}
                                {!isUser && !m.streaming && m.context ? <ContextNote context={m.context} /> : null}
                                {!isUser && !m.streaming && (
                                  <FileApplyBlocks
                                    text={m.content || ""}
                                    projectId={currentProjectId}
                                    knownPaths={projFiles.map((f) => f.path)}
                                    onApply={applyFileBlock}
                                  />
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
                                <MessageActions
                                  handlers={{
                                    copy: () => void copy(m.content, m.id),
                                    copied: copied === m.id,
                                    verify: () => void doVerify(m),
                                    verifying: verifying === m.id,
                                    hasVerdict: Boolean(m.verified),
                                    share: () => void shareThisAnswer(m),
                                    sharing: sharingMsg === m.id,
                                    save: () => void saveThisAnswer(m),
                                    saving: savingMsg === m.id,
                                    saved: savedAnswers.includes(m.id),
                                    openCreations: () => setModal("creations"),
                                    regenerate: () => {
                                      const idx = messages.findIndex((x) => x.id === m.id);
                                      const prevUser = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
                                      if (!prevUser || streaming) return;
                                      beat("regenerate");
                                      setMessages((ms) => ms.filter((x) => x.id !== m.id));
                                      setTimeout(() => send(prevUser.content), 30);
                                    },
                                    editPrompt: () => {
                                      const idx = messages.findIndex((x) => x.id === m.id);
                                      const prevUser = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
                                      if (!prevUser) return;
                                      setInput(prevUser.content);
                                      requestAnimationFrame(grow);
                                    },
                                    useAsPrompt: () => {
                                      setInput(m.content.slice(0, 2000));
                                      requestAnimationFrame(grow);
                                      taRef.current?.focus();
                                    },
                                    download: () => downloadAnswer(m),
                                    feedback: (vote) => void rateAnswer(vote, m.id),
                                    transform: (instruction) => void send(instruction),
                                    blocked: streaming,
                                    blockedNote: "Wait for this answer to finish",
                                  }}
                                />
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
        contextPath={chatCtxPath}
        contextNote={
          chatCtxPath
            ? "The next answer reads this file (12 kB budget). Apply can write it back."
            : undefined
        }
        onClearContext={() => setChatCtxPath(null)}
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
                    <CanvasHistoryMenu
                      versions={canvasVersions}
                      currentCode={codePanel}
                      onRestore={restoreCanvasVersion}
                    />
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
                          /* The shared empty state, told to expect a dark surface: its tokens are the
                             panel's, not the page's, which is the difference between reading as part
                             of this panel and reading as a light card dropped on top of one. */
                          <EmptyState art="files" compact dark marker="project-files-empty" title="No files in this project yet">
                            Write something in the canvas, name it above and hit
                            <strong style={{ color: "var(--surface-dark-fg)" }}> Save canvas</strong>.
                          </EmptyState>
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
                                {/* Opt-in chat context. Always focusable and always
                                    labelled — a hover-only reveal here would hide the
                                    whole feature from a keyboard and a tablet. */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setChatCtxPath((cur) => (cur === f.path ? null : f.path))
                                  }
                                  aria-pressed={chatCtxPath === f.path}
                                  aria-label={
                                    chatCtxPath === f.path
                                      ? `Stop using ${f.path} as chat context`
                                      : `Use ${f.path} as chat context`
                                  }
                                  title={
                                    chatCtxPath === f.path
                                      ? "The next chat answer reads this file — click to stop"
                                      : "The next chat answer reads this file"
                                  }
                                  className={clsx(
                                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] transition",
                                    chatCtxPath === f.path
                                      ? "bg-white/20 text-white"
                                      : "text-white/35 hover:bg-white/10 hover:text-white/70"
                                  )}
                                >
                                  @
                                </button>
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
                          Files are private to your account. The coding agent sees the whole
                          project; a chat answer reads only the file you mark with @ above, up to a
                          12 kB budget — and the answer tells you when a file was truncated or left
                          out.
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
              {emptyChats && (
                <EmptyState
                  art="chats"
                  compact
                  marker="drawer-empty"
                  title={emptyChats.title}
                  action={emptyChats.action}
                >
                  {emptyChats.body}
                </EmptyState>
              )}
              {filteredHistory.map((h) => (
                <button key={h.id} type="button" onClick={() => openHist(h.id)} className="mb-0.5 flex w-full rounded-xl px-3 py-2.5 text-left text-sm" style={h.id === convId ? { background: "var(--secondary)" } : undefined}>
                  <span className="truncate font-medium">{h.title}</span>
                </button>
              ))}
            </div>
            <div className="space-y-1 border-t p-3" style={{ borderColor: "var(--border)", paddingBottom: "calc(12px + var(--safe-b))" }}>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ color: "var(--muted)" }} onClick={() => { setDrawer(false); setModal("settings"); }}><Settings className="h-4 w-4" /> Settings</button>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ color: "var(--muted)" }} onClick={() => { setDrawer(false); setModal("creations"); }}><Layers className="h-4 w-4" /> Creations</button>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} onClick={() => { setDrawer(false); setModal("plans"); }}><Zap className="h-4 w-4" /> Plans</button>
              {loggedIn ? (
                <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ color: "var(--muted)" }} onClick={() => { setDrawer(false); setModal("profile"); }}><User className="h-4 w-4" /> Account</button>
              ) : (
                <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ background: "var(--ink)", color: "var(--bg)" }} onClick={() => { setDrawer(false); openAuth("login"); }}><LogIn className="h-4 w-4" /> Log in</button>
              )}
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
        <PlansSheet plan={plan} onClose={() => setModal(null)} onPro={goProFromPlans} />
      )}

      {paletteOpen && (
        <CommandPalette
          open
          onClose={() => setPaletteOpen(false)}
          source={{
            modes: MODE_META.map((m) => ({ id: m.id, label: m.label, blurb: m.sub })),
            history,
            activeMode: mode,
            running: agentBusy ? "agent" : streaming ? "answer" : null,
            signedIn: me?.kind === "user",
          }}
          onPick={pickPaletteRow}
        />
      )}

      {modal === "creations" && (
        <Sheet onClose={() => setModal(null)} title="Your creations" wide>
          <p className="mb-3 text-[12px]" style={{ color: "var(--muted)" }}>
            Every image, voice clip and code answer you have made. Name the ones worth
            keeping, pin them to the top, or send a link that shows exactly one of them.
          </p>
          <CreationsPanel
            onOpenCode={openArtifactCode}
            onShowStudio={openArtifactStudio}
            onOpenChat={(conversationId) => {
              // Back to where the answer was written: close the panel first, or the chat opens
              // underneath a sheet that is still covering it.
              setModal(null);
              void openHist(conversationId);
            }}
          />
        </Sheet>
      )}

      {modal === "compare" && (
        <Sheet onClose={() => setModal(null)} title="Compare models" wide>
          <div className="space-y-3">
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              Ask the same question to 2–6 models at once, then read one combined answer — or check
              the two you liked and fold just those into a new one. A lane that cannot answer is
              refunded, and model agreement is never treated as proof.
            </p>
            <textarea
              value={comparePrompt}
              onChange={(e) => setComparePrompt(e.target.value)}
              placeholder="Type the question you want to compare…"
              rows={3}
              className="w-full resize-none rounded-2xl border px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "inherit" }}
            />

            {/* The lane picker. Its rows are `selectable.chat` from /api/ai/models — the same
                projection the Models sheet reads — and its prices come from /api/ai/compare, so the
                number next to the button is the number the hold will take. Nothing here is guessed. */}
            {laneErr ? (
              <div className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-[12px]" style={{ borderColor: "var(--err)", color: "var(--err)" }} role="alert" data-compare-error>
                <span className="min-w-0 flex-1">{laneErr}</span>
                <Btn size="sm" variant="soft" onClick={() => void loadLanes()}>
                  Retry
                </Btn>
              </div>
            ) : !laneContract ? (
              <p className="flex items-center gap-2 text-[12px]" style={{ color: "var(--muted)" }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading which models this run can ask…
              </p>
            ) : (
              <>
                <CompareLanes
                  rows={modelsInfo?.selectable?.chat || []}
                  selected={chosenLanes}
                  minLanes={laneContract.minLanes}
                  maxLanes={laneContract.maxLanes}
                  perLane={laneContract.perLane}
                  busy={compareBusy}
                  onToggle={toggleLane}
                  onConnectKeys={() => setModal("byok")}
                />
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--muted)" }} data-compare-cost>
                  <span>
                    {chosenLanes.length} lanes × {laneContract.perLane} credit{laneContract.perLane === 1 ? "" : "s"} ={" "}
                    <b style={{ color: "var(--ink)" }}>{compareCost}</b> credit{compareCost === 1 ? "" : "s"}, held before
                    the run and given back for any lane that doesn’t answer.
                  </span>
                  {compareShort && (
                    <>
                      <span style={{ color: "var(--err)" }}>Your balance is {wallet.balance} — {compareShort} short.</span>
                      <Btn size="sm" variant="soft" onClick={openCredits}>
                        <CreditCard className="h-3.5 w-3.5" /> Top up
                      </Btn>
                    </>
                  )}
                </p>
                {!modelsInfo && (
                  <p className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
                    {modelsErr
                      ? "The model list could not be read, so the lanes below are this deployment's defaults."
                      : "The model list is still loading — this run uses the default lanes."}
                    {!!modelsErr && (
                      <Btn size="sm" variant="soft" onClick={() => void loadModels()}>
                        Retry
                      </Btn>
                    )}
                  </p>
                )}
              </>
            )}

            <div className="flex items-center gap-2">
              <Btn
                size="sm"
                onClick={doCompare}
                disabled={!comparePrompt.trim() || compareBusy || Boolean(compareShort)}
              >
                {compareBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                {compareBusy
                  ? `Asking ${chosenLanes.length} models…`
                  : laneContract
                    ? `Run comparison · ${compareCost} credit${compareCost === 1 ? "" : "s"}`
                    : "Run comparison"}
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

            {compareErr && (
              <div className="rounded-2xl border px-3 py-2 text-[12px]" style={{ borderColor: "var(--err)", color: "var(--err)" }} role="alert" data-compare-run-error>
                {compareErr}
              </div>
            )}

            {/* The results are an input, not just a read-out (W3.2): each answer can be folded into
                a fresh combined one, and every answer stays on screen whether it is in the mix or
                not. The offline case comes through here too — same lanes, each saying why it is
                empty — because "no results" is not a useful screen. */}
            {!!compareResult && (
              <CompareResults
                lanes={compareResult.lanes}
                mixes={mixes}
                view={mixView}
                include={mixLanes}
                busy={compareBusy}
                mixBusy={mixBusy}
                mixCost={mixCost}
                mixShort={mixShort}
                offlineMessage={compareResult.available ? "" : compareResult.message || compareResult.synthesis}
                onToggleInclude={toggleMixLane}
                onMix={() => void doMix()}
                onView={(dir) =>
                  setMixView((v) => Math.min(mixes.length - 1, Math.max(0, v + dir)))
                }
                onCopy={(text, key) => copy(text, key)}
                onTopUp={openCredits}
                copied={copied}
              />
            )}
          </div>
        </Sheet>
      )}

      {modal === "settings" && (
        <Sheet
          onClose={() => {
            setModal(null);
            // Armed state is deliberately not kept: coming back to the sheet should not
            // leave a half-typed password sitting in a destructive form.
            setDeleteArmed(false);
            setDeleteSecret("");
            setDeleteErr("");
          }}
          title="Settings"
        >
          <div className="space-y-1">
            <button type="button" onClick={() => (loggedIn ? setModal("profile") : openAuth("login"))} className="mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
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
              <button type="button" onClick={() => setModal("models")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><Layers className="h-4 w-4 opacity-70" /> Models{" "}
                <span className="ml-auto text-[10px]" style={{ color: "var(--soft)" }}>
                  {modelsInfo ? `${readyCount(modelsInfo)} ready here` : "This deployment"}
                </span></button>
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
                  {deleteArmed ? (
                    <div
                      className="mt-1 rounded-2xl border p-3"
                      style={{ borderColor: "var(--err)", background: "var(--secondary)" }}
                      role="group"
                      aria-label="Confirm account deletion"
                    >
                      <p className="text-[12px]" style={{ color: "var(--ink)" }}>
                        This deletes your account, chats, projects, teams and keys. There is
                        no undo and no grace period.
                      </p>
                      <input
                        autoFocus
                        type={oauthOnly ? "text" : "password"}
                        value={deleteSecret}
                        onChange={(e) => setDeleteSecret(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setDeleteArmed(false);
                            setDeleteSecret("");
                            setDeleteErr("");
                          }
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void doDeleteAccount(deleteSecret);
                          }
                        }}
                        autoComplete={oauthOnly ? "off" : "current-password"}
                        {...(oauthOnly ? { maxLength: 8 } : {})}
                        aria-label={oauthOnly ? "Type DELETE to confirm" : "Your password to confirm"}
                        placeholder={oauthOnly ? "Type DELETE" : "Your password"}
                        className="mt-2 h-10 w-full rounded-xl border px-3 text-sm outline-none"
                        style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--ink)" }}
                      />
                      {!!deleteErr && (
                        <p className="mt-1.5 text-[11px]" style={{ color: "var(--err)" }} role="alert">
                          {deleteErr}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Btn
                          size="sm"
                          disabled={!deleteSecret.trim() || authBusy}
                          onClick={() => void doDeleteAccount(deleteSecret)}
                          style={{ background: "var(--err)", color: "#fff" }}
                        >
                          {authBusy ? "Deleting…" : "Yes, delete my account"}
                        </Btn>
                        <Btn
                          size="sm"
                          variant="ghost"
                          disabled={authBusy}
                          onClick={() => {
                            setDeleteArmed(false);
                            setDeleteSecret("");
                            setDeleteErr("");
                          }}
                        >
                          Cancel
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteArmed(true)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium"
                      style={{ color: "var(--err)" }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" /> Delete account (permanent)
                    </button>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => openAuth("login")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"><LogIn className="h-4 w-4 opacity-70" /> Log in</button>
              )}
            </div>
            <p className="px-1 pt-2 text-[10px]" style={{ color: "var(--soft)" }}>Now: {dark ? "Dark" : "Light"}{themePref === "system" ? " (system)" : ""}</p>
          </div>
        </Sheet>
      )}

      {modal === "models" && (
        <Sheet onClose={() => setModal(null)} title="Models" wide>
          {/* Every word here is read from /api/ai/models, which builds it from MODEL_CATALOG and the
              live provider set. Nothing about which model answers you is written in this file, so a
              row added to the catalog shows up here without a second edit — and cannot lie here while
              the catalog says otherwise. */}
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            {modelsInfo
              ? readyTotal(modelsInfo) === 0
                ? "No model on this deployment can be called right now — a provider key changes that."
                : `${readyCount(modelsInfo)} of ${readyTotal(modelsInfo)} models here can be called right now. The rest are registered, and light up when their provider key is set.`
              : modelsErr
              ? "The model list could not be read."
              : "Reading what this deployment can call…"}
          </p>
          {modelsErr && (
            <div className="mb-3 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs" style={{ borderColor: "var(--err)", color: "var(--err)" }} role="alert" data-models-error>
              <span className="min-w-0 flex-1">{modelsErr}</span>
              <Btn size="sm" variant="soft" onClick={() => void loadModels()}>
                Retry
              </Btn>
            </div>
          )}
          {!modelsInfo && !modelsErr && (
            <p className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Models
            </p>
          )}
          {modelsInfo && (
            <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
              {(Object.keys(modelsInfo.selectable) as string[]).map((cap) => {
                const rows = modelsInfo.selectable[cap] || [];
                if (!rows.length) return null;
                return (
                  <div key={cap}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>
                        {MODEL_CAPTION[cap] || cap}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--soft)" }}>
                        {modelsInfo.ready[cap] ? `${modelsInfo.ready[cap].ready}/${modelsInfo.ready[cap].total} ready` : ""}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {rows.map((m) => (
                        <div
                          key={`${cap}-${m.id}`}
                          className="rounded-2xl border px-3 py-2.5"
                          style={{ borderColor: "var(--border)", background: m.available ? "var(--card)" : "var(--secondary)" }}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold">{m.label}</span>
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: m.available ? "var(--accent-soft)" : "var(--border)", color: m.available ? "var(--accent)" : "var(--muted)" }}>
                              {m.available ? m.brand : m.whyNot || "Not callable here"}
                            </span>
                            <span className="ml-auto text-[10px] uppercase tracking-wide" style={{ color: "var(--soft)" }}>
                              {m.provider} · {m.latency} · {m.quality}/5
                            </span>
                          </div>
                          {!!m.strengths.length && (
                            <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
                              {m.strengths.join(" · ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!modelsInfo.llmLive && (
                <div className="rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    No chat provider is reachable from this deployment, so answers come from the offline
                    fallback. A key of your own turns every row above that says &ldquo;No … key&rdquo; into a
                    live one.
                  </p>
                  <Btn size="sm" variant="soft" className="mt-2" onClick={() => setModal("byok")}>
                    Connect an API key
                  </Btn>
                </div>
              )}
            </div>
          )}
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

          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--soft)" }}>Create a team</div>
            <div className="flex gap-2">
              <input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doNewTeam(newTeamName);
                  }
                }}
                aria-label="New team name"
                placeholder="Studio crew, College project…"
                className="h-10 flex-1 rounded-2xl border px-3 text-sm outline-none"
                style={{ borderColor: "var(--border)", background: "var(--bg)" }}
              />
              <Btn size="sm" disabled={!loggedIn || !newTeamName.trim()} onClick={() => void doNewTeam(newTeamName)}>
                <Plus className="h-3.5 w-3.5" /> Create
              </Btn>
            </div>
            {!loggedIn && <p className="mt-1.5 text-[11px]" style={{ color: "var(--soft)" }}>Sign in first — a team is a place your chats live, so it needs an account.</p>}
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

          <div className="mb-4">
            {/* Same control as the settings sheet's theme picker and /pricing's audience
                toggle: it marks the choice with aria-selected, moves the sliding pill on
                font load and resize, and takes ArrowLeft/Right. The hand-rolled pair it
                replaced said "log in"/"sign up" in lowercase text and nothing else. */}
            <SegmentedControl
              ariaLabel="Log in or create an account"
              size="md"
              full
              value={props.tab}
              onChange={props.setTab}
              items={[
                { value: "login", label: "Log in" },
                { value: "register", label: "Sign up" },
              ]}
            />
          </div>
          <form onSubmit={props.onSubmit} className="space-y-3" aria-busy={props.busy}>
            {props.tab === "register" && (
              <input name="name" value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="Name" disabled={props.busy} className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
            )}
            <input name="email" type="email" required autoComplete="email" data-autofocus value={props.email} onChange={(e) => props.setEmail(e.target.value)} placeholder="Email" disabled={props.busy} className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
            <input name="password" type="password" required minLength={props.tab === "register" ? 8 : 1} autoComplete={props.tab === "register" ? "new-password" : "current-password"} value={props.password} onChange={(e) => props.setPassword(e.target.value)} placeholder={props.tab === "register" ? "Password (min 8)" : "Password"} disabled={props.busy} className="h-11 w-full rounded-2xl border px-3 text-sm outline-none" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
            {props.tab === "login" && (
              <button type="button" className="text-xs font-semibold" style={{ color: "var(--accent)" }} onClick={() => setView("forgot")} disabled={props.busy}>
                Forgot password?
              </button>
            )}
            {props.err ? (
              <p className="text-xs" style={{ color: "var(--err)" }} role="alert">{props.err}</p>
            ) : props.notice ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>{props.notice}</p>
            ) : null}
            <Btn type="submit" className="w-full" size="lg" disabled={props.busy}>
              {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.busy
                ? props.tab === "login"
                  ? "Logging in…"
                  : "Creating account…"
                : props.tab === "login"
                  ? "Log in"
                  : "Sign up free"}
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
  // And while that request is in flight the price is `···`, because the hook no
  // longer carries a made-up default for a page to flash.
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
          <div className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
            PRO {plan === "pro" && "· CURRENT"}
            {/* A Business account pays per seat, so the sheet says which it holds rather
                than showing a bare PRO next to a credit number it cannot explain. */}
            {wallet.loaded && wallet.proSeats > 1 ? ` · ${wallet.proSeats} seats` : ""}
          </div>
          <div className="mt-1 text-2xl font-semibold">{proPrice.loaded ? proPrice.label : "···"}<span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/mo</span></div>
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
