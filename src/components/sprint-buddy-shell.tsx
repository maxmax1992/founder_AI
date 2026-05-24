"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId } from "ai";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Circle,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  ListChecks,
  MessageCircle,
  Mic,
  Paperclip,
  PlaySquare,
  Plus,
  Save,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserCog,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  type AppCheckinSettings,
  type AppModelSettings,
  type AppSettings,
  CODEX_MODEL_OPTIONS,
  CODEX_REASONING_OPTIONS,
  CODEX_TEXT_VERBOSITY_OPTIONS,
  DEFAULT_APP_MODEL_SETTINGS,
  DEFAULT_APP_SETTINGS,
} from "@/lib/ai/model-settings";
import {
  type GraphifyGraphLink,
  type GraphifyGraphNode,
  type NormalizedGraphifyGraph,
  normalizeGraphifyGraph,
} from "@/lib/graphify-graph";
import { slugify } from "@/lib/slug";
import type {
  Advisor,
  AdvisorBrain,
  AdvisorBrainResponse,
  AdvisorSource,
  AppTab,
  AppUIMessage,
  BrainPage,
  CheckinItem,
  CheckinsResponse,
  Conversation,
  ConversationResponse,
  Founder,
  FounderBrain,
  FounderBrainResponse,
  ListAdvisorsResponse,
  ListConversationsResponse,
  ListSourcesResponse,
  SettingsResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const tabs: Array<{
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "chat", label: "Founder's Chat", icon: MessageCircle },
  { id: "advisor", label: "Advisor Editor", icon: UserCog },
  { id: "checkins", label: "Daily Check-ins", icon: ListChecks },
];

type SourceKind = NonNullable<AdvisorSource["kind"]>;
type AdvisorWorkspaceTab = "llm" | "wiki" | "workshop";
type LlmWikiLayer = "sources" | "wiki" | "core" | "schema" | "graph";
type BrainSaveState = "idle" | "pending" | "saving" | "saved" | "error";
type EditableBrainField = "profile" | "vision" | "direction" | "memory" | "schema";

interface GraphSourceDocument {
  kind: "core" | "schema" | "wiki" | "source" | "graph-source";
  path: string;
  title: string;
  body: string;
  badges: string[];
  sourceUrl?: string;
  extractionNote?: string;
  onTitleChange?: (value: string) => void;
  onBodyChange?: (value: string) => void;
  onSourceUrlChange?: (value: string) => void;
  onSave?: () => void | Promise<void>;
}

interface GraphSourceDocumentResponse {
  path: string;
  title: string;
  body: string;
  badges: string[];
  extractionNote?: string;
}

interface GraphForce {
  strength?: (value: number) => GraphForce;
  distance?: (value: number) => GraphForce;
  iterations?: (value: number) => GraphForce;
}

interface GraphForceMethods {
  d3Force?: (name: string) => GraphForce | undefined;
  d3ReheatSimulation?: () => void;
  zoomToFit?: (durationMs?: number, padding?: number) => void;
}

interface GraphifyStatusResponse {
  graphify: {
    enabled: boolean;
    forcedDisabled: boolean;
    graphifyOutDir: string;
    hasGraphifyOut: boolean;
    hasHtml: boolean;
    htmlFile: string | null;
    hasGraphJson: boolean;
    hasReport: boolean;
  };
  fallbackSkill: {
    name: string;
    summary: string;
    relativePath: string;
    references: Array<{ slug: string; title: string; relativePath: string }>;
  } | null;
}

const BRAIN_AUTOSAVE_DELAY_MS = 800;

const sourceKindOptions: Array<{
  id: SourceKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "text", label: "Text", icon: FileText },
  { id: "website", label: "Website", icon: Globe },
  { id: "youtube", label: "YouTube", icon: PlaySquare },
  { id: "pdf", label: "PDF", icon: Upload },
  { id: "docx", label: "Word", icon: FileText },
];

const textFileExtensions = [".txt", ".md", ".markdown", ".csv", ".json"];

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function titleFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "") || file.name;
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isDocxFile(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

function isTextLikeFile(file: File) {
  if (file.type.startsWith("text/")) return true;
  const lowerName = file.name.toLowerCase();
  return textFileExtensions.some((extension) => lowerName.endsWith(extension));
}

function firstUsefulDroppedLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? ""
  );
}

function parseDroppedUrl(value: string) {
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function isYoutubeUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    return hostname === "youtube.com" || hostname === "youtu.be" || hostname === "m.youtube.com";
  } catch {
    return false;
  }
}

async function importAdvisorSource(advisorId: string, formData: FormData) {
  const res = await fetch(`/api/advisors/${advisorId}/sources/import`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Import failed (${res.status})`);
  }
  const data = (await res.json()) as { source: AdvisorSource };
  return data.source;
}

function shortRelativeTime(timestamp: number, now = Date.now()) {
  const diff = Math.max(0, now - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diff < minute) return "now";
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h`;
  if (diff < week) return `${Math.max(1, Math.floor(diff / day))}d`;
  return `${Math.max(1, Math.floor(diff / week))}w`;
}

function messageCreatedAt(message: AppUIMessage) {
  if (!message.metadata || typeof message.metadata !== "object") return Date.now();
  const value = (message.metadata as { createdAt?: unknown }).createdAt;
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

export function SprintBuddyShell() {
  const [activeTab, setActiveTab] = React.useState<AppTab>("chat");
  const [advisors, setAdvisors] = React.useState<Advisor[]>([]);
  const [advisorId, setAdvisorId] = React.useState<string>("");
  const [founder, setFounder] = React.useState<Founder | null>(null);
  const [founderBrain, setFounderBrain] = React.useState<FounderBrain | null>(null);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState(() => generateId());
  const [conversationMessages, setConversationMessages] = React.useState<AppUIMessage[]>([]);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [conversationError, setConversationError] = React.useState<string | null>(null);

  const loadShellData = React.useCallback(async () => {
    try {
      const [advisorData, settingsData, founderData] = await Promise.all([
        jsonFetch<ListAdvisorsResponse>("/api/advisors"),
        jsonFetch<SettingsResponse>("/api/settings"),
        jsonFetch<FounderBrainResponse>("/api/founders/default"),
      ]);
      setAdvisors(advisorData.advisors);
      setAdvisorId((current) => current || advisorData.advisors[0]?.id || "");
      setSettings(settingsData.settings);
      setFounder(founderData.founder);
      setFounderBrain(founderData.brain);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app state");
    }
  }, []);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadShellData();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [loadShellData]);

  const loadConversations = React.useCallback(async (targetAdvisorId: string) => {
    if (!targetAdvisorId) {
      setConversations([]);
      return;
    }
    try {
      const data = await jsonFetch<ListConversationsResponse>(
        `/api/conversations?advisorId=${encodeURIComponent(targetAdvisorId)}`,
      );
      setConversations(data.conversations);
      setConversationError(null);
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : "Failed to load conversations");
    }
  }, []);

  const resetConversation = React.useCallback(() => {
    setActiveConversationId(generateId());
    setConversationMessages([]);
    window.history.replaceState(null, "", "/");
  }, []);

  const selectAdvisor = React.useCallback(
    (nextAdvisorId: string) => {
      setAdvisorId(nextAdvisorId);
      resetConversation();
    },
    [resetConversation],
  );

  React.useEffect(() => {
    void loadConversations(advisorId);
  }, [advisorId, loadConversations]);

  const openConversation = React.useCallback(
    async (conversationId: string, scopedAdvisorId = advisorId) => {
      try {
        const advisorQuery = scopedAdvisorId
          ? `?advisorId=${encodeURIComponent(scopedAdvisorId)}`
          : "";
        const data = await jsonFetch<ConversationResponse>(
          `/api/conversations/${encodeURIComponent(conversationId)}${advisorQuery}`,
        );
        if (data.conversation.advisorId !== advisorId) {
          setAdvisorId(data.conversation.advisorId);
        }
        setActiveConversationId(data.conversation.id);
        setConversationMessages(data.messages);
        setActiveTab("chat");
        window.history.replaceState(
          null,
          "",
          `/?conversation=${encodeURIComponent(conversationId)}`,
        );
        setConversationError(null);
      } catch (err) {
        setConversationError(err instanceof Error ? err.message : "Failed to open conversation");
      }
    },
    [advisorId],
  );

  const didOpenUrlConversation = React.useRef(false);

  React.useEffect(() => {
    if (didOpenUrlConversation.current || advisors.length === 0) return;
    const conversationId = new URL(window.location.href).searchParams.get("conversation");
    if (!conversationId) return;
    didOpenUrlConversation.current = true;
    void openConversation(conversationId, "");
  }, [advisors.length, openConversation]);

  const updateModelSettings = React.useCallback(
    async (patch: Partial<AppModelSettings>) => {
      const current = settings ?? DEFAULT_APP_SETTINGS;
      const next: AppSettings = { ...current, model: { ...current.model, ...patch } };
      setSettings(next);
      try {
        const data = await jsonFetch<SettingsResponse>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(next),
        });
        setSettings(data.settings);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save model settings");
        void loadShellData();
      }
    },
    [loadShellData, settings],
  );

  const updateCheckinSettings = React.useCallback(
    async (patch: Partial<AppCheckinSettings>) => {
      const current = settings ?? DEFAULT_APP_SETTINGS;
      const next: AppSettings = { ...current, checkins: { ...current.checkins, ...patch } };
      setSettings(next);
      try {
        const data = await jsonFetch<SettingsResponse>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(next),
        });
        setSettings(data.settings);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save check-in settings");
        void loadShellData();
      }
    },
    [loadShellData, settings],
  );

  const updateFounderSettings = React.useCallback(
    async (patch: { name?: string; profile?: string }) => {
      if (patch.name !== undefined && founder) setFounder({ ...founder, name: patch.name });
      if (patch.profile !== undefined && founderBrain) {
        setFounderBrain({ ...founderBrain, profile: patch.profile });
      }
      try {
        const data = await jsonFetch<FounderBrainResponse>("/api/founders/default", {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        setFounder(data.founder);
        setFounderBrain(data.brain);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save founder profile");
        void loadShellData();
      }
    },
    [founder, founderBrain, loadShellData],
  );

  const selectedAdvisor = advisors.find((advisor) => advisor.id === advisorId) ?? null;
  const selectedModel = CODEX_MODEL_OPTIONS.find(
    (option) => option.id === (settings?.model.model ?? DEFAULT_APP_MODEL_SETTINGS.model),
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-[14px] leading-[1.5] antialiased text-foreground">
      <aside className="hidden h-dvh w-[272px] shrink-0 flex-col border-r border-line-soft bg-background md:flex min-h-0">
        <Sidebar
          activeTab={activeTab}
          advisors={advisors}
          advisorId={advisorId}
          activeConversationId={activeConversationId}
          conversations={conversations}
          founder={founder}
          founderBrain={founderBrain}
          settings={settings}
          onAdvisorChange={selectAdvisor}
          onCheckinSettingsChange={(patch) => void updateCheckinSettings(patch)}
          onConversationSelect={(conversationId) => void openConversation(conversationId)}
          onFounderChange={(patch) => void updateFounderSettings(patch)}
          onModelSettingsChange={(patch) => void updateModelSettings(patch)}
          onNewConversation={() => {
            resetConversation();
            setActiveTab("chat");
          }}
          onTabChange={setActiveTab}
        />
      </aside>

      <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileBar
          activeTab={activeTab}
          advisors={advisors}
          advisorId={advisorId}
          founder={founder}
          founderBrain={founderBrain}
          settings={settings}
          onAdvisorChange={selectAdvisor}
          onCheckinSettingsChange={(patch) => void updateCheckinSettings(patch)}
          onFounderChange={(patch) => void updateFounderSettings(patch)}
          onModelSettingsChange={(patch) => void updateModelSettings(patch)}
          onTabChange={setActiveTab}
        />
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft px-6">
          {activeTab === "chat" ? (
            <div className="flex items-center gap-[11px]">
              <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,oklch(0.62_0.05_60),oklch(0.34_0.03_50))] font-serif text-[16px] italic text-[oklch(0.97_0.02_60/0.95)]">
                {selectedAdvisor?.name?.[0] || "M"}
                <div className="absolute bottom-[-1px] right-[-1px] h-2 w-2 rounded-full bg-sage shadow-[0_0_0_2px_var(--bg)]" />
              </div>
              <div>
                <div className="text-[14px] font-medium leading-[1.2] text-foreground">
                  {selectedAdvisor ? selectedAdvisor.name : "Choose an advisor"}
                </div>
                <div className="mt-[2px] font-mono text-[10.5px] text-fg-4 max-w-[240px] truncate">
                  {selectedAdvisor?.description || "Founder's harness advisor"}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-xs font-mono font-medium tracking-wider uppercase text-fg-4">
                Founder's harness
              </p>
              <h1 className="truncate text-base font-semibold text-foreground">
                {activeTab === "advisor" ? "Advisor Editor" : "Daily Check-ins"}
              </h1>
            </div>
          )}

          {selectedAdvisor && activeTab === "chat" && (
            <div className="hidden rounded-md bg-panel px-2.5 py-1 text-[11px] font-mono font-medium text-fg-3 md:block">
              {selectedModel?.label ?? "Codex"} ·{" "}
              {settings?.model.reasoningEffort ?? DEFAULT_APP_MODEL_SETTINGS.reasoningEffort}{" "}
              thinking
            </div>
          )}
        </div>

        {(error || conversationError) && (
          <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error || conversationError}
          </div>
        )}

        <div className="min-h-0 flex-1 flex flex-col">
          {activeTab === "chat" && (
            <FoundersChat
              key={`${selectedAdvisor?.id ?? "none"}-${activeConversationId}`}
              advisor={selectedAdvisor}
              founder={founder}
              conversationId={activeConversationId}
              initialMessages={conversationMessages}
              onConversationUpdated={() => void loadConversations(advisorId)}
            />
          )}
          {activeTab === "advisor" && (
            <AdvisorEditor
              advisors={advisors}
              advisor={selectedAdvisor}
              onAdvisorSelected={selectAdvisor}
              onAdvisorCreated={async (advisor) => {
                await loadShellData();
                selectAdvisor(advisor.id);
              }}
              onAdvisorDeleted={async () => {
                await loadShellData();
                selectAdvisor("");
              }}
              onAdvisorUpdated={loadShellData}
            />
          )}
          {activeTab === "checkins" && <DailyCheckins advisor={selectedAdvisor} />}
        </div>
      </main>
    </div>
  );
}

