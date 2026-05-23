import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";
import { z } from "zod";
import type { AppSettings } from "@/lib/ai/model-settings";
import {
  CODEX_MODEL_OPTIONS,
  CODEX_REASONING_OPTIONS,
  CODEX_TEXT_VERBOSITY_OPTIONS,
  DEFAULT_APP_CHECKIN_SETTINGS,
  MAX_CHECKIN_INTERVAL_DAYS,
  MIN_CHECKIN_INTERVAL_DAYS,
} from "@/lib/ai/model-settings";

export type AppTab = "chat" | "advisor" | "checkins";

export type AppUIMessage = UIMessage<unknown, UIDataTypes, UITools>;
export type AppUIMessagePart = UIMessagePart<UIDataTypes, UITools>;

export interface Advisor {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdvisorSource {
  id: string;
  advisorId: string;
  title: string;
  body: string;
  kind?: "text" | "website" | "youtube" | "pdf";
  sourceUrl?: string;
  status?: "ready" | "needs_review" | "error";
  extractionNote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrainPage {
  slug: string;
  title: string;
  content: string;
  updatedAt: number;
}

export interface AdvisorBrain {
  profile: string;
  vision: string;
  direction: string;
  memory: string;
  schema: string;
  wikiPages: BrainPage[];
  skills: BrainPage[];
}

export interface Conversation {
  id: string;
  advisorId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant";
  parts: AppUIMessagePart[];
  createdAt: number;
}

export type CheckinStatus = "todo" | "done";

export interface CheckinItem {
  id: string;
  advisorId: string;
  title: string;
  prompt: string;
  status: CheckinStatus;
  createdAt: number;
  dueAt: number;
}

export interface SearchHit {
  source: "profile" | "vision" | "direction" | "memory" | "schema" | "wiki" | "skill" | "source";
  slug: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface ListAdvisorsResponse {
  advisors: Advisor[];
}

export interface AdvisorResponse {
  advisor: Advisor;
}

export interface AdvisorBrainResponse {
  advisor: Advisor;
  brain: AdvisorBrain;
}

export interface ListSourcesResponse {
  sources: AdvisorSource[];
}

export interface ListConversationsResponse {
  conversations: Conversation[];
}

export interface ConversationResponse {
  conversation: Conversation;
  messages: AppUIMessage[];
}

export interface CheckinsResponse {
  checkins: CheckinItem[];
}

export interface SettingsResponse {
  settings: AppSettings;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const uiMessageSchema: z.ZodType<AppUIMessage> = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(z.unknown()),
}) as unknown as z.ZodType<AppUIMessage>;

export const ChatRequestBodySchema = z.object({
  id: z.string().min(1),
  advisorId: z.string().min(1),
  messages: z.array(uiMessageSchema).min(1),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  messageId: z.string().optional(),
});

export const WorkshopChatRequestBodySchema = z.object({
  id: z.string().min(1),
  messages: z.array(uiMessageSchema).min(1),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  messageId: z.string().optional(),
});

export const CreateAdvisorBodySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional().default(""),
});

export const UpdateAdvisorBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(240).optional(),
});

const codexModelIds = CODEX_MODEL_OPTIONS.map((option) => option.id) as [
  (typeof CODEX_MODEL_OPTIONS)[number]["id"],
  ...(typeof CODEX_MODEL_OPTIONS)[number]["id"][],
];
const codexReasoningIds = CODEX_REASONING_OPTIONS.map((option) => option.id) as [
  (typeof CODEX_REASONING_OPTIONS)[number]["id"],
  ...(typeof CODEX_REASONING_OPTIONS)[number]["id"][],
];
const codexTextVerbosityIds = CODEX_TEXT_VERBOSITY_OPTIONS.map((option) => option.id) as [
  (typeof CODEX_TEXT_VERBOSITY_OPTIONS)[number]["id"],
  ...(typeof CODEX_TEXT_VERBOSITY_OPTIONS)[number]["id"][],
];

export const UpdateSettingsBodySchema = z.object({
  model: z.object({
    model: z.enum(codexModelIds),
    reasoningEffort: z.enum(codexReasoningIds),
    textVerbosity: z.enum(codexTextVerbosityIds),
    openAIApiKey: z.string().optional(),
  }),
  checkins: z
    .object({
      intervalDays: z.coerce
        .number()
        .int()
        .min(MIN_CHECKIN_INTERVAL_DAYS)
        .max(MAX_CHECKIN_INTERVAL_DAYS),
    })
    .default(DEFAULT_APP_CHECKIN_SETTINGS),
});

export const UpsertSourceBodySchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1),
  kind: z.enum(["text", "website", "youtube", "pdf"]).optional(),
  sourceUrl: z.string().optional(),
  status: z.enum(["ready", "needs_review", "error"]).optional(),
  extractionNote: z.string().optional(),
});

export const UpdateBrainBodySchema = z.object({
  profile: z.string(),
  vision: z.string(),
  direction: z.string(),
  memory: z.string(),
  schema: z.string().optional(),
  wikiPages: z.array(
    z.object({
      slug: z.string().min(1).max(100),
      title: z.string().min(1).max(120),
      content: z.string(),
      updatedAt: z.number().optional(),
    }),
  ),
  skills: z.array(
    z.object({
      slug: z.string().min(1).max(100),
      title: z.string().min(1).max(120),
      content: z.string(),
      updatedAt: z.number().optional(),
    }),
  ),
});

export const UpdateCheckinBodySchema = z.object({
  status: z.enum(["todo", "done"]),
});
