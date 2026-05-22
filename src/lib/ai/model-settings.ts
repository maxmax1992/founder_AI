export const CODEX_MODEL_OPTIONS = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    detail: "Baseline",
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    detail: "Balanced",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    detail: "Fast",
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    detail: "Coding",
  },
] as const;

export const CODEX_REASONING_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
] as const;

export const CODEX_TEXT_VERBOSITY_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
] as const;

export type CodexModelId = (typeof CODEX_MODEL_OPTIONS)[number]["id"];
export type CodexReasoningEffort = (typeof CODEX_REASONING_OPTIONS)[number]["id"];
export type CodexTextVerbosity = (typeof CODEX_TEXT_VERBOSITY_OPTIONS)[number]["id"];

export interface AppModelSettings {
  model: CodexModelId;
  reasoningEffort: CodexReasoningEffort;
  textVerbosity: CodexTextVerbosity;
}

export interface AppSettings {
  model: AppModelSettings;
}

export const DEFAULT_APP_MODEL_SETTINGS: AppModelSettings = {
  model: "gpt-5.5",
  reasoningEffort: "medium",
  textVerbosity: "medium",
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  model: DEFAULT_APP_MODEL_SETTINGS,
};

const CODEX_MODEL_IDS = new Set<string>(CODEX_MODEL_OPTIONS.map((option) => option.id));
const CODEX_REASONING_IDS = new Set<string>(CODEX_REASONING_OPTIONS.map((option) => option.id));
const CODEX_TEXT_VERBOSITY_IDS = new Set<string>(
  CODEX_TEXT_VERBOSITY_OPTIONS.map((option) => option.id),
);

function objectValue(input: unknown, key: string) {
  return typeof input === "object" && input !== null && key in input
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

function normalizeModelId(value: unknown): CodexModelId {
  return typeof value === "string" && CODEX_MODEL_IDS.has(value)
    ? (value as CodexModelId)
    : DEFAULT_APP_MODEL_SETTINGS.model;
}

function normalizeReasoningEffort(value: unknown): CodexReasoningEffort {
  return typeof value === "string" && CODEX_REASONING_IDS.has(value)
    ? (value as CodexReasoningEffort)
    : DEFAULT_APP_MODEL_SETTINGS.reasoningEffort;
}

function normalizeTextVerbosity(value: unknown): CodexTextVerbosity {
  return typeof value === "string" && CODEX_TEXT_VERBOSITY_IDS.has(value)
    ? (value as CodexTextVerbosity)
    : DEFAULT_APP_MODEL_SETTINGS.textVerbosity;
}

export function normalizeAppModelSettings(input: unknown): AppModelSettings {
  return {
    model: normalizeModelId(objectValue(input, "model")),
    reasoningEffort: normalizeReasoningEffort(objectValue(input, "reasoningEffort")),
    textVerbosity: normalizeTextVerbosity(objectValue(input, "textVerbosity")),
  };
}

export function normalizeAppSettings(input: unknown): AppSettings {
  return {
    model: normalizeAppModelSettings(objectValue(input, "model")),
  };
}