function Sidebar({
  activeTab,
  advisors,
  advisorId,
  activeConversationId,
  conversations,
  founder,
  founderBrain,
  settings,
  onAdvisorChange,
  onCheckinSettingsChange,
  onConversationSelect,
  onFounderChange,
  onModelSettingsChange,
  onNewConversation,
  onTabChange,
}: {
  activeTab: AppTab;
  advisors: Advisor[];
  advisorId: string;
  activeConversationId: string;
  conversations: Conversation[];
  founder: Founder | null;
  founderBrain: FounderBrain | null;
  settings: AppSettings | null;
  onAdvisorChange: (id: string) => void;
  onCheckinSettingsChange: (patch: Partial<AppCheckinSettings>) => void;
  onConversationSelect: (id: string) => void;
  onFounderChange: (patch: { name?: string; profile?: string }) => void;
  onModelSettingsChange: (patch: Partial<AppModelSettings>) => void;
  onNewConversation: () => void;
  onTabChange: (tab: AppTab) => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const currentSettings = settings ?? DEFAULT_APP_SETTINGS;
  const relativeTimeNow = Date.now();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 py-5 pb-[18px]">
        <div className="font-serif text-[21px] italic leading-none tracking-normal text-foreground text-balance">
          Founder's harness
        </div>
      </div>

      <div className="px-5 pb-[18px]">
        <label
          htmlFor="advisor-select"
          className="mb-[6px] block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-4"
        >
          Active Advisor
        </label>
        <select
          id="advisor-select"
          value={advisorId}
          onChange={(event) => onAdvisorChange(event.target.value)}
          className="h-9 w-full rounded-md border border-line-soft bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {advisors.map((advisor) => (
            <option key={advisor.id} value={advisor.id}>
              {advisor.name}
            </option>
          ))}
        </select>
      </div>

      <hr className="mx-0 my-0 mb-[6px] border-0 border-t border-line-soft" />

      <div className="px-[10px] py-[4px]">
        <div className="flex items-center justify-between px-[10px] py-[14px] pb-[10px] font-mono text-[10px] uppercase tracking-[0.14em] text-fg-4">
          <span>Navigation</span>
        </div>
        <nav className="flex flex-col" aria-label="Main tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "group relative block w-full rounded-[6px] px-[10px] py-[10px] pb-[11px] text-left transition-colors hover:bg-bg-2 flex items-center gap-3",
                  activeTab === tab.id && "bg-panel",
                )}
              >
                {activeTab === tab.id && (
                  <div className="absolute bottom-[14px] left-[-10px] top-[14px] w-[2px] rounded-[1px] bg-brand" />
                )}
                <Icon className={cn("size-4 text-fg-3", activeTab === tab.id && "text-brand")} />
                <span className="text-[13px] leading-[1.4] text-foreground font-sans font-medium">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="group mt-2 flex w-full items-center gap-3 rounded-[6px] px-[10px] py-[10px] pb-[11px] text-left transition-colors hover:bg-bg-2"
        >
          <Settings className="size-4 text-fg-3 group-hover:text-foreground" />
          <span className="text-[13px] leading-[1.4] text-foreground font-sans font-medium">
            Settings
          </span>
          <span className="ml-auto font-mono text-[10px] text-fg-4">
            {currentSettings.checkins.intervalDays}d
          </span>
        </button>
      </div>

      <hr className="mx-0 my-0 mb-[6px] border-0 border-t border-line-soft mt-2" />

      <section className="flex min-h-0 flex-1 flex-col px-[10px] pb-3">
        <div className="flex items-center justify-between px-[10px] py-[14px] pb-[10px]">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-4">
            Chats
          </span>
          <button
            type="button"
            onClick={onNewConversation}
            className="grid size-6 place-items-center rounded-[6px] text-fg-3 transition-colors hover:bg-bg-2 hover:text-foreground"
            title="New chat"
          >
            <Plus className="size-3.5" />
            <span className="sr-only">New chat</span>
          </button>
        </div>
        <div className="scrollbar-thin scrollbar-thumb-line scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-1">
            {conversations.map((conversation) => (
              <a
                key={conversation.id}
                href={`/?conversation=${encodeURIComponent(conversation.id)}`}
                onClick={(event) => {
                  event.preventDefault();
                  onConversationSelect(conversation.id);
                }}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-[6px] px-[10px] py-[8px] text-left transition-colors hover:bg-bg-2",
                  activeTab === "chat" && activeConversationId === conversation.id && "bg-panel",
                )}
              >
                <span className="truncate text-[13px] leading-[1.35] text-foreground">
                  {conversation.title}
                </span>
                <span className="text-right font-mono text-[11px] text-fg-4">
                  {shortRelativeTime(conversation.updatedAt, relativeTimeNow)}
                </span>
              </a>
            ))}
            {conversations.length === 0 && (
              <div className="px-[10px] py-2 text-[12px] leading-[1.4] text-fg-4">
                No past chats yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <SettingsDialog
        open={isSettingsOpen}
        founder={founder}
        founderBrain={founderBrain}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onCheckinSettingsChange={onCheckinSettingsChange}
        onFounderChange={onFounderChange}
        onModelSettingsChange={onModelSettingsChange}
      />

      <div className="mt-auto flex items-center gap-[10px] border-t border-line-soft px-5 py-[14px]">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-[oklch(0.55_0.06_50)] font-sans text-[12px] font-medium text-[oklch(0.98_0.01_80)]">
          {founder?.name?.[0] ?? "F"}
        </div>
        <div>
          <div className="text-[13px] text-foreground">{founder?.name ?? "Local Founder"}</div>
          <div className="mt-[1px] font-mono text-[10.5px] text-fg-4">private graph</div>
        </div>
      </div>
    </div>
  );
}

