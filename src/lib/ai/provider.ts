import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gateway } from "@ai-sdk/gateway";
import { type OpenAILanguageModelResponsesOptions, openai } from "@ai-sdk/openai";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import { type CodexAppServerSettings, createCodexAppServer } from "ai-sdk-provider-codex-cli";
import {
  type AppModelSettings,
  DEFAULT_APP_MODEL_SETTINGS,
  normalizeAppModelSettings,
} from "@/lib/ai/model-settings";

export const DEFAULT_OPENAI_CODEX_MODEL = "gpt-5.2-codex";

type ProviderMode = "codex-cli" | "openai" | "gateway";

const DATA_INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const codexAppServerProvider = createCodexAppServer({
  defaultSettings: {
    idleTimeoutMs: 120_000,
    minCodexVersion: "0.130.0",
  },
});

function providerMode(): ProviderMode {
  const requested = process.env.AI_PROVIDER?.toLowerCase();
  if (requested === "codex" || requested === "codex-cli" || requested === "cli") {
    return "codex-cli";
  }
  if (requested === "gateway") return "gateway";
  if (requested === "openai") return "openai";
  if (hasCodexCliAuth()) return "codex-cli";
  if (
    !process.env.OPENAI_API_KEY &&
    (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY)
  ) {
    return "gateway";
  }
  return "openai";
}

function codexCliAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function hasCodexCliAuth() {
  try {
    const raw = fs.readFileSync(codexCliAuthPath(), "utf8");
    const auth = JSON.parse(raw) as { tokens?: { access_token?: unknown } };
    return typeof auth.tokens?.access_token === "string" && auth.tokens.access_token.length > 0;
  } catch {
    return false;
  }
}

function storedModelSettings(): AppModelSettings {
  try {
    const raw = fs.readFileSync(DATA_INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as { settings?: { model?: unknown } };
    return normalizeAppModelSettings(parsed.settings?.model);
  } catch {
    return normalizeAppModelSettings({
      model: process.env.CODEX_CLI_MODEL ?? process.env.CODEX_MODEL ?? process.env.AI_MODEL,
      reasoningEffort:
        process.env.CODEX_REASONING_EFFORT ??
        process.env.OPENAI_REASONING_EFFORT ??
        process.env.AI_REASONING_EFFORT,
      textVerbosity:
        process.env.CODEX_TEXT_VERBOSITY ??
        process.env.OPENAI_TEXT_VERBOSITY ??
        process.env.AI_TEXT_VERBOSITY,
    });
  }
}

function openAIModelId(settings: AppModelSettings) {
  const model =
    process.env.CODEX_API_MODEL ??
    process.env.OPENAI_MODEL ??
    settings.model ??
    DEFAULT_OPENAI_CODEX_MODEL;
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function codexCliModelId(settings: AppModelSettings) {
  return settings.model;
}

function codexCliPath() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;

  const bunCodexPath = path.join(os.homedir(), ".bun", "bin", "codex");
  return fs.existsSync(bunCodexPath) ? bunCodexPath : "codex";
}

function gatewayModelId(settings: AppModelSettings) {
  const model =
    process.env.CODEX_GATEWAY_MODEL ?? process.env.AI_GATEWAY_MODEL ?? `openai/${settings.model}`;
  return model.includes("/") ? model : `openai/${model}`;
}

function codexReasoningEffort(settings: AppModelSettings) {
  return settings.reasoningEffort ?? DEFAULT_APP_MODEL_SETTINGS.reasoningEffort;
}

function codexTextVerbosity(settings: AppModelSettings) {
  return settings.textVerbosity ?? DEFAULT_APP_MODEL_SETTINGS.textVerbosity;
}

export function getCodexModel() {
  const settings = storedModelSettings();
  if (providerMode() === "codex-cli") {
    return codexAppServerProvider(codexCliModelId(settings), codexAppServerSettings(settings));
  }
  if (providerMode() === "gateway") {
    return gateway(gatewayModelId(settings));
  }
  return openai(openAIModelId(settings));
}

export function getCodexProviderOptions(): SharedV3ProviderOptions {
  return getCodexProviderOptionsFor(storedModelSettings());
}

function mergeCodexAppServerSettings(
  base: CodexAppServerSettings,
  extra?: Partial<CodexAppServerSettings>,
): CodexAppServerSettings {
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    configOverrides:
      base.configOverrides || extra.configOverrides
        ? { ...(base.configOverrides ?? {}), ...(extra.configOverrides ?? {}) }
        : undefined,
    mcpServers:
      base.mcpServers || extra.mcpServers
        ? { ...(base.mcpServers ?? {}), ...(extra.mcpServers ?? {}) }
        : undefined,
    serverRequests:
      base.serverRequests || extra.serverRequests
        ? { ...(base.serverRequests ?? {}), ...(extra.serverRequests ?? {}) }
        : undefined,
  };
}

