import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import { convertToModelMessages, smoothStream, stepCountIs, streamText, type ToolSet } from "ai";
import type { CodexAppServerSettings } from "ai-sdk-provider-codex-cli";

import { getCodexModelSettings } from "@/lib/ai/provider";
import type { AppUIMessage } from "@/lib/types";

interface StreamCodexAgentOptions<TOOLS extends ToolSet> {
  id: string;
  instructions: string;
  messages: AppUIMessage[];
  tools?: TOOLS;
  maxSteps?: number;
  providerOptions?: Record<string, unknown>;
  codexAppServerSettings?: Partial<CodexAppServerSettings>;
}

function mergeProviderOptions(
  base: SharedV3ProviderOptions | undefined,
  extra: Record<string, unknown> | undefined,
) {
  if (!extra) return base;
  const merged = { ...(base ?? {}) } as Record<string, unknown>;
  for (const [provider, options] of Object.entries(extra)) {
    const baseOptions = merged[provider];
    merged[provider] =
      typeof baseOptions === "object" && baseOptions !== null && typeof options === "object"
        ? { ...baseOptions, ...options }
        : options;
  }
  return merged as SharedV3ProviderOptions;
}

export async function streamCodexAgent<TOOLS extends ToolSet = Record<string, never>>({
  id,
  instructions,
  messages,
  tools,
  maxSteps = 3,
  providerOptions,
  codexAppServerSettings,
}: StreamCodexAgentOptions<TOOLS>) {
  const modelSettings = getCodexModelSettings({ codexAppServerSettings });
  return streamText({
    ...modelSettings,
    experimental_telemetry: { functionId: id },
    experimental_transform: smoothStream({ chunking: "word", delayInMs: 24 }),
    messages: await convertToModelMessages(messages),
    providerOptions: mergeProviderOptions(modelSettings.providerOptions, providerOptions),
    stopWhen: stepCountIs(maxSteps),
    system: instructions,
    tools,
  });
}
