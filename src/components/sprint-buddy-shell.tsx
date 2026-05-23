"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId } from "ai";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  Circle,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  ListChecks,
  MessageCircle,
  PlaySquare,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserCog,
  X,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  type AppModelSettings,
  type AppSettings,
  CODEX_MODEL_OPTIONS,
  CODEX_REASONING_OPTIONS,
  CODEX_TEXT_VERBOSITY_OPTIONS,
  DEFAULT_APP_MODEL_SETTINGS,
} from "@/lib/ai/model-settings";
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
  ListAdvisorsResponse,
  ListSourcesResponse,
  SettingsResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const tabs: Array<{
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "chat", label: "Buddy Chat", icon: MessageCircle },
  { id: "advisor", label: "Advisor Editor", icon: UserCog },
  { id: "checkins", label: "Daily Check-ins", icon: ListChecks },
];

type SourceKind = NonNullable<AdvisorSource["kind"]>;

const sourceKindOptions: Array<{
  id: SourceKind | "docx";
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

function briefExcerpt(value: string, max = 360) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function advisorSkillMarkdown(title: string, brief: string, contextSources: AdvisorSource[]) {
  const sourceNotes = contextSources
    .slice(0, 5)
    .map((source) => `- ${source.title}: ${briefExcerpt(source.body, 220)}`)
    .join("\n");

  return [
    `# ${title}`,
    "",
    "## Trigger",
    brief.trim() || "Use this when the founder needs a repeatable advisory move.",
    "",
    "## Source Notes",
    sourceNotes || "- No source context attached yet.",
    "",
    "## Procedure",
    "1. Name the situation in one plain sentence.",
    "2. Apply the advisor principle from the source notes.",
    "3. Ask one hard question that changes the founder's next decision.",
    "4. End with one concrete action for the next 24 hours.",
    "",
    "## Response Shape",
    "- Real issue",
    "- Advisor lens",
    "- Hard question",
    "- Next action",
  ].join("\n");
}

export function SprintBuddyShell() {
  const [activeTab, setActiveTab] = React.useState<AppTab>("chat");
  const [advisors, setAdvisors] = React.useState<Advisor[]>([]);
  const [advisorId, setAdvisorId] = React.useState<string>("");
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadShellData = React.useCallback(async () => {
    try {
      const [advisorData, settingsData] = await Promise.all([
        jsonFetch<ListAdvisorsResponse>("/api/advisors"),
        jsonFetch<SettingsResponse>("/api/settings"),
      ]);
      setAdvisors(advisorData.advisors);
      setAdvisorId((current) => current || advisorData.advisors[0]?.id || "");
      setSettings(settingsData.settings);
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

  const updateModelSettings = React.useCallback(
    async (patch: Partial<AppModelSettings>) => {
      const current = settings?.model ?? DEFAULT_APP_MODEL_SETTINGS;
      const next: AppSettings = { model: { ...current, ...patch } };
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
    [loadShellData, settings?.model],
  );

  const selectedAdvisor = advisors.find((advisor) => advisor.id === advisorId) ?? null;
  const selectedModel = CODEX_MODEL_OPTIONS.find(
    (option) => option.id === (settings?.model.model ?? DEFAULT_APP_MODEL_SETTINGS.model),
  );

  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground hidden h-dvh w-[280px] shrink-0 flex-col border-r md:flex">
        <Sidebar
          activeTab={activeTab}
          advisors={advisors}
          advisorId={advisorId}
          settings={settings}
          onAdvisorChange={setAdvisorId}
          onModelSettingsChange={(patch) => void updateModelSettings(patch)}
          onTabChange={setActiveTab}
        />
      </aside>

      <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileBar
          activeTab={activeTab}
          advisors={advisors}
          advisorId={advisorId}
          settings={settings}
          onAdvisorChange={setAdvisorId}
          onModelSettingsChange={(patch) => void updateModelSettings(patch)}
          onTabChange={setActiveTab}
        />
        <div className="border-border flex h-14 shrink-0 items-center justify-between border-b px-4 md:px-6">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Sprint Buddy
            </p>
            <h1 className="truncate text-base font-semibold">
              {selectedAdvisor ? selectedAdvisor.name : "Choose an advisor"}
            </h1>
          </div>
          {selectedAdvisor && (
            <div className="bg-brand-muted text-brand-muted-foreground hidden rounded-md px-2.5 py-1 text-xs font-medium md:block">
              {selectedModel?.label ?? "Codex"} ·{" "}
              {settings?.model.reasoningEffort ?? DEFAULT_APP_MODEL_SETTINGS.reasoningEffort}{" "}
              thinking
            </div>
          )}
        </div>

        {error && (
          <div className="border-destructive/20 bg-destructive/10 text-destructive border-b px-4 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {activeTab === "chat" && (
            <BuddyChat key={selectedAdvisor?.id ?? "none"} advisor={selectedAdvisor} />
          )}
          {activeTab === "advisor" && (
            <AdvisorEditor
              advisors={advisors}
              advisor={selectedAdvisor}
              onAdvisorSelected={setAdvisorId}
              onAdvisorCreated={async (advisor) => {
                await loadShellData();
                setAdvisorId(advisor.id);
              }}
              onAdvisorDeleted={async () => {
                await loadShellData();
                setAdvisorId("");
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
  settings,
  onAdvisorChange,
  onModelSettingsChange,
  onTabChange,
}: {
  activeTab: AppTab;
  advisors: Advisor[];
  advisorId: string;
  settings: AppSettings | null;
  onAdvisorChange: (id: string) => void;
  onModelSettingsChange: (patch: Partial<AppModelSettings>) => void;
  onTabChange: (tab: AppTab) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="bg-brand text-brand-foreground flex size-7 items-center justify-center rounded-md">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Sprint Buddy</h1>
            <p className="text-muted-foreground text-xs">Founder OS prototype</p>
          </div>
        </div>
      </header>

      <div className="px-3 pb-3">
        <label
          htmlFor="advisor-select"
          className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase"
        >
          Advisor
        </label>
        <select
          id="advisor-select"
          value={advisorId}
          onChange={(event) => onAdvisorChange(event.target.value)}
          className="border-border bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
        >
          {advisors.map((advisor) => (
            <option key={advisor.id} value={advisor.id}>
              {advisor.name}
            </option>
          ))}
        </select>
      </div>

      <ModelSettingsControls settings={settings} onChange={onModelSettingsChange} />

      <Separator className="bg-sidebar-border" />

      <nav className="flex flex-col gap-1 p-2" aria-label="Main tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                activeTab === tab.id &&
                  "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-sm font-medium">Privacy stance</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            Raw founder chat stays local in this MVP. Organizer signal is intentionally out of
            scope.
          </p>
        </div>
      </div>
    </div>
  );
}

function MobileBar(props: {
  activeTab: AppTab;
  advisors: Advisor[];
  advisorId: string;
  settings: AppSettings | null;
  onAdvisorChange: (id: string) => void;
  onModelSettingsChange: (patch: Partial<AppModelSettings>) => void;
  onTabChange: (tab: AppTab) => void;
}) {
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
      <ModelSettingsControls
        settings={props.settings}
        onChange={props.onModelSettingsChange}
        compact
      />
    </div>
  );
}

function ModelSettingsControls({
  settings,
  onChange,
  compact = false,
}: {
  settings: AppSettings | null;
  onChange: (patch: Partial<AppModelSettings>) => void;
  compact?: boolean;
}) {
  const modelSettings = settings?.model ?? DEFAULT_APP_MODEL_SETTINGS;
  const selectedModel = CODEX_MODEL_OPTIONS.find((option) => option.id === modelSettings.model);

  return (
    <section className={cn("px-3 pb-3", compact && "px-0 pb-0")}>
      <div className={cn("border-border bg-background rounded-md border p-3", compact && "p-2")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Model
          </p>
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

        {!compact && (
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
        )}
      </div>
    </section>
  );
}

function BuddyChat({ advisor }: { advisor: Advisor | null }) {
  const [chatId] = React.useState(() => generateId());
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({
        api: "/api/chat",
        body: () => ({ advisorId: advisor?.id ?? "" }),
      }),
    [advisor?.id],
  );

  const { messages, sendMessage, status, stop, error, regenerate, clearError } =
    useChat<AppUIMessage>({
      id: chatId,
      transport,
    });
  const [input, setInput] = React.useState("");
  const isBusy = status === "submitted" || status === "streaming";

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
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-5 py-8">
          {messages.length === 0 ? (
            <div className="m-auto w-full max-w-[620px] text-center">
              <div className="border-border mx-auto mb-6 flex size-12 items-center justify-center rounded-full border">
                <Bot className="text-brand size-5" />
              </div>
              <h2 className="text-2xl font-semibold">Talk to Sprint Buddy</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                The answer uses {advisor.name}&apos;s wiki, skills, vision, and concise founder
                memory.
              </p>
              <div className="mt-8 grid gap-2 text-left">
                {[
                  "I need to have a hard conversation with my co-founder tomorrow.",
                  "I feel like I am losing confidence after a bad pitch.",
                  "Should I pivot or keep pushing this idea?",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => submit(prompt)}
                    className="border-border hover:bg-muted rounded-md border px-4 py-3 text-sm transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList messages={messages} />
          )}
        </div>
      </ScrollArea>
      {error && (
        <div className="mx-auto w-full max-w-[820px] px-5">
          <div className="border-destructive/20 bg-destructive/10 text-destructive flex items-center justify-between rounded-md border px-3 py-2 text-sm">
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
      <div className="mx-auto w-full max-w-[820px] px-5 pt-3 pb-5">
        <form
          className="border-border bg-background flex items-end gap-2 rounded-xl border p-2 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`Ask ${advisor.name} about what you are facing...`}
            className="min-h-10 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button type="button" variant="ghost" size="icon" onClick={stop} disabled={!isBusy}>
            <Circle className="size-4" />
          </Button>
          <Button type="submit" size="icon" disabled={!input.trim() || isBusy}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function MessageList({ messages }: { messages: AppUIMessage[] }) {
  return (
    <div className="flex flex-col gap-6">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}
        >
          {message.role === "assistant" && (
            <div className="border-border flex size-8 shrink-0 items-center justify-center rounded-md border">
              <Bot className="text-brand size-4" />
            </div>
          )}
          <div
            className={cn(
              "max-w-[min(720px,85%)] rounded-xl px-4 py-3",
              message.role === "user"
                ? "border-brand/20 bg-brand-muted text-brand-muted-foreground border"
                : "border-border bg-card border",
            )}
          >
            <MessageParts message={message} />
          </div>
        </div>
      ))}
    </div>
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
          className={message.role === "user" ? "text-brand-muted-foreground" : undefined}
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
        <div key={`${message.id}-${type}-${toolCallKey}`} className="text-muted-foreground text-xs">
          {type.replaceAll("-", " ")}
        </div>
      );
    }
    if (type === "error" && "errorText" in part) {
      errorPartCount += 1;
      return (
        <div
          key={`${message.id}-error-${errorPartCount}`}
          className="border-destructive/20 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
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
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="border-border bg-muted/30 min-h-0 border-b p-4 lg:border-r lg:border-b-0">
        <h2 className="text-sm font-semibold">Advisors</h2>
        <div className="mt-3 flex flex-col gap-2">
          {advisors.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onAdvisorSelected(item.id)}
              aria-pressed={item.id === advisor?.id}
              className={cn(
                "border-border bg-background hover:bg-muted focus-visible:ring-ring/50 w-full rounded-md border p-3 text-left transition-colors outline-none focus-visible:ring-2",
                item.id === advisor?.id && "border-brand/50 bg-brand-muted",
              )}
            >
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{item.description}</p>
            </button>
          ))}
        </div>
        <Separator className="my-4" />
        <Button className="w-full" variant="outline" onClick={() => setIsCreateOpen(true)}>
          <Plus className="size-4" />
          Add advisor
        </Button>
      </aside>
      <CreateAdvisorDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={create}
      />
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
  const [isSkillCreatorOpen, setIsSkillCreatorOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    const [brainData, sourceData] = await Promise.all([
      jsonFetch<AdvisorBrainResponse>(`/api/advisors/${advisor.id}/brain`),
      jsonFetch<ListSourcesResponse>(`/api/advisors/${advisor.id}/sources`),
    ]);
    setBrain(brainData.brain);
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

  const saveBrain = async () => {
    if (!brain) return;
    const data = await jsonFetch<AdvisorBrainResponse>(`/api/advisors/${advisor.id}/brain`, {
      method: "PATCH",
      body: JSON.stringify(brain),
    });
    setBrain(data.brain);
    setStatus("Brain saved to markdown files.");
  };

  const deleteCurrentAdvisor = async () => {
    await jsonFetch(`/api/advisors/${advisor.id}`, { method: "DELETE" });
    await onAdvisorDeleted();
  };

  const saveSource = async () => {
    if (!selectedSource) return;
    await jsonFetch(`/api/advisors/${advisor.id}/sources/${selectedSource.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: selectedSource.title,
        body: selectedSource.body,
        kind: selectedSource.kind,
        sourceUrl: selectedSource.sourceUrl,
        status: selectedSource.status,
        extractionNote: selectedSource.extractionNote,
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

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-5 p-5">
        <section
          aria-label="Advisor metadata"
          className="border-border bg-card rounded-lg border p-3"
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

        <section className="grid gap-4 xl:grid-cols-2">
          <EditorCard title="Profile">
            <Textarea
              value={brain.profile}
              onChange={(event) => setBrain({ ...brain, profile: event.target.value })}
              className="min-h-44 font-mono text-sm"
            />
          </EditorCard>
          <EditorCard title="Vision">
            <Textarea
              value={brain.vision}
              onChange={(event) => setBrain({ ...brain, vision: event.target.value })}
              className="min-h-44 font-mono text-sm"
            />
          </EditorCard>
          <EditorCard title="Direction">
            <Textarea
              value={brain.direction}
              onChange={(event) => setBrain({ ...brain, direction: event.target.value })}
              className="min-h-44 font-mono text-sm"
            />
          </EditorCard>
          <EditorCard title="Founder Memory">
            <Textarea
              value={brain.memory}
              onChange={(event) => setBrain({ ...brain, memory: event.target.value })}
              className="min-h-44 font-mono text-sm"
            />
          </EditorCard>
        </section>

        <PageCollectionEditor
          title="Advisor Wiki"
          pages={brain.wikiPages}
          onChange={(wikiPages) => setBrain({ ...brain, wikiPages })}
        />
        <PageCollectionEditor
          title="Advisor Skills"
          pages={brain.skills}
          addLabel="Add skill"
          onAdd={() => setIsSkillCreatorOpen(true)}
          onChange={(skills) => setBrain({ ...brain, skills })}
        />

        <div className="flex justify-end">
          <Button onClick={saveBrain}>
            <Save className="size-4" />
            Save brain
          </Button>
        </div>

        <SourcesEditor
          advisorId={advisor.id}
          sources={sources}
          selectedSource={selectedSource}
          onSelect={setSelectedSourceId}
          onChangeSelected={(source) =>
            setSources((items) => items.map((item) => (item.id === source.id ? source : item)))
          }
          onSaveSelected={saveSource}
          onDelete={deleteSourceById}
          onImported={async (source) => {
            setSelectedSourceId(source.id);
            await load();
            setStatus(
              source.status === "needs_review"
                ? "Source captured. Review the extracted text before distilling it."
                : "Source imported.",
            );
          }}
        />

        <WorkshopChat advisor={advisor} />
        <SkillCreatorDialog
          advisor={advisor}
          open={isSkillCreatorOpen}
          sources={sources}
          existingSkills={brain.skills}
          onClose={() => setIsSkillCreatorOpen(false)}
          onSourceImported={async (source) => {
            setSelectedSourceId(source.id);
            await load();
          }}
          onInsertSkill={(page) => {
            setBrain((current) =>
              current ? { ...current, skills: [...current.skills, page] } : current,
            );
            setStatus("Skill draft inserted. Save brain to write it to markdown.");
          }}
        />
      </div>
    </ScrollArea>
  );
}

function SkillCreatorDialog({
  advisor,
  open,
  sources,
  existingSkills,
  onClose,
  onSourceImported,
  onInsertSkill,
}: {
  advisor: Advisor;
  open: boolean;
  sources: AdvisorSource[];
  existingSkills: BrainPage[];
  onClose: () => void;
  onSourceImported: (source: AdvisorSource) => void | Promise<void>;
  onInsertSkill: (page: BrainPage) => void;
}) {
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({ api: `/api/advisors/${advisor.id}/workshop-chat` }),
    [advisor.id],
  );
  const { messages, sendMessage, status } = useChat<AppUIMessage>({
    id: `${advisor.id}-skill-creator`,
    transport,
  });
  const [contextSources, setContextSources] = React.useState<AdvisorSource[]>([]);
  const [brief, setBrief] = React.useState("");
  const [chatInput, setChatInput] = React.useState("");
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftSlug, setDraftSlug] = React.useState("");
  const [draftContent, setDraftContent] = React.useState("");
  const [isDragging, setIsDragging] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const busy = status === "submitted" || status === "streaming";

  React.useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  if (!open) return null;

  const addContextSource = (source: AdvisorSource) => {
    setContextSources((items) =>
      items.some((item) => item.id === source.id) ? items : [...items, source],
    );
  };

  const importDroppedFiles = async (files: File[]) => {
    const imported: AdvisorSource[] = [];
    for (const droppedFile of files) {
      const formData = new FormData();
      formData.set("title", titleFromFile(droppedFile));
      if (isPdfFile(droppedFile)) {
        formData.set("kind", "pdf");
        formData.set("file", droppedFile);
      } else if (isTextLikeFile(droppedFile)) {
        const text = await droppedFile.text();
        if (!text.trim()) throw new Error(`${droppedFile.name} is empty.`);
        formData.set("kind", "text");
        formData.set("body", text);
      } else {
        throw new Error(`${droppedFile.name} is not a supported source file.`);
      }
      const source = await importAdvisorSource(advisor.id, formData);
      imported.push(source);
      await onSourceImported(source);
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
      formData.set("title", "");
      formData.set("url", maybeUrl);
    } else {
      formData.set("kind", "text");
      formData.set("title", "Skill creator context");
      formData.set("body", dropped);
    }
    const source = await importAdvisorSource(advisor.id, formData);
    await onSourceImported(source);
    return [source];
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isImporting) return;
    setIsImporting(true);
    setError(null);
    try {
      const files = Array.from(event.dataTransfer.files);
      const imported =
        files.length > 0
          ? await importDroppedFiles(files)
          : await importDroppedText(
              event.dataTransfer.getData("text/uri-list") ||
                event.dataTransfer.getData("text/plain"),
            );
      if (imported.length === 0) throw new Error("Drop a PDF, text file, URL, or text.");
      setContextSources((items) => {
        const next = [...items];
        for (const source of imported) {
          if (!next.some((item) => item.id === source.id)) next.push(source);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import dropped context");
    } finally {
      setIsImporting(false);
    }
  };

  const handlePickedFiles = async (files: File[]) => {
    if (files.length === 0 || isImporting) return;
    setIsImporting(true);
    setError(null);
    try {
      const imported = await importDroppedFiles(files);
      setContextSources((items) => {
        const next = [...items];
        for (const source of imported) {
          if (!next.some((item) => item.id === source.id)) next.push(source);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import selected files");
    } finally {
      setIsImporting(false);
    }
  };

  const submit = () => {
    const request = chatInput.trim() || "Draft one advisor skill from the attached context.";
    const context = contextSources
      .map(
        (source) =>
          `## ${source.title}\nType: ${source.kind ?? "text"}\nStatus: ${source.status ?? "ready"}\n${source.body.slice(0, 4000)}`,
      )
      .join("\n\n");
    setChatInput("");
    void sendMessage({
      text: [
        "Act as a concise skill-creator for a Sprint Buddy advisor brain.",
        `Advisor: ${advisor.name}`,
        brief.trim() ? `Skill brief: ${brief.trim()}` : undefined,
        context ? `Context sources:\n${context}` : "No context sources attached.",
        "Return one copy-ready advisor skill markdown page with: Trigger, Procedure, Response Shape.",
        `User request: ${request}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  };

  const makeDraft = () => {
    const title =
      draftTitle.trim() ||
      brief.trim().split(/\r?\n/)[0]?.slice(0, 80) ||
      contextSources[0]?.title ||
      "New Advisor Skill";
    const slug = uniquePageSlug(draftSlug || slugify(title), existingSkills);
    setDraftTitle(title);
    setDraftSlug(slug);
    setDraftContent(advisorSkillMarkdown(title, brief, contextSources));
  };

  const insertSkill = () => {
    const title = draftTitle.trim() || "New Advisor Skill";
    const slug = uniquePageSlug(draftSlug || slugify(title), existingSkills);
    onInsertSkill({
      slug,
      title,
      content: draftContent.trim() || advisorSkillMarkdown(title, brief, contextSources),
      updatedAt: Date.now(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="bg-background border-border flex max-h-[90dvh] w-full max-w-[1120px] flex-col overflow-hidden rounded-lg border shadow-xl">
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Skill creator</h2>
            <p className="text-muted-foreground text-xs">{advisor.name}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="border-border bg-muted/20 min-h-0 border-b p-4 lg:border-r lg:border-b-0">
            <label
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                setIsDragging(false);
              }}
              onDrop={(event) => void handleDrop(event)}
              className={cn(
                "border-border bg-background hover:bg-muted focus-within:ring-ring/50 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-center transition-colors focus-within:ring-2",
                isDragging && "border-brand bg-brand-muted text-brand",
              )}
            >
              <input
                type="file"
                multiple
                accept="application/pdf,.pdf,.txt,.md,.markdown,.csv,.json,text/*"
                className="hidden"
                onChange={(event) => {
                  const pickedFiles = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void handlePickedFiles(pickedFiles);
                }}
              />
              <Upload className="mb-2 size-5" />
              <p className="text-sm font-medium">{isImporting ? "Importing..." : "Drop context"}</p>
              <p className="text-muted-foreground mt-1 text-xs">PDF, text, markdown, URL</p>
            </label>

            {error && (
              <div className="text-destructive mt-3 flex items-start gap-2 text-xs leading-5">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-medium tracking-wider uppercase">Context</h3>
              <div className="space-y-2">
                {contextSources.map((source) => (
                  <div
                    key={source.id}
                    className="border-border bg-background rounded-md border p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{source.title}</p>
                        <p className="text-muted-foreground text-xs">
                          {source.kind ?? "text"}
                          {source.status === "needs_review" ? " · needs review" : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() =>
                          setContextSources((items) =>
                            items.filter((item) => item.id !== source.id),
                          )
                        }
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {contextSources.length === 0 && (
                  <p className="text-muted-foreground text-sm">No context attached.</p>
                )}
              </div>
            </div>

            {sources.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-xs font-medium tracking-wider uppercase">Existing sources</h3>
                <div className="flex flex-wrap gap-1.5">
                  {sources.slice(0, 8).map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => addContextSource(source)}
                      className="border-border bg-background hover:bg-muted rounded-md border px-2 py-1 text-xs"
                    >
                      {source.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <div className="grid min-h-0 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-h-[520px] flex-col">
              <Textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Skill goal, trigger, or founder situation"
                className="mb-3 min-h-20"
              />
              <div className="border-border bg-card min-h-0 flex-1 overflow-auto rounded-md border p-3">
                {messages.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Ask for a focused advisor skill draft from the attached context.
                  </p>
                ) : (
                  <MessageList messages={messages} />
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
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask the skill creator"
                />
                <Button type="submit" disabled={busy || (!chatInput.trim() && !brief.trim())}>
                  <Send className="size-4" />
                </Button>
              </form>
            </div>

            <div className="border-border bg-card rounded-md border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Draft skill</h3>
                <Button type="button" variant="outline" size="sm" onClick={makeDraft}>
                  <Sparkles className="size-4" />
                  Draft
                </Button>
              </div>
              <div className="space-y-2">
                <Input
                  value={draftSlug}
                  onChange={(event) => setDraftSlug(event.target.value)}
                  placeholder="skill-slug"
                />
                <Input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder="Skill title"
                />
                <Textarea
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  placeholder="# Skill title"
                  className="min-h-[330px] font-mono text-sm"
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={insertSkill}
                  disabled={!draftTitle.trim() && !draftContent.trim()}
                >
                  <Plus className="size-4" />
                  Insert skill
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
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
    <section className="border-border bg-card rounded-lg border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function PageCollectionEditor({
  title,
  pages,
  onChange,
  addLabel = "Add page",
  onAdd,
}: {
  title: string;
  pages: BrainPage[];
  onChange: (pages: BrainPage[]) => void;
  addLabel?: string;
  onAdd?: () => void;
}) {
  const update = (index: number, patch: Partial<BrainPage>) => {
    onChange(pages.map((page, i) => (i === index ? { ...page, ...patch } : page)));
  };

  const addPage = () => {
    if (onAdd) {
      onAdd();
      return;
    }
    onChange([
      ...pages,
      {
        slug: `new-${pages.length + 1}`,
        title: "New page",
        content: "# New page\n\n",
        updatedAt: Date.now(),
      },
    ]);
  };

  return (
    <section className="border-border bg-card rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button size="sm" variant="outline" onClick={addPage}>
          <Plus className="size-4" />
          {addLabel}
        </Button>
      </div>
      <div className="grid gap-3">
        {pages.map((page, index) => (
          <div
            key={`${page.slug}-${page.updatedAt}`}
            className="border-border rounded-md border p-3"
          >
            <div className="mb-2 grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
              <Input
                value={page.slug}
                onChange={(event) => update(index, { slug: event.target.value })}
              />
              <Input
                value={page.title}
                onChange={(event) => update(index, { title: event.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onChange(pages.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              value={page.content}
              onChange={(event) => update(index, { content: event.target.value })}
              className="min-h-36 font-mono text-sm"
            />
          </div>
        ))}
      </div>
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
  onSaveSelected: () => void;
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
      : kind === "pdf"
        ? Boolean(file)
        : url.trim().length > 0;

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
    <section className="border-border bg-card rounded-lg border p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="text-brand size-4" />
          <h3 className="text-sm font-semibold">Sources</h3>
        </div>
        <div className="text-muted-foreground text-xs">{sources.length} captured</div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
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
                      setKind(option.id);
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
              {kind === "pdf" && (
                <Input
                  key={file?.name ?? "empty-pdf-input"}
                  type="file"
                  accept="application/pdf,.pdf"
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
          <div className="space-y-2">
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
              className="min-h-[360px] font-mono text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onSaveSelected}>
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
        ) : (
          <EmptyPanel title="No source selected" body="Add or select a source to edit it." />
        )}
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
    <section className="border-border bg-card rounded-lg border p-3">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="text-brand size-4" />
        <h3 className="text-sm font-semibold">Advisor Brain Workshop</h3>
      </div>
      <div className="border-border bg-background max-h-[420px] overflow-auto rounded-md border p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Ask for source distillation, vision refinement, wiki page drafts, or advisor skills.
          </p>
        ) : (
          <MessageList messages={messages} />
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
          placeholder="Example: turn my sources into wiki pages and skills"
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