export function getCodexModelSettings(options?: {
  codexAppServerSettings?: Partial<CodexAppServerSettings>;
}) {
  const settings = storedModelSettings();
  const appServerSettings = mergeCodexAppServerSettings(
    codexAppServerSettings(settings),
    options?.codexAppServerSettings,
  );
  return {
    model:
      providerMode() === "codex-cli"
        ? codexAppServerProvider(codexCliModelId(settings), appServerSettings)
        : providerMode() === "gateway"
          ? gateway(gatewayModelId(settings))
          : openai(openAIModelId(settings)),
    providerOptions: getCodexProviderOptionsFor(settings),
  };
}

export function hasModelCredentials() {
  if (providerMode() === "codex-cli") {
    return hasCodexCliAuth() || Boolean(process.env.OPENAI_API_KEY);
  }
  if (providerMode() === "gateway") {
    return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY);
  }
  return Boolean(process.env.OPENAI_API_KEY);
}

export function describeModelProvider() {
  const settings = storedModelSettings();
  const suffix = `reasoning=${codexReasoningEffort(settings)}, verbosity=${codexTextVerbosity(settings)}`;
  if (providerMode() === "codex-cli") {
    return `Codex App Server (${codexCliModelId(settings)}, ${suffix})`;
  }
  if (providerMode() === "gateway") {
    return `Vercel AI Gateway (${gatewayModelId(settings)}, ${suffix})`;
  }
  return `OpenAI Codex (${openAIModelId(settings)}, ${suffix})`;
}

export function providerErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return `${describeModelProvider()} failed: ${error.message}`;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return `${describeModelProvider()} failed: ${String(error.message)}`;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "object" &&
    error.error !== null &&
    "message" in error.error
  ) {
    return `${describeModelProvider()} failed: ${String(error.error.message)}`;
  }
  return `${describeModelProvider()} failed. Check API credentials, quota, and model access.`;
}

function getCodexProviderOptionsFor(settings: AppModelSettings): SharedV3ProviderOptions {
  if (providerMode() === "codex-cli") {
    return {
      "codex-app-server": {
        effort: codexReasoningEffort(settings),
        configOverrides: {
          model_verbosity: codexTextVerbosity(settings),
        },
      },
    };
  }

  const openaiOptions = {
    reasoningEffort: codexReasoningEffort(settings),
    textVerbosity: codexTextVerbosity(settings),
  } satisfies OpenAILanguageModelResponsesOptions;
  return { openai: openaiOptions };
}

function codexAppServerSettings(settings: AppModelSettings): CodexAppServerSettings {
  return {
    approvalPolicy: "never",
    codexPath: codexCliPath(),
    configOverrides: {
      model_verbosity: codexTextVerbosity(settings),
    },
    cwd: process.cwd(),
    effort: codexReasoningEffort(settings),
    env: hasCodexCliAuth() ? { OPENAI_API_KEY: "" } : undefined,
    logger: false,
    sandboxPolicy: "read-only",
  };
}