function MobileBar(props: {
  activeTab: AppTab;
  advisors: Advisor[];
  advisorId: string;
  founder: Founder | null;
  founderBrain: FounderBrain | null;
  settings: AppSettings | null;
  onAdvisorChange: (id: string) => void;
  onCheckinSettingsChange: (patch: Partial<AppCheckinSettings>) => void;
  onFounderChange: (patch: { name?: string; profile?: string }) => void;
  onModelSettingsChange: (patch: Partial<AppModelSettings>) => void;
  onTabChange: (tab: AppTab) => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const currentSettings = props.settings ?? DEFAULT_APP_SETTINGS;

  return (
    <div className="border-border bg-background flex flex-col gap-2 border-b p-3 md:hidden">
      <select
        value={props.advisorId}
        onChange={(event) => props.onAdvisorChange(event.target.value)}
        className="border-border bg-background h-9 rounded-md border px-2 text-sm"
      >
        {props.advisors.map((advisor) => (
          <option key={advisor.id} value={advisor.id}>
            {advisor.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-1">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={props.activeTab === tab.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label.replace("Advisor ", "").replace("Daily ", "")}
          </Button>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setIsSettingsOpen(true)}>
        <Settings className="size-4" />
        Settings
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {currentSettings.checkins.intervalDays}d
        </span>
      </Button>
      <SettingsDialog
        open={isSettingsOpen}
        founder={props.founder}
        founderBrain={props.founderBrain}
        settings={props.settings}
        onClose={() => setIsSettingsOpen(false)}
        onCheckinSettingsChange={props.onCheckinSettingsChange}
        onFounderChange={props.onFounderChange}
        onModelSettingsChange={props.onModelSettingsChange}
      />
    </div>
  );
}

function SettingsDialog({
  open,
  founder,
  founderBrain,
  settings,
  onClose,
  onCheckinSettingsChange,
  onFounderChange,
  onModelSettingsChange,
}: {
  open: boolean;
  founder: Founder | null;
  founderBrain: FounderBrain | null;
  settings: AppSettings | null;
  onClose: () => void;
  onCheckinSettingsChange: (patch: Partial<AppCheckinSettings>) => void;
  onFounderChange: (patch: { name?: string; profile?: string }) => void;
  onModelSettingsChange: (patch: Partial<AppModelSettings>) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/20 p-4 pt-14">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="border-border bg-background w-full max-w-[760px] rounded-lg border shadow-xl"
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="settings-title" className="text-base font-semibold">
              Settings
            </h2>
            <p className="text-muted-foreground text-xs">Founder's harness</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
            <span className="sr-only">Close settings</span>
          </Button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-4">
            <FounderSettingsControls
              founder={founder}
              founderBrain={founderBrain}
              onChange={onFounderChange}
            />
            <ModelSettingsControls settings={settings} onChange={onModelSettingsChange} />
          </div>
          <CheckinSettingsControls settings={settings} onChange={onCheckinSettingsChange} />
        </div>
      </section>
    </div>
  );
}

function FounderSettingsControls({
  founder,
  founderBrain,
  onChange,
}: {
  founder: Founder | null;
  founderBrain: FounderBrain | null;
  onChange: (patch: { name?: string; profile?: string }) => void;
}) {
  return (
    <section className="border-border bg-background rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Founder profile
        </p>
        <span className="text-muted-foreground font-mono text-xs">private</span>
      </div>
      <label
        htmlFor="founder-name-input"
        className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase"
      >
        Name
      </label>
      <Input
        id="founder-name-input"
        value={founder?.name ?? ""}
        disabled={!founder}
        onChange={(event) => onChange({ name: event.target.value })}
        placeholder="Founder name"
        className="h-8 text-sm"
      />
      <label
        htmlFor="founder-profile-input"
        className="text-muted-foreground mt-3 mb-1 block text-xs font-medium tracking-wider uppercase"
      >
        Context
      </label>
      <Textarea
        id="founder-profile-input"
        value={founderBrain?.profile ?? ""}
        disabled={!founderBrain}
        onChange={(event) => onChange({ profile: event.target.value })}
        placeholder="Private founder profile and context"
        className="min-h-24 font-mono text-xs"
      />
    </section>
  );
}

function CheckinSettingsControls({
  settings,
  onChange,
}: {
  settings: AppSettings | null;
  onChange: (patch: Partial<AppCheckinSettings>) => void;
}) {
  const checkinSettings = settings?.checkins ?? DEFAULT_APP_SETTINGS.checkins;

  return (
    <section className="border-border bg-background rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Daily check-ins
        </p>
        <span className="text-muted-foreground font-mono text-xs">
          {checkinSettings.intervalDays}d
        </span>
      </div>
      <label
        htmlFor="checkin-frequency-days"
        className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase"
      >
        Frequency
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-2">
        <Input
          id="checkin-frequency-days"
          type="number"
          min={1}
          max={30}
          step={1}
          value={checkinSettings.intervalDays}
          disabled={!settings}
          onChange={(event) => {
            const intervalDays = Number(event.target.value);
            if (!Number.isFinite(intervalDays)) return;
            onChange({ intervalDays });
          }}
          className="h-9"
        />
        <span className="text-muted-foreground text-sm">days</span>
      </div>
    </section>
  );
}

function ModelSettingsControls({
  settings,
  onChange,
}: {
  settings: AppSettings | null;
  onChange: (patch: Partial<AppModelSettings>) => void;
}) {
  const modelSettings = settings?.model ?? DEFAULT_APP_MODEL_SETTINGS;
  const selectedModel = CODEX_MODEL_OPTIONS.find((option) => option.id === modelSettings.model);

  return (
    <section className="border-border bg-background rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Model</p>
        <span className="text-muted-foreground truncate text-xs">
          {selectedModel?.detail ?? "Baseline"}
        </span>
      </div>
      <select
        aria-label="Model"
        value={modelSettings.model}
        disabled={!settings}
        onChange={(event) => onChange({ model: event.target.value as AppModelSettings["model"] })}
        className="border-border bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
      >
        {CODEX_MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="mt-3">
        <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
          Thinking
        </p>
        <div className="border-border grid grid-cols-4 overflow-hidden rounded-md border">
          {CODEX_REASONING_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!settings}
              onClick={() => onChange({ reasoningEffort: option.id })}
              className={cn(
                "hover:bg-muted h-8 border-r px-1 text-xs transition-colors last:border-r-0 disabled:opacity-60",
                modelSettings.reasoningEffort === option.id &&
                  "bg-brand-muted text-brand-muted-foreground font-medium",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label
          htmlFor="api-key-input"
          className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase"
        >
          OpenAI Key
        </label>
        <Input
          id="api-key-input"
          type="password"
          autoComplete="off"
          value={modelSettings.openAIApiKey ?? ""}
          disabled={!settings}
          onChange={(event) => onChange({ openAIApiKey: event.target.value })}
          placeholder="sk-..."
          className="h-8 text-xs"
        />
      </div>

      <div className="mt-3">
        <label
          htmlFor="verbosity-select"
          className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase"
        >
          Output
        </label>
        <select
          id="verbosity-select"
          value={modelSettings.textVerbosity}
          disabled={!settings}
          onChange={(event) =>
            onChange({ textVerbosity: event.target.value as AppModelSettings["textVerbosity"] })
          }
          className="border-border bg-background text-foreground focus-visible:ring-ring/50 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        >
          {CODEX_TEXT_VERBOSITY_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function FoundersChat({
  advisor,
  founder,
  conversationId,
  initialMessages,
  onConversationUpdated,
}: {
  advisor: Advisor | null;
  founder: Founder | null;
  conversationId: string;
  initialMessages: AppUIMessage[];
  onConversationUpdated: () => void;
}) {
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({
        api: "/api/chat",
        body: () => ({ advisorId: advisor?.id ?? "", founderId: founder?.id }),
      }),
    [advisor?.id, founder?.id],
  );

  const { messages, setMessages, sendMessage, status, error, regenerate, clearError } =
    useChat<AppUIMessage>({
      id: conversationId,
      messages: initialMessages,
      transport,
      onFinish: onConversationUpdated,
    });
  const [input, setInput] = React.useState("");
  const isBusy = status === "submitted" || status === "streaming";

  React.useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages, setMessages]);

  const submit = (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || !advisor || isBusy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  };

  if (!advisor) {
    return (
      <EmptyPanel title="No advisor yet" body="Create an advisor in the Advisor Editor first." />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-row">
      <div className="flex flex-col flex-1 min-w-0">
        <ScrollArea className="min-h-0 flex-1 pt-8 pb-5">
          <div className="mx-auto flex w-full max-w-[680px] flex-col gap-[26px] px-6">
            {messages.length === 0 ? (
              <div className="m-auto w-full max-w-[500px] text-center pt-20">
                <h2 className="text-2xl font-serif italic text-foreground mb-4">
                  How can I help you today?
                </h2>
                <div className="grid gap-2 text-left">
                  {[
                    "I need to have a hard conversation with my co-founder tomorrow.",
                    "I feel like I am losing confidence after a bad pitch.",
                    "Should I pivot or keep pushing this idea?",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => submit(prompt)}
                      className="border border-line-soft hover:bg-panel rounded-[10px] px-4 py-3 text-[14px] text-fg-2 transition-colors text-left"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <MessageList messages={messages} advisor={advisor} />
            )}
          </div>
        </ScrollArea>
        {error && (
          <div className="mx-auto w-full max-w-[680px] px-6">
            <div className="flex items-center justify-between rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{error.message}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearError();
                  void regenerate();
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        <div className="border-t border-line-soft px-6 pt-4 pb-5">
          <div className="mx-auto max-w-[680px]">
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => submit("Help me write the opening sentence")}
                className="rounded-full border border-line-soft px-[10px] py-[5px] text-[11.5px] text-fg-3 transition-all hover:border-line hover:text-foreground"
              >
                Help me write the opening sentence
              </button>
              <button
                type="button"
                onClick={() => submit("What if he gets defensive?")}
                className="rounded-full border border-line-soft px-[10px] py-[5px] text-[11.5px] text-fg-3 transition-all hover:border-line hover:text-foreground"
              >
                What if he gets defensive?
              </button>
              <button
                type="button"
                onClick={() => submit("I'm too tired to do this tonight")}
                className="rounded-full border border-line-soft px-[10px] py-[5px] text-[11.5px] text-fg-3 transition-all hover:border-line hover:text-foreground"
              >
                I&apos;m too tired to do this tonight
              </button>
            </div>
            <form
              className="rounded-[10px] border border-line-soft bg-bg-2 px-3 pt-3 pb-2 transition-all focus-within:border-line"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={`Tell ${advisor.name} what's actually going on…`}
                className="w-full min-h-[22px] max-h-[160px] resize-none border-0 bg-transparent p-0 font-sans text-[14.5px] leading-[1.55] text-foreground outline-none placeholder:text-fg-4 shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex gap-[2px]">
                  <button
                    type="button"
                    className="grid h-[30px] w-[30px] place-items-center rounded-[6px] text-fg-3 hover:bg-panel hover:text-foreground"
                    title="Attach"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="grid h-[30px] w-[30px] place-items-center rounded-[6px] text-fg-3 hover:bg-panel hover:text-foreground"
                    title="Voice"
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-[10px]">
                  <span className="font-mono text-[10px] tracking-[0.08em] text-fg-4">private</span>
                  {founder && (
                    <span className="font-mono text-[10px] tracking-[0.08em] text-fg-4">
                      {founder.name}
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={!input.trim() || isBusy}
                    className="grid h-7 w-7 place-items-center rounded-[6px] bg-brand text-brand-foreground transition-all hover:bg-[oklch(0.58_0.14_50)] active:scale-[0.96] disabled:bg-line disabled:text-fg-4 disabled:cursor-not-allowed"
                  >
                    <Send className="h-3.5 w-3.5 ml-0.5" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageList({ messages, advisor }: { messages: AppUIMessage[]; advisor: Advisor | null }) {
  return (
    <>
      {messages.map((message) => (
        <div key={message.id} className="flex gap-[14px]">
          <div
            className={cn(
              "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full font-sans text-[11px] font-medium leading-none",
              message.role === "user"
                ? "bg-[oklch(0.55_0.06_50)] text-[oklch(0.98_0.01_80)]"
                : "bg-[radial-gradient(circle_at_35%_30%,oklch(0.62_0.05_60),oklch(0.34_0.03_50))] font-serif text-[14px] italic text-[oklch(0.97_0.02_60/0.95)]",
            )}
          >
            {message.role === "user" ? "A" : advisor?.name?.[0] || "M"}
          </div>
          <div className="min-w-0 flex-1 pt-[2px]">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] text-fg-4">
              <span
                className={cn(
                  message.role === "user" ? "text-fg-2" : "text-foreground font-medium",
                )}
              >
                {message.role === "user" ? "You" : advisor?.name || "Mårten"}
              </span>
              <span>·</span>
              <span>
                {new Date(messageCreatedAt(message)).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </span>
            </div>
            <div
              className={cn(
                "text-pretty text-[14.5px] leading-[1.6]",
                message.role === "user" ? "text-fg-2" : "text-foreground",
              )}
            >
              <MessageParts message={message} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function MessageParts({ message }: { message: AppUIMessage }) {
  let textPartCount = 0;
  let toolPartCount = 0;
  let errorPartCount = 0;

  return message.parts.map((part) => {
    if (part.type === "text") {
      textPartCount += 1;
      return (
        <Markdown
          key={`${message.id}-text-${textPartCount}`}
          text={part.text}
          isStreaming={"state" in part && part.state === "streaming"}
          className={message.role === "user" ? "text-fg-2" : undefined}
        />
      );
    }
    const type = String(part.type);
    if (type.startsWith("tool-")) {
      toolPartCount += 1;
      const toolCallKey =
        "toolCallId" in part && typeof part.toolCallId === "string"
          ? part.toolCallId
          : String(toolPartCount);
      return (
        <div key={`${message.id}-${type}-${toolCallKey}`} className="text-fg-4 text-xs font-mono">
          {type.replaceAll("-", " ")}
        </div>
      );
    }
    if (type === "error" && "errorText" in part) {
      errorPartCount += 1;
      return (
        <div
          key={`${message.id}-error-${errorPartCount}`}
          className="border border-destructive/20 bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {String(part.errorText)}
        </div>
      );
    }
    return null;
  });
}

function AdvisorEditor({
  advisors,
  advisor,
  onAdvisorSelected,
  onAdvisorCreated,
  onAdvisorDeleted,
  onAdvisorUpdated,
}: {
  advisors: Advisor[];
  advisor: Advisor | null;
  onAdvisorSelected: (id: string) => void;
  onAdvisorCreated: (advisor: Advisor) => void | Promise<void>;
  onAdvisorDeleted: () => void | Promise<void>;
  onAdvisorUpdated: () => void | Promise<void>;
}) {
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);

  const create = async (name: string, description: string) => {
    if (!name) return;
    const data = await jsonFetch<{ advisor: Advisor }>("/api/advisors", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    await onAdvisorCreated(data.advisor);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="border-border bg-muted/20 flex shrink-0 flex-col gap-2 border-b px-5 py-3 md:flex-row md:items-end md:justify-between">
        <div className="grid min-w-0 flex-1 gap-1 md:max-w-[520px]">
          <label
            htmlFor="advisor-editor-select"
            className="font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
          >
            Advisor
          </label>
          <select
            id="advisor-editor-select"
            value={advisor?.id ?? ""}
            onChange={(event) => onAdvisorSelected(event.target.value)}
            className="border-border bg-background focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm text-foreground outline-none focus-visible:ring-2"
          >
            <option value="" disabled>
              Choose an advisor
            </option>
            {advisors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {advisor?.description && (
          <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm md:pb-2">
            {advisor.description}
          </p>
        )}
        <Button className="shrink-0" variant="outline" onClick={() => setIsCreateOpen(true)}>
          <Plus className="size-4" />
          Add advisor
        </Button>
      </section>
      <CreateAdvisorDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={create}
      />
      <div className="min-h-0 flex-1">
        {advisor ? (
          <AdvisorWorkspace
            key={advisor.id}
            advisor={advisor}
            onAdvisorDeleted={onAdvisorDeleted}
            onAdvisorUpdated={onAdvisorUpdated}
          />
        ) : (
          <EmptyPanel
            title="No advisor selected"
            body="Create or select an advisor to edit its brain."
          />
        )}
      </div>
    </div>
  );
}

function CreateAdvisorDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => void | Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  if (!open) return null;

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      await onCreate(trimmedName, description.trim());
      setName("");
      setDescription("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create advisor");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="bg-background border-border w-full max-w-[520px] rounded-lg border shadow-xl">
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Add advisor</h2>
            <p className="text-muted-foreground text-xs">
              Create a new local advisor brain directory.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3 p-4">
          <label htmlFor="new-advisor-name" className="grid gap-1 text-sm font-medium">
            Name
            <Input
              id="new-advisor-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Advisor name"
              autoFocus
            />
          </label>
          <label htmlFor="new-advisor-description" className="grid gap-1 text-sm font-medium">
            Description
            <Textarea
              id="new-advisor-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short advisor description"
              className="min-h-24"
            />
          </label>
          {error && (
            <div className="text-destructive flex items-start gap-2 text-xs leading-5">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={create} disabled={!name.trim() || isCreating}>
            <Plus className="size-4" />
            {isCreating ? "Creating..." : "Create advisor"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function AdvisorWorkspace({
  advisor,
  onAdvisorDeleted,
  onAdvisorUpdated,
}: {
  advisor: Advisor;
  onAdvisorDeleted: () => void | Promise<void>;
  onAdvisorUpdated: () => void | Promise<void>;
}) {
  const [name, setName] = React.useState(advisor.name);
  const [description, setDescription] = React.useState(advisor.description);
  const [brain, setBrain] = React.useState<AdvisorBrain | null>(null);
  const [sources, setSources] = React.useState<AdvisorSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [brainSaveState, setBrainSaveState] = React.useState<BrainSaveState>("idle");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = React.useState<AdvisorWorkspaceTab>("llm");
  const lastSavedBrainRef = React.useRef("");
  const latestBrainRef = React.useRef<AdvisorBrain | null>(null);
  const latestBrainSerializedRef = React.useRef("");
  const pendingBrainSaveRef = React.useRef<{
    brain: AdvisorBrain;
    serialized: string;
  } | null>(null);
  const isBrainSaveInFlightRef = React.useRef(false);

  const load = React.useCallback(async () => {
    const [brainData, sourceData] = await Promise.all([
      jsonFetch<AdvisorBrainResponse>(`/api/advisors/${advisor.id}/brain`),
      jsonFetch<ListSourcesResponse>(`/api/advisors/${advisor.id}/sources`),
    ]);
    const serializedBrain = JSON.stringify(brainData.brain);
    lastSavedBrainRef.current = serializedBrain;
    latestBrainRef.current = brainData.brain;
    latestBrainSerializedRef.current = serializedBrain;
    setBrain(brainData.brain);
    setBrainSaveState("idle");
    setSources(sourceData.sources);
    setSelectedSourceId((current) => current || sourceData.sources[0]?.id || "");
  }, [advisor.id]);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;

  const saveAdvisor = async () => {
    await jsonFetch(`/api/advisors/${advisor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, description }),
    });
    setStatus("Advisor saved.");
    await onAdvisorUpdated();
  };

  const saveBrainSnapshot = React.useCallback(
    async (
      brainSnapshot: AdvisorBrain,
      serialized: string,
      options: { automatic: boolean },
    ): Promise<void> => {
      if (isBrainSaveInFlightRef.current) {
        pendingBrainSaveRef.current = { brain: brainSnapshot, serialized };
        setBrainSaveState("pending");
        return;
      }

      isBrainSaveInFlightRef.current = true;
      setBrainSaveState("saving");
      setStatus("Saving brain...");
      try {
        await jsonFetch<AdvisorBrainResponse>(`/api/advisors/${advisor.id}/brain`, {
          method: "PATCH",
          body: JSON.stringify(brainSnapshot),
        });
        lastSavedBrainRef.current = serialized;
        if (latestBrainSerializedRef.current === serialized) {
          setBrainSaveState("saved");
          setStatus(options.automatic ? "Brain autosaved." : "Brain saved to markdown files.");
        }
      } catch (err) {
        if (latestBrainSerializedRef.current === serialized) {
          setBrainSaveState("error");
          setStatus(
            err instanceof Error ? `Brain save failed: ${err.message}` : "Brain save failed.",
          );
        }
      } finally {
        isBrainSaveInFlightRef.current = false;
        const pending = pendingBrainSaveRef.current;
        pendingBrainSaveRef.current = null;
        if (pending && pending.serialized !== lastSavedBrainRef.current) {
          void saveBrainSnapshot(pending.brain, pending.serialized, { automatic: true });
        } else if (
          latestBrainRef.current &&
          latestBrainSerializedRef.current !== lastSavedBrainRef.current
        ) {
          void saveBrainSnapshot(latestBrainRef.current, latestBrainSerializedRef.current, {
            automatic: true,
          });
        }
      }
    },
    [advisor.id],
  );

  React.useEffect(() => {
    if (!brain) return;
    const serialized = JSON.stringify(brain);
    latestBrainRef.current = brain;
    latestBrainSerializedRef.current = serialized;
    if (serialized === lastSavedBrainRef.current) {
      if (!isBrainSaveInFlightRef.current) setBrainSaveState("idle");
      return;
    }
    setBrainSaveState("pending");
    const handle = window.setTimeout(() => {
      void saveBrainSnapshot(brain, serialized, { automatic: true });
    }, BRAIN_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [brain, saveBrainSnapshot]);

  const deleteCurrentAdvisor = async () => {
    await jsonFetch(`/api/advisors/${advisor.id}`, { method: "DELETE" });
    await onAdvisorDeleted();
  };

  const saveSource = async (sourceOverride?: AdvisorSource) => {
    const sourceToSave = sourceOverride ?? selectedSource;
    if (!sourceToSave) return;
    await jsonFetch(`/api/advisors/${advisor.id}/sources/${sourceToSave.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: sourceToSave.title,
        body: sourceToSave.body,
        kind: sourceToSave.kind,
        sourceUrl: sourceToSave.sourceUrl,
        status: sourceToSave.status,
        extractionNote: sourceToSave.extractionNote,
      }),
    });
    await load();
    setStatus("Source saved.");
  };

  const deleteSourceById = async (sourceId: string) => {
    await jsonFetch(`/api/advisors/${advisor.id}/sources/${sourceId}`, { method: "DELETE" });
    setSelectedSourceId("");
    await load();
  };

  if (!brain) {
    return <EmptyPanel title="Loading advisor brain" body="Reading local markdown files..." />;
  }

  const workspaceTabs: Array<{
    id: AdvisorWorkspaceTab;
    label: string;
    meta: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "llm", label: "Advisor LLM", meta: "4", icon: UserCog },
    {
      id: "wiki",
      label: "Wiki",
      meta: `${brain.wikiPages.length}/${sources.length}`,
      icon: BookOpen,
    },
    { id: "workshop", label: "Manager", meta: "AI", icon: MessageCircle },
  ];

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex h-full min-h-full flex-col gap-5 p-5">
        <section
          aria-label="Advisor metadata"
          className="border-border bg-card shrink-0 rounded-lg border p-3"
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-end">
            <label htmlFor="selected-advisor-name" className="grid gap-1 text-sm font-medium">
              Name
              <Input
                id="selected-advisor-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label
              htmlFor="selected-advisor-description"
              className="grid gap-1 text-sm font-medium"
            >
              Description
              <Input
                id="selected-advisor-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short description shown in advisor lists"
              />
            </label>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="outline" onClick={saveAdvisor}>
                <Save className="size-4" />
                Save advisor
              </Button>
              <Button variant="destructive" onClick={deleteCurrentAdvisor}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </div>
        </section>

        {status && <p className="text-muted-foreground text-sm">{status}</p>}

        <section
          aria-label="Advisor editor sections"
          className="border-border bg-card shrink-0 rounded-md border p-2"
        >
          <div
            role="tablist"
            aria-label="Advisor editor sections"
            className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3"
          >
            {workspaceTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeWorkspaceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`advisor-editor-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`advisor-editor-panel-${tab.id}`}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-none",
                      isActive ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tab.meta}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          id="advisor-editor-panel-llm"
          role="tabpanel"
          aria-labelledby="advisor-editor-tab-llm"
          hidden={activeWorkspaceTab !== "llm"}
          className="flex min-h-[520px] flex-1 flex-col gap-4"
        >
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
            <EditorCard title="Profile">
              <Textarea
                value={brain.profile}
                onChange={(event) => setBrain({ ...brain, profile: event.target.value })}
                className="min-h-44 flex-1 font-mono text-sm"
              />
            </EditorCard>
            <EditorCard title="Vision">
              <Textarea
                value={brain.vision}
                onChange={(event) => setBrain({ ...brain, vision: event.target.value })}
                className="min-h-44 flex-1 font-mono text-sm"
              />
            </EditorCard>
            <EditorCard title="Direction">
              <Textarea
                value={brain.direction}
                onChange={(event) => setBrain({ ...brain, direction: event.target.value })}
                className="min-h-44 flex-1 font-mono text-sm"
              />
            </EditorCard>
            <EditorCard title="Advisor Memory">
              <Textarea
                value={brain.memory}
                onChange={(event) => setBrain({ ...brain, memory: event.target.value })}
                className="min-h-44 flex-1 font-mono text-sm"
              />
            </EditorCard>
          </div>
          <AutosaveIndicator saveState={brainSaveState} />
        </section>

        <section
          id="advisor-editor-panel-wiki"
          role="tabpanel"
          aria-labelledby="advisor-editor-tab-wiki"
          hidden={activeWorkspaceTab !== "wiki"}
          className="flex min-h-[520px] flex-1 flex-col"
        >
          <LlmWikiEditor
            brain={brain}
            advisorId={advisor.id}
            advisorName={advisor.name}
            sources={sources}
            selectedSource={selectedSource}
            onBrainChange={setBrain}
            onSourceSelect={setSelectedSourceId}
            onSourceChangeSelected={(source) =>
              setSources((items) => items.map((item) => (item.id === source.id ? source : item)))
            }
            onSourceSaveSelected={saveSource}
            onSourceDelete={deleteSourceById}
            onSourceImported={async (source) => {
              if (source) setSelectedSourceId(source.id);
              await load();
              setStatus(
                source?.status === "needs_review"
                  ? "Source captured. Review the extracted text before distilling it."
                  : "Source imported.",
              );
            }}
            saveState={brainSaveState}
          />
        </section>

        <section
          id="advisor-editor-panel-workshop"
          role="tabpanel"
          aria-labelledby="advisor-editor-tab-workshop"
          hidden={activeWorkspaceTab !== "workshop"}
          className="flex min-h-[520px] flex-1 flex-col"
        >
          <WorkshopChat advisor={advisor} />
        </section>
      </div>
    </ScrollArea>
  );
}

function AutosaveIndicator({ saveState }: { saveState: BrainSaveState }) {
  const copy: Record<BrainSaveState, { label: string; tone: string }> = {
    idle: { label: "Saved", tone: "text-muted-foreground" },
    pending: { label: "Autosave pending", tone: "text-muted-foreground" },
    saving: { label: "Autosaving", tone: "text-muted-foreground" },
    saved: { label: "Saved", tone: "text-muted-foreground" },
    error: { label: "Autosave failed", tone: "text-destructive" },
  };
  const item = copy[saveState];
  const Icon = saveState === "error" ? AlertCircle : CheckCircle2;
  return (
    <div className={cn("flex justify-end text-xs", item.tone)}>
      <span className="border-border bg-background inline-flex items-center gap-1.5 rounded-md border px-2 py-1">
        <Icon className="size-3.5" />
        {item.label}
      </span>
    </div>
  );
}

function LlmWikiEditor({
  brain,
  advisorId,
  advisorName,
  sources,
  selectedSource,
  onBrainChange,
  onSourceSelect,
  onSourceChangeSelected,
  onSourceSaveSelected,
  onSourceDelete,
  onSourceImported,
  saveState,
}: {
  brain: AdvisorBrain;
  advisorId: string;
  advisorName: string;
  sources: AdvisorSource[];
  selectedSource: AdvisorSource | null;
  onBrainChange: (brain: AdvisorBrain) => void;
  onSourceSelect: (id: string) => void;
  onSourceChangeSelected: (source: AdvisorSource) => void;
  onSourceSaveSelected: (source?: AdvisorSource) => void | Promise<void>;
  onSourceDelete: (id: string) => void | Promise<void>;
  onSourceImported: (source: AdvisorSource) => void | Promise<void>;
  saveState: BrainSaveState;
}) {
  const [layer, setLayer] = React.useState<LlmWikiLayer>("wiki");
  const [showFiles, setShowFiles] = React.useState(true);
  const [selectedWikiSlug, setSelectedWikiSlug] = React.useState(brain.wikiPages[0]?.slug ?? "");
  const [graphifyStatus, setGraphifyStatus] = React.useState<GraphifyStatusResponse | null>(null);
  const [graphifyStatusError, setGraphifyStatusError] = React.useState("");

  React.useEffect(() => {
    if (layer !== "wiki") return;
    if (brain.wikiPages.some((page) => page.slug === selectedWikiSlug)) return;
    setSelectedWikiSlug(brain.wikiPages[0]?.slug ?? "");
  }, [brain.wikiPages, layer, selectedWikiSlug]);

  React.useEffect(() => {
    if (layer !== "graph") return;
    let cancelled = false;
    jsonFetch<GraphifyStatusResponse>("/api/graphify/status")
      .then((data) => {
        if (!cancelled) {
          setGraphifyStatus(data);
          setGraphifyStatusError("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setGraphifyStatus(null);
          setGraphifyStatusError(
            err instanceof Error ? err.message : "Failed to load Graphify status",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [layer]);

  const selectedWikiIndex = brain.wikiPages.findIndex((page) => page.slug === selectedWikiSlug);
  const selectedWikiPage = selectedWikiIndex >= 0 ? brain.wikiPages[selectedWikiIndex] : null;
  const graphifyUsable = Boolean(
    graphifyStatus?.graphify.enabled &&
      graphifyStatus.graphify.hasGraphifyOut &&
      graphifyStatus.graphify.hasGraphJson,
  );

  const layers: Array<{
    id: LlmWikiLayer;
    label: string;
    meta: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "sources", label: "Raw sources", meta: String(sources.length), icon: FileText },
    { id: "wiki", label: "Wiki pages", meta: String(brain.wikiPages.length), icon: BookOpen },
    { id: "core", label: "Core nodes", meta: "4", icon: UserCog },
    { id: "schema", label: "Schema", meta: "md", icon: Settings },
    {
      id: "graph",
      label: "Graph",
      meta: graphifyUsable ? "json" : graphifyStatus ? "missing" : "",
      icon: Circle,
    },
  ];

  const updateWikiPage = React.useCallback(
    (index: number, patch: Partial<BrainPage>) => {
      onBrainChange({
        ...brain,
        wikiPages: brain.wikiPages.map((page, pageIndex) =>
          pageIndex === index ? { ...page, ...patch, updatedAt: Date.now() } : page,
        ),
      });
    },
    [brain, onBrainChange],
  );

  const resolveGraphSource = React.useCallback(
    (sourceFile: string): GraphSourceDocument | null => {
      const advisorPrefix = `advisors/${advisorId}/`;
      if (!sourceFile.startsWith(advisorPrefix)) return null;
      const localPath = sourceFile.slice(advisorPrefix.length);
      const coreDocuments: Record<
        string,
        { field: EditableBrainField; title: string; kind: "core" | "schema"; badges: string[] }
      > = {
        "profile.md": {
          field: "profile",
          title: "Profile",
          kind: "core",
          badges: ["core", "document"],
        },
        "vision.md": {
          field: "vision",
          title: "Vision",
          kind: "core",
          badges: ["core", "document"],
        },
        "direction.md": {
          field: "direction",
          title: "Direction",
          kind: "core",
          badges: ["core", "document"],
        },
        "memory.md": {
          field: "memory",
          title: "Advisor Memory",
          kind: "core",
          badges: ["core", "document"],
        },
        "schema.md": {
          field: "schema",
          title: "Schema",
          kind: "schema",
          badges: ["schema", "markdown"],
        },
      };
      const coreDocument = coreDocuments[localPath];
      if (coreDocument) {
        return {
          kind: coreDocument.kind,
          path: sourceFile,
          title: coreDocument.title,
          body: brain[coreDocument.field],
          badges: coreDocument.badges,
          onBodyChange: (value) => onBrainChange({ ...brain, [coreDocument.field]: value }),
        };
      }

      const wikiMatch = /^wiki\/(.+)\.md$/.exec(localPath);
      if (wikiMatch) {
        const pageIndex = brain.wikiPages.findIndex((page) => page.slug === wikiMatch[1]);
        const page = pageIndex >= 0 ? brain.wikiPages[pageIndex] : null;
        if (!page) return null;
        return {
          kind: "wiki",
          path: sourceFile,
          title: page.title,
          body: page.content,
          badges: ["wiki", "markdown"],
          onTitleChange: (value) => updateWikiPage(pageIndex, { title: value }),
          onBodyChange: (value) => updateWikiPage(pageIndex, { content: value }),
        };
      }

      if (/^sources\/[^/]+\/chunk-\d+\.md$/.test(localPath)) return null;

      const sourceMatch = /^sources\/([^/]+)\.md$/.exec(localPath);
      const sourceId = sourceMatch?.[1];
      if (sourceId) {
        const source = sources.find((item) => item.id === sourceId);
        if (!source) return null;
        return {
          kind: "source",
          path: sourceFile,
          title: source.title,
          body: source.body,
          sourceUrl: source.sourceUrl,
          extractionNote: source.extractionNote,
          badges: [source.kind ?? "text", source.status ?? "ready"],
          onTitleChange: (value) => onSourceChangeSelected({ ...source, title: value }),
          onBodyChange: (value) => onSourceChangeSelected({ ...source, body: value }),
          onSourceUrlChange:
            source.sourceUrl !== undefined
              ? (value) => onSourceChangeSelected({ ...source, sourceUrl: value })
              : undefined,
          onSave: () => onSourceSaveSelected(source),
        };
      }

      return null;
    },
    [
      advisorId,
      brain,
      onBrainChange,
      onSourceChangeSelected,
      onSourceSaveSelected,
      sources,
      updateWikiPage,
    ],
  );

  const addWikiPage = () => {
    const title = "New page";
    const slug = uniquePageSlug(`new-${brain.wikiPages.length + 1}`, brain.wikiPages);
    onBrainChange({
      ...brain,
      wikiPages: [
        ...brain.wikiPages,
        {
          slug,
          title,
          content: "# New page\n\n",
          updatedAt: Date.now(),
        },
      ],
    });
    setSelectedWikiSlug(slug);
    setLayer("wiki");
    setShowFiles(true);
  };

  const deleteWikiPage = (slug: string) => {
    const nextPages = brain.wikiPages.filter((page) => page.slug !== slug);
    onBrainChange({ ...brain, wikiPages: nextPages });
    setSelectedWikiSlug(nextPages[0]?.slug ?? "");
  };

  return (
    <section className="border-border bg-card flex min-h-0 flex-1 flex-col rounded-lg border">
      <div className="border-border border-b p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="LLM Wiki layers"
            className="border-border grid min-w-0 flex-1 overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-5"
          >
            {layers.map((item) => {
              const Icon = item.icon;
              const isActive = layer === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setLayer(item.id)}
                  className={cn(
                    "hover:bg-muted flex min-h-9 items-center justify-between gap-3 border-b px-3 text-left text-xs font-medium transition-colors last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0",
                    isActive && "bg-brand-muted text-brand",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="text-muted-foreground font-mono text-[10px]">{item.meta}</span>
                </button>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <LibrarySwitch checked={showFiles} onCheckedChange={setShowFiles} />
            <AutosaveIndicator saveState={saveState} />
          </div>
        </div>
      </div>

      <div className={cn("grid min-h-0 flex-1", showFiles && "lg:grid-cols-[260px_minmax(0,1fr)]")}>
        {showFiles && (
          <aside className="border-border bg-muted/20 min-h-0 border-b p-3 lg:border-r lg:border-b-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Library
              </p>
              {layer === "wiki" && (
                <Button type="button" variant="outline" size="sm" onClick={addWikiPage}>
                  <Plus className="size-3.5" />
                  Add
                </Button>
              )}
            </div>
            <div className="space-y-1">
              {layer === "sources" &&
                sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => onSourceSelect(source.id)}
                    className={cn(
                      "hover:bg-background border-border/70 w-full rounded-md border px-2 py-2 text-left text-xs transition-colors",
                      selectedSource?.id === source.id && "border-brand/60 bg-brand-muted",
                    )}
                  >
                    <span className="block truncate font-mono">{source.id}.md</span>
                    <span className="text-muted-foreground mt-0.5 block truncate">
                      {source.title}
                    </span>
                  </button>
                ))}
              {layer === "sources" && sources.length === 0 && (
                <div className="border-border text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                  No raw sources.
                </div>
              )}
              {layer === "wiki" &&
                brain.wikiPages.map((page) => (
                  <button
                    key={`${page.slug}-${page.updatedAt}`}
                    type="button"
                    onClick={() => setSelectedWikiSlug(page.slug)}
                    className={cn(
                      "hover:bg-background border-border/70 w-full rounded-md border px-2 py-2 text-left text-xs transition-colors",
                      selectedWikiSlug === page.slug && "border-brand/60 bg-brand-muted",
                    )}
                  >
                    <span className="block truncate font-mono">{page.slug}.md</span>
                    <span className="text-muted-foreground mt-0.5 block truncate">
                      {page.title}
                    </span>
                  </button>
                ))}
              {layer === "wiki" && brain.wikiPages.length === 0 && (
                <div className="border-border text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                  No wiki pages.
                </div>
              )}
              {layer === "schema" && (
                <button
                  type="button"
                  className="border-brand/60 bg-brand-muted w-full rounded-md border px-2 py-2 text-left text-xs"
                >
                  <span className="block truncate font-mono">schema.md</span>
                  <span className="text-muted-foreground mt-0.5 block truncate">The schema</span>
                </button>
              )}
              {layer === "core" &&
                [
                  ["profile", "Advisor Profile"],
                  ["vision", "Vision"],
                  ["direction", "Direction"],
                  ["memory", "Advisor Memory"],
                ].map(([slug, title]) => (
                  <button
                    key={slug}
                    type="button"
                    className="border-brand/60 bg-brand-muted w-full rounded-md border px-2 py-2 text-left text-xs"
                  >
                    <span className="block truncate font-mono">{slug}.md</span>
                    <span className="text-muted-foreground mt-0.5 block truncate">{title}</span>
                  </button>
                ))}
              {layer === "graph" && (
                <>
                  <button
                    type="button"
                    className="border-brand/60 bg-brand-muted w-full rounded-md border px-2 py-2 text-left text-xs"
                  >
                    <span className="block truncate font-mono">graphify-out</span>
                    <span className="text-muted-foreground mt-0.5 block truncate">Graph data</span>
                  </button>
                  <button
                    type="button"
                    className="border-border/70 w-full rounded-md border px-2 py-2 text-left text-xs"
                  >
                    <span className="block truncate font-mono">graph.json</span>
                    <span className="text-muted-foreground mt-0.5 block truncate">
                      Viewer source
                    </span>
                  </button>
                </>
              )}
            </div>
          </aside>
        )}

        <div className="min-h-0 min-w-0 p-3">
          {layer === "sources" && (
            <SourcesEditor
              advisorId={advisorId}
              sources={sources}
              selectedSource={selectedSource}
              onSelect={onSourceSelect}
              onChangeSelected={onSourceChangeSelected}
              onSaveSelected={onSourceSaveSelected}
              onDelete={onSourceDelete}
              onImported={onSourceImported}
            />
          )}

          {layer === "wiki" && (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-muted-foreground font-mono text-xs">
                    {selectedWikiPage ? `${selectedWikiPage.slug}.md` : "wiki/"}
                  </p>
                  <h3 className="truncate text-sm font-semibold">The wiki</h3>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addWikiPage}>
                  <Plus className="size-4" />
                  Add page
                </Button>
              </div>
              {selectedWikiPage ? (
                <>
                  <div className="grid gap-2 md:grid-cols-[200px_minmax(0,1fr)_auto]">
                    <Input
                      value={selectedWikiPage.slug}
                      onChange={(event) => {
                        setSelectedWikiSlug(event.target.value);
                        updateWikiPage(selectedWikiIndex, { slug: event.target.value });
                      }}
                    />
                    <Input
                      value={selectedWikiPage.title}
                      onChange={(event) =>
                        updateWikiPage(selectedWikiIndex, { title: event.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteWikiPage(selectedWikiPage.slug)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Textarea
                    value={selectedWikiPage.content}
                    onChange={(event) =>
                      updateWikiPage(selectedWikiIndex, { content: event.target.value })
                    }
                    className="min-h-[420px] flex-1 resize-y font-mono text-sm"
                  />
                </>
              ) : (
                <EmptyPanel title="No wiki page selected" body="Create a wiki page." />
              )}
            </div>
          )}

          {layer === "schema" && (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="min-w-0">
                <p className="text-muted-foreground font-mono text-xs">schema.md</p>
                <h3 className="truncate text-sm font-semibold">The schema</h3>
              </div>
              <Textarea
                value={brain.schema}
                onChange={(event) => onBrainChange({ ...brain, schema: event.target.value })}
                className="min-h-[500px] flex-1 resize-y font-mono text-sm"
              />
            </div>
          )}

          {layer === "core" && (
            <div className="grid h-full min-h-0 gap-3 xl:grid-cols-2">
              <EditorCard title="Profile">
                <Textarea
                  value={brain.profile}
                  onChange={(event) => onBrainChange({ ...brain, profile: event.target.value })}
                  className="min-h-44 flex-1 font-mono text-sm"
                />
              </EditorCard>
              <EditorCard title="Vision">
                <Textarea
                  value={brain.vision}
                  onChange={(event) => onBrainChange({ ...brain, vision: event.target.value })}
                  className="min-h-44 flex-1 font-mono text-sm"
                />
              </EditorCard>
              <EditorCard title="Direction">
                <Textarea
                  value={brain.direction}
                  onChange={(event) => onBrainChange({ ...brain, direction: event.target.value })}
                  className="min-h-44 flex-1 font-mono text-sm"
                />
              </EditorCard>
              <EditorCard title="Advisor Memory">
                <Textarea
                  value={brain.memory}
                  onChange={(event) => onBrainChange({ ...brain, memory: event.target.value })}
                  className="min-h-44 flex-1 font-mono text-sm"
                />
              </EditorCard>
            </div>
          )}

          {layer === "graph" && (
            <GraphifyLayer
              advisorId={advisorId}
              advisorName={advisorName}
              status={graphifyStatus}
              error={graphifyStatusError}
              resolveSource={resolveGraphSource}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function LibrarySwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-2 rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <Folder className="text-muted-foreground size-4" />
      <span>Library</span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 overflow-hidden rounded-full border transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
        )}
      >
        <span
          className={cn(
            "bg-background absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

function GraphifyLayer({
  advisorId,
  advisorName,
  status,
  error,
  resolveSource,
}: {
  advisorId: string;
  advisorName: string;
  status: GraphifyStatusResponse | null;
  error: string;
  resolveSource: (sourceFile: string) => GraphSourceDocument | null;
}) {
  const [view, setView] = React.useState<"map" | "report">("map");
  const [graph, setGraph] = React.useState<NormalizedGraphifyGraph | null>(null);
  const [report, setReport] = React.useState("");
  const [graphError, setGraphError] = React.useState("");
  const [selectedNodeId, setSelectedNodeId] = React.useState("");
  const [openSourceFile, setOpenSourceFile] = React.useState("");
  const [openGraphSourceDocument, setOpenGraphSourceDocument] =
    React.useState<GraphSourceDocument | null>(null);
  const [openGraphSourceError, setOpenGraphSourceError] = React.useState("");
  const [isOpenGraphSourceLoading, setIsOpenGraphSourceLoading] = React.useState(false);

  React.useEffect(() => {
    if (!status?.graphify.hasGraphJson) return;
    let cancelled = false;

    async function loadGraph() {
      try {
        const [graphResponse, reportResponse] = await Promise.all([
          fetch("/api/graphify/artifact?file=graph.json"),
          status?.graphify.hasReport
            ? fetch("/api/graphify/artifact?file=GRAPH_REPORT.md")
            : Promise.resolve(null),
        ]);
        if (!graphResponse.ok) throw new Error(`Graph JSON failed (${graphResponse.status})`);
        const normalized = normalizeGraphifyGraph(await graphResponse.json(), {
          advisorId,
          advisorName,
        });
        const reportText = reportResponse?.ok ? await reportResponse.text() : "";
        if (!cancelled) {
          setGraph(normalized);
          setReport(reportText);
          setGraphError("");
          setSelectedNodeId((current) =>
            current && normalized.nodes.some((node) => node.id === current)
              ? current
              : normalized.nodes[0]?.id || "",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setGraph(null);
          setGraphError(err instanceof Error ? err.message : "Failed to load graph.json");
        }
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [advisorId, advisorName, status]);

  React.useEffect(() => {
    if (!openSourceFile) {
      setOpenGraphSourceDocument(null);
      setOpenGraphSourceError("");
      setIsOpenGraphSourceLoading(false);
      return;
    }
    if (resolveSource(openSourceFile)) {
      setOpenGraphSourceDocument(null);
      setOpenGraphSourceError("");
      setIsOpenGraphSourceLoading(false);
      return;
    }

    let cancelled = false;
    async function loadGraphSourceDocument() {
      setOpenGraphSourceDocument(null);
      setOpenGraphSourceError("");
      setIsOpenGraphSourceLoading(true);
      try {
        const response = await fetch(
          `/api/graphify/source?path=${encodeURIComponent(openSourceFile)}`,
        );
        if (!response.ok) throw new Error(`Graph source failed (${response.status})`);
        const payload = (await response.json()) as GraphSourceDocumentResponse;
        if (cancelled) return;
        setOpenGraphSourceDocument({
          kind: "graph-source",
          path: payload.path,
          title: payload.title,
          body: payload.body,
          badges: payload.badges,
          extractionNote: payload.extractionNote,
        });
      } catch (err) {
        if (!cancelled) {
          setOpenGraphSourceError(
            err instanceof Error ? err.message : "Failed to load Graphify source document",
          );
        }
      } finally {
        if (!cancelled) setIsOpenGraphSourceLoading(false);
      }
    }

    void loadGraphSourceDocument();
    return () => {
      cancelled = true;
    };
  }, [openSourceFile, resolveSource]);

  if (error) {
    return <EmptyPanel title="Graph status unavailable" body={error} />;
  }

  if (!status) {
    return <EmptyPanel title="Loading graph status" body="Checking Graphify artifacts." />;
  }

  const { graphify } = status;
  const graphifyUsable = graphify.enabled && graphify.hasGraphifyOut && graphify.hasGraphJson;
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const openDocument = openSourceFile
    ? (resolveSource(openSourceFile) ?? openGraphSourceDocument)
    : null;
  const relatedLinks = selectedNode
    ? (graph?.links ?? []).filter(
        (link) => link.source === selectedNode.id || link.target === selectedNode.id,
      )
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
            Graphify
          </p>
          <h3 className="mt-1 text-sm font-semibold">
            {graphifyUsable
              ? "Enabled with graph.json"
              : graphify.enabled
                ? "Enabled, artifacts missing"
                : "Disabled by USE_GRAPHIFY=false"}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {graphifyUsable
              ? "The viewer is reading the Graphify graph artifact directly."
              : graphify.hasGraphifyOut
                ? "graphify-out exists, but graph.json is missing."
                : "No graphify-out directory found. Build the graph before using this view."}
          </p>
        </div>
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
            Artifacts
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="border-border rounded-md border px-2 py-1">
              HTML: {graphify.hasHtml ? graphify.htmlFile : "missing"}
            </span>
            <span className="border-border rounded-md border px-2 py-1">
              JSON: {graphify.hasGraphJson ? "present" : "missing"}
            </span>
            <span className="border-border rounded-md border px-2 py-1">
              Report: {graphify.hasReport ? "present" : "missing"}
            </span>
          </div>
        </div>
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
            Core nodes
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold">{graph?.coreNodeCount ?? 0} blue</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Profile, vision, direction, and memory nodes are highlighted as core context.
          </p>
        </div>
      </div>

      {!graphifyUsable ? (
        <GraphifyInstallPanel forcedDisabled={graphify.forcedDisabled} />
      ) : graphError ? (
        <EmptyPanel title="Graph JSON unavailable" body={graphError} />
      ) : graph && graph.nodes.length > 0 ? (
        <div className="grid min-h-[560px] flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="border-border bg-background flex min-h-[520px] flex-col overflow-hidden rounded-md border">
            <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-2">
              {openSourceFile ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setOpenSourceFile("");
                      setOpenGraphSourceError("");
                      setOpenGraphSourceDocument(null);
                    }}
                  >
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {openDocument?.path ?? openSourceFile}
                  </span>
                </div>
              ) : (
                <div className="border-border inline-grid overflow-hidden rounded-md border grid-cols-2">
                  {(["map", "report"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setView(item);
                        setOpenSourceFile("");
                      }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                        view === item
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
              <span className="text-muted-foreground text-xs">
                {graph.nodes.length} nodes · {graph.links.length} edges · {graph.communities}{" "}
                communities
              </span>
            </div>
            <div className="relative min-h-0 flex-1">
              {view === "map" ? (
                <GraphCanvas
                  graph={graph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id);
                  }}
                />
              ) : (
                <ScrollArea className="absolute inset-0">
                  <pre className="text-muted-foreground whitespace-pre-wrap p-4 font-mono text-xs">
                    {report ||
                      "No GRAPH_REPORT.md artifact found. The map view is using graph.json."}
                  </pre>
                </ScrollArea>
              )}
              {openSourceFile && (
                <div className="bg-background absolute inset-0 z-10 flex min-h-0 flex-col">
                  {openDocument ? (
                    <GraphSourceEditor key={openDocument.path} document={openDocument} />
                  ) : (
                    <EmptyPanel
                      title={isOpenGraphSourceLoading ? "Loading source" : "Source unavailable"}
                      body={
                        isOpenGraphSourceLoading
                          ? "Opening the generated Graphify source document."
                          : openGraphSourceError ||
                            "This graph node is outside the editable advisor files and generated Graphify corpus."
                      }
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="border-border bg-background min-h-0 rounded-md border p-3">
            {selectedNode ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div>
                  <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
                    Selected node
                  </p>
                  <h3 className="mt-1 text-sm font-semibold">{selectedNode.label}</h3>
                  <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
                    {selectedNode.sourceFile || "No source file"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {selectedNode.isCore && (
                    <span className="rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-blue-700">
                      core
                    </span>
                  )}
                  {selectedNode.isRoot && (
                    <span className="border-border rounded-md border bg-primary px-2 py-1 text-primary-foreground">
                      advisor root
                    </span>
                  )}
                  <span className="border-border rounded-md border px-2 py-1">
                    community {selectedNode.community ?? "n/a"}
                  </span>
                  <span className="border-border rounded-md border px-2 py-1">
                    {selectedNode.fileType}
                  </span>
                </div>
                {selectedNode.sourceFile && !selectedNode.isRoot && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpenSourceFile(selectedNode.sourceFile);
                    }}
                  >
                    <FileText className="size-4" />
                    Open source
                  </Button>
                )}
                <div className="min-h-0 flex-1">
                  <p className="text-muted-foreground mb-2 font-mono text-[10px] uppercase tracking-wider">
                    Relationships
                  </p>
                  <ScrollArea className="h-full pr-2">
                    <div className="space-y-2">
                      {relatedLinks.map((link) => (
                        <div
                          key={`${link.source}-${link.relation}-${link.target}`}
                          className="border-border rounded-md border p-2 text-xs"
                        >
                          <div className="font-mono">{link.relation}</div>
                          <div className="text-muted-foreground mt-1 break-all">
                            {link.source} → {link.target}
                          </div>
                          <div className="text-muted-foreground mt-1">{link.confidence}</div>
                        </div>
                      ))}
                      {relatedLinks.length === 0 && (
                        <div className="border-border text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                          No relationships for this node.
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <EmptyPanel title="No node selected" body="Select a graph node to inspect it." />
            )}
          </aside>
        </div>
      ) : (
        <EmptyPanel
          title="Graph is empty"
          body="Run python3 tools/graphify_refresh.py after adding advisor or founder markdown."
        />
      )}
    </div>
  );
}

function GraphSourceEditor({ document }: { document: GraphSourceDocument }) {
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const titleInputId = React.useId();
  const sourceInputId = React.useId();

  const saveDocument = async () => {
    if (!document.onSave || saveState === "saving") return;
    setSaveState("saving");
    try {
      await document.onSave();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate font-mono text-xs">{document.path}</p>
          <h3 className="mt-1 truncate text-sm font-semibold">{document.title}</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {document.badges.map((badge) => (
            <span
              key={badge}
              className={cn(
                "border-border rounded-md border px-2 py-1",
                badge === "core" && "border-blue-500/40 bg-blue-500/10 text-blue-700",
                badge === "needs_review" &&
                  "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {badge}
            </span>
          ))}
        </div>
      </div>

      {(document.onTitleChange || document.onSourceUrlChange) && (
        <div className="grid shrink-0 gap-2 md:grid-cols-2">
          {document.onTitleChange && (
            <label htmlFor={titleInputId} className="grid gap-1.5 text-sm font-medium">
              <span>Name</span>
              <Input
                id={titleInputId}
                value={document.title}
                onChange={(event) => document.onTitleChange?.(event.target.value)}
              />
            </label>
          )}
          {document.onSourceUrlChange && document.sourceUrl !== undefined && (
            <label htmlFor={sourceInputId} className="grid gap-1.5 text-sm font-medium">
              <span>Source</span>
              <Input
                id={sourceInputId}
                value={document.sourceUrl}
                onChange={(event) => document.onSourceUrlChange?.(event.target.value)}
              />
            </label>
          )}
        </div>
      )}

      {document.extractionNote && (
        <div className="border-destructive/20 bg-destructive/10 text-destructive flex shrink-0 items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{document.extractionNote}</span>
        </div>
      )}

      <Textarea
        value={document.body}
        readOnly={!document.onBodyChange}
        onChange={(event) => {
          document.onBodyChange?.(event.target.value);
          if (document.onSave) setSaveState("idle");
        }}
        className="min-h-[420px] flex-1 resize-none font-mono text-sm"
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "text-muted-foreground text-xs",
            saveState === "error" && "text-destructive",
          )}
        >
          {document.onSave
            ? saveState === "saving"
              ? "Saving..."
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : "Unsaved source edits"
            : document.onBodyChange
              ? "Autosaves"
              : "Read-only"}
        </span>
        {document.onSave && (
          <Button type="button" variant="outline" size="sm" onClick={() => void saveDocument()}>
            <Save className="size-4" />
            Save source
          </Button>
        )}
      </div>
    </div>
  );
}

function GraphifyInstallPanel({ forcedDisabled }: { forcedDisabled: boolean }) {
  return (
    <div className="border-border bg-muted/20 flex min-h-[360px] flex-1 flex-col rounded-md border p-4">
      <h3 className="text-sm font-semibold">Build the Graphify view</h3>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
        The Graph tab does not use graph.md as a fallback. It renders Graphify artifacts only.
      </p>
      {forcedDisabled && (
        <p className="text-destructive mt-2 text-sm">USE_GRAPHIFY=false is disabling Graphify.</p>
      )}
      <pre className="border-border bg-background mt-4 overflow-x-auto rounded-md border p-3 font-mono text-xs">
        pip install graphifyy{"\n"}
        python3 -m graphify install{"\n"}
        python3 tools/graphify_refresh.py
      </pre>
    </div>
  );
}

function GraphCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: NormalizedGraphifyGraph;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const graphData = React.useMemo(
    () => ({
      nodes: graph.nodes,
      links: graph.links,
    }),
    [graph],
  );
  const graphRef = React.useRef<GraphForceMethods | null>(null);
  const GraphComponent = ForceGraph2D as unknown as React.ForwardRefExoticComponent<
    Record<string, unknown> & React.RefAttributes<GraphForceMethods>
  >;

  React.useEffect(() => {
    if (!size.width) return;
    const handles: number[] = [];
    const tuneGraph = () => {
      const engine = graphRef.current;
      if (!engine) return;
      const nodeCount = graph.nodes.length;
      engine.d3Force?.("charge")?.strength?.(nodeCount > 10 ? -2600 : -1400);
      engine
        .d3Force?.("link")
        ?.distance?.(nodeCount > 10 ? 320 : 220)
        ?.iterations?.(4);
      engine.d3ReheatSimulation?.();
    };
    for (const delay of [0, 250, 900]) {
      handles.push(window.setTimeout(tuneGraph, delay));
    }
    handles.push(
      window.setTimeout(() => {
        graphRef.current?.zoomToFit?.(600, 96);
      }, 1600),
    );
    return () => {
      for (const handle of handles) window.clearTimeout(handle);
    };
  }, [graph.nodes.length, size.width]);

  return (
    <div ref={containerRef} className="min-h-[520px] flex-1">
      {size.width > 0 && (
        <GraphComponent
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={Math.max(size.height, 520)}
          nodeId="id"
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={6}
          linkColor={(link: GraphifyGraphLink) =>
            link.confidence === "INFERRED" ? "rgba(80,80,80,0.22)" : "rgba(80,80,80,0.36)"
          }
          linkWidth={(link: GraphifyGraphLink) => (link.confidence === "EXTRACTED" ? 1.4 : 0.8)}
          linkLabel={(link: GraphifyGraphLink) => link.relation}
          nodeLabel={(node: GraphifyGraphNode) => `${node.label}\n${node.sourceFile}`}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(
            node: GraphifyGraphNode & { x?: number; y?: number },
            ctx: CanvasRenderingContext2D,
            scale: number,
          ) => drawGraphNode(node, ctx, scale, node.id === selectedNodeId)}
          nodePointerAreaPaint={(
            node: GraphifyGraphNode & { x?: number; y?: number },
            color: string,
            ctx: CanvasRenderingContext2D,
          ) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, node.isCore ? 10 : 8, 0, 2 * Math.PI);
            ctx.fill();
          }}
          onNodeClick={(node: GraphifyGraphNode) => onSelectNode(node.id)}
          cooldownTicks={260}
          d3AlphaDecay={0.018}
          d3VelocityDecay={0.12}
          enableNodeDrag
        />
      )}
    </div>
  );
}

function drawGraphNode(
  node: GraphifyGraphNode & { x?: number; y?: number },
  ctx: CanvasRenderingContext2D,
  scale: number,
  selected: boolean,
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const radius = selected ? 8.5 : node.isRoot ? 8 : node.isCore ? 6.5 : 4.8;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = selected
    ? "#111827"
    : node.isRoot
      ? "#111827"
      : node.isCore
        ? "#2563eb"
        : communityColor(node.community);
  ctx.fill();
  if (!node.label) return;

  const safeScale = Math.max(scale, 0.35);
  const maxLabelLength = node.isRoot ? 30 : selected ? 26 : 22;
  const label =
    node.label.length > maxLabelLength
      ? `${node.label.slice(0, Math.max(maxLabelLength - 3, 1))}...`
      : node.label;
  const screenFontSize = node.isRoot ? 11 : selected ? 9.5 : node.isCore ? 8.25 : 7.5;
  const fontSize = screenFontSize / safeScale;
  const labelY = y + radius + 4 / safeScale;

  ctx.font = `${node.isRoot || selected ? "600 " : ""}${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 3 / safeScale;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
  ctx.strokeText(label, x, labelY);
  ctx.fillStyle = selected || node.isRoot ? "#111827" : node.isCore ? "#1d4ed8" : "#52525b";
  ctx.fillText(label, x, labelY);
}

function communityColor(community: number | null) {
  const colors = ["#737373", "#0f766e", "#9333ea", "#ca8a04", "#dc2626", "#4f46e5"];
  if (typeof community !== "number") return colors[0];
  return colors[Math.abs(community) % colors.length];
}

function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function uniquePageSlug(base: string, pages: BrainPage[]) {
  const root = slugify(base);
  let candidate = root;
  let index = 2;
  while (pages.some((page) => page.slug === candidate)) {
    candidate = `${root}-${index}`;
    index += 1;
  }
  return candidate;
}

function EditorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border bg-card flex min-h-0 flex-col rounded-lg border p-3">
      <h3 className="mb-2 shrink-0 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function SourcesEditor({
  advisorId,
  sources,
  selectedSource,
  onSelect,
  onChangeSelected,
  onSaveSelected,
  onDelete,
  onImported,
}: {
  advisorId: string;
  sources: AdvisorSource[];
  selectedSource: AdvisorSource | null;
  onSelect: (id: string) => void;
  onChangeSelected: (source: AdvisorSource) => void;
  onSaveSelected: (source?: AdvisorSource) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onImported: (source: AdvisorSource) => void | Promise<void>;
}) {
  const [kind, setKind] = React.useState<SourceKind>("text");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [isDragActive, setIsDragActive] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [dropStatus, setDropStatus] = React.useState<string | null>(null);

  const canImport =
    kind === "text"
      ? body.trim().length > 0
      : kind === "pdf" || kind === "docx"
        ? Boolean(file)
        : url.trim().length > 0;
  const isEditingSource = Boolean(selectedSource);

  const postSourceImport = async (formData: FormData) => {
    return importAdvisorSource(advisorId, formData);
  };

  const clearImportFields = () => {
    setTitle("");
    setBody("");
    setUrl("");
    setFile(null);
  };

  const importSource = async () => {
    if (!canImport || isImporting) return;
    setIsImporting(true);
    setImportError(null);
    setDropStatus(null);
    try {
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("title", title);
      if (kind === "text") formData.set("body", body);
      if (kind === "website" || kind === "youtube") formData.set("url", url);
      if ((kind === "pdf" || kind === "docx") && file) formData.set("file", file);

      const source = await postSourceImport(formData);
      clearImportFields();
      await onImported(source);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import source");
    } finally {
      setIsImporting(false);
    }
  };

  const importDroppedFiles = async (files: File[]) => {
    const imported: AdvisorSource[] = [];
    for (const droppedFile of files) {
      const formData = new FormData();
      formData.set("title", files.length === 1 && title ? title : titleFromFile(droppedFile));
      if (isPdfFile(droppedFile)) {
        formData.set("kind", "pdf");
        formData.set("file", droppedFile);
      } else if (isDocxFile(droppedFile)) {
        formData.set("kind", "docx");
        formData.set("file", droppedFile);
      } else if (isTextLikeFile(droppedFile)) {
        const text = await droppedFile.text();
        if (!text.trim()) throw new Error(`${droppedFile.name} is empty.`);
        formData.set("kind", "text");
        formData.set("body", text);
      } else {
        // Skip unsupported files instead of throwing error for bulk uploads
        continue;
      }
      imported.push(await postSourceImport(formData));
    }
    return imported;
  };

  const importDroppedText = async (value: string) => {
    const dropped = value.trim();
    if (!dropped) return [];

    const maybeUrl = parseDroppedUrl(firstUsefulDroppedLine(dropped));
    const formData = new FormData();
    if (maybeUrl) {
      formData.set("kind", isYoutubeUrl(maybeUrl) ? "youtube" : "website");
      formData.set("title", title);
      formData.set("url", maybeUrl);
    } else {
      formData.set("kind", "text");
      formData.set("title", title || "Dropped text source");
      formData.set("body", dropped);
    }
    return [await postSourceImport(formData)];
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (isImporting) return;

    setIsImporting(true);
    setImportError(null);
    setDropStatus(null);
    try {
      const files = Array.from(event.dataTransfer.files);
      const imported =
        files.length > 0
          ? await importDroppedFiles(files)
          : await importDroppedText(
              event.dataTransfer.getData("text/uri-list") ||
                event.dataTransfer.getData("text/plain"),
            );

      const latest = imported.at(-1);
      if (!latest) throw new Error("Drop a PDF, text file, markdown file, URL, or text.");
      clearImportFields();
      setDropStatus(
        imported.length === 1 ? "Source imported." : `${imported.length} sources imported.`,
      );
      await onImported(latest);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import dropped source");
    } finally {
      setIsImporting(false);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragActive(false);
  };

  const handlePickedFiles = async (files: File[]) => {
    if (files.length === 0 || isImporting) return;
    setIsImporting(true);
    setImportError(null);
    setDropStatus(null);
    try {
      const imported = await importDroppedFiles(files);
      const latest = imported.at(-1);
      if (!latest) throw new Error("Choose a PDF, Word, text, or markdown file.");
      clearImportFields();
      setDropStatus(
        imported.length === 1 ? "Source imported." : `${imported.length} sources imported.`,
      );
      await onImported(latest);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import selected files");
    } finally {
      setIsImporting(false);
    }
  };

  const importLocalDirectory = async () => {
    const dir = prompt("Enter a directory path relative to project root (e.g. 'marten'):");
    if (!dir) return;

    setIsImporting(true);
    setImportError(null);
    setDropStatus(null);
    try {
      const res = await fetch(`/api/advisors/${advisorId}/sources/local-import`, {
        method: "POST",
        body: JSON.stringify({ dirPath: dir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to import from local directory");
      setDropStatus(data.message);
      await onImported(null as unknown as AdvisorSource); // Trigger refresh
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import from local directory");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="border-border bg-card flex min-h-0 flex-1 flex-col rounded-lg border p-3">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="text-brand size-4" />
          <h3 className="text-sm font-semibold">Sources</h3>
        </div>
        <div className="text-muted-foreground text-xs">{sources.length} captured</div>
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-4",
          isEditingSource
            ? "xl:grid-cols-[minmax(360px,0.45fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(420px,0.42fr)_minmax(0,1fr)]"
            : "grid-cols-1",
        )}
      >
        <div className={cn("min-h-0 space-y-3 overflow-auto", isEditingSource ? "pr-1" : "pr-0")}>
          <div className="border-border bg-background rounded-md border p-3">
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setIsDragActive(true);
                }}
                onDragLeave={handleDragLeave}
                onDrop={(event) => void handleDrop(event)}
                className={cn(
                  "border-border bg-muted/20 hover:bg-muted focus-within:ring-ring/50 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center transition-colors focus-within:ring-2",
                  isDragActive && "border-brand bg-brand-muted text-brand",
                )}
              >
                <input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf,.docx,.txt,.md,.markdown,.csv,.json,text/*"
                  className="hidden"
                  onChange={(event) => {
                    const pickedFiles = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void handlePickedFiles(pickedFiles);
                  }}
                />
                <Upload className="mb-2 size-5" />
                <p className="text-xs font-medium">Files</p>
              </label>

              <label className="border-border bg-muted/20 hover:bg-muted focus-within:ring-ring/50 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center transition-colors focus-within:ring-2">
                <input
                  type="file"
                  // @ts-expect-error webkitdirectory is non-standard
                  webkitdirectory=""
                  directory=""
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const pickedFiles = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void handlePickedFiles(pickedFiles);
                  }}
                />
                <Folder className="mb-2 size-5" />
                <p className="text-xs font-medium">Folder</p>
              </label>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mb-3 w-full border-dashed"
              onClick={importLocalDirectory}
              disabled={isImporting}
            >
              <FolderPlus className="mr-2 size-4" />
              Import from project directory
            </Button>

            <div className="grid grid-cols-2 gap-1">
              {sourceKindOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setKind(option.id as SourceKind);
                      setImportError(null);
                    }}
                    className={cn(
                      "border-border hover:bg-muted flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                      kind === option.id && "border-brand/60 bg-brand-muted text-brand",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 space-y-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Optional title"
              />
              {kind === "text" && (
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Paste source material"
                  className="min-h-32"
                />
              )}
              {(kind === "website" || kind === "youtube") && (
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={kind === "youtube" ? "YouTube URL" : "Website URL"}
                  type="url"
                />
              )}
              {(kind === "pdf" || kind === "docx") && (
                <Input
                  key={file?.name ?? `empty-${kind}-input`}
                  type="file"
                  accept={
                    kind === "pdf"
                      ? "application/pdf,.pdf"
                      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                  }
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              )}
              {importError && (
                <div className="text-destructive flex items-start gap-2 text-xs leading-5">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}
              {dropStatus && (
                <div className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
                  <CheckCircle2 className="text-brand mt-0.5 size-3.5 shrink-0" />
                  <span>{dropStatus}</span>
                </div>
              )}
              <Button
                type="button"
                className="w-full"
                onClick={importSource}
                disabled={!canImport || isImporting}
              >
                <Plus className="size-4" />
                {isImporting ? "Importing..." : "Import source"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {sources.map((source) => (
              <button
                type="button"
                key={source.id}
                onClick={() => onSelect(source.id)}
                className={cn(
                  "border-border hover:bg-muted w-full rounded-md border p-2 text-left text-sm transition-colors",
                  selectedSource?.id === source.id && "border-brand/60 bg-brand-muted",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{source.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {source.kind ?? "text"}
                      {source.status === "needs_review" ? " · needs review" : ""}
                    </p>
                  </div>
                  {source.status === "needs_review" && (
                    <AlertCircle className="text-destructive mt-0.5 size-3.5 shrink-0" />
                  )}
                </div>
              </button>
            ))}
            {sources.length === 0 && (
              <div className="border-border text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                No sources yet.
              </div>
            )}
          </div>
        </div>
        {selectedSource ? (
          <div className="flex min-h-0 flex-col gap-2">
            <Input
              value={selectedSource.title}
              onChange={(event) =>
                onChangeSelected({ ...selectedSource, title: event.target.value })
              }
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="border-border bg-background rounded-md border px-2 py-1">
                {selectedSource.kind ?? "text"}
              </span>
              <span
                className={cn(
                  "border-border bg-background rounded-md border px-2 py-1",
                  selectedSource.status === "needs_review" &&
                    "border-destructive/30 bg-destructive/10 text-destructive",
                )}
              >
                {selectedSource.status ?? "ready"}
              </span>
            </div>
            {selectedSource.sourceUrl !== undefined && (
              <Input
                value={selectedSource.sourceUrl}
                onChange={(event) =>
                  onChangeSelected({ ...selectedSource, sourceUrl: event.target.value })
                }
                placeholder="Source URL or filename"
              />
            )}
            {selectedSource.extractionNote && (
              <div className="border-destructive/20 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{selectedSource.extractionNote}</span>
              </div>
            )}
            <Textarea
              value={selectedSource.body}
              onChange={(event) =>
                onChangeSelected({ ...selectedSource, body: event.target.value })
              }
              className="min-h-[360px] flex-1 font-mono text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => void onSaveSelected()}>
                Save source
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void onDelete(selectedSource.id)}
              >
                Delete source
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WorkshopChat({ advisor }: { advisor: Advisor }) {
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({ api: `/api/advisors/${advisor.id}/workshop-chat` }),
    [advisor.id],
  );
  const { messages, sendMessage, status } = useChat<AppUIMessage>({
    id: `${advisor.id}-workshop`,
    transport,
  });
  const [input, setInput] = React.useState("");
  const busy = status === "submitted" || status === "streaming";
  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  };

  return (
    <section className="border-border bg-card flex h-full min-h-0 flex-col rounded-lg border p-3">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="text-brand size-4" />
        <h3 className="text-sm font-semibold">Advisor Brain Manager</h3>
      </div>
      <div className="border-border bg-background min-h-0 flex-1 overflow-auto rounded-md border p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Ask for source distillation, vision refinement, wiki page drafts, or fallback
            references.
          </p>
        ) : (
          <MessageList messages={messages} advisor={null} />
        )}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Example: turn my sources into wiki pages and fallback references"
        />
        <Button type="submit" disabled={!input.trim() || busy}>
          <Send className="size-4" />
        </Button>
      </form>
    </section>
  );
}

function DailyCheckins({ advisor }: { advisor: Advisor | null }) {
  const [checkins, setCheckins] = React.useState<CheckinItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!advisor) return;
    try {
      const data = await jsonFetch<CheckinsResponse>(`/api/checkins?advisorId=${advisor.id}`);
      setCheckins(data.checkins);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load check-ins");
    }
  }, [advisor]);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  const generateNow = async () => {
    if (!advisor) return;
    await jsonFetch(`/api/cron/checkins?advisorId=${advisor.id}`, { method: "POST" });
    await load();
  };

  const toggle = async (item: CheckinItem) => {
    await jsonFetch(`/api/checkins/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: item.status === "done" ? "todo" : "done" }),
    });
    await load();
  };

  if (!advisor) return <EmptyPanel title="No advisor selected" body="Choose an advisor first." />;

  return (
    <div className="h-full min-h-0 p-5">
      <div className="mx-auto flex h-full max-w-[920px] flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Daily check-ins</h2>
            <p className="text-muted-foreground text-sm">
              Chronological todo-style prompts regenerated every two days by default.
            </p>
          </div>
          <Button onClick={generateNow}>
            <Plus className="size-4" />
            Generate
          </Button>
        </div>
        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2">
            {checkins.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void toggle(item)}
                className="border-border hover:bg-muted flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors"
              >
                {item.status === "done" ? (
                  <CheckCircle2 className="text-brand mt-0.5 size-5 shrink-0" />
                ) : (
                  <Circle className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={cn(
                        "font-medium",
                        item.status === "done" && "text-muted-foreground line-through",
                      )}
                    >
                      {item.title}
                    </p>
                    <span className="text-muted-foreground text-xs">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{item.prompt}</p>
                </div>
              </button>
            ))}
            {checkins.length === 0 && (
              <EmptyPanel
                title="No check-ins yet"
                body="Generate the first set for this advisor."
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="border-border mx-auto mb-4 flex size-10 items-center justify-center rounded-full border">
          <Sparkles className="text-brand size-4" />
        </div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{body}</p>
      </div>
    </div>
  );
}
