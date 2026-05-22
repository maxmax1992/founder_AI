import { convertToModelMessages, smoothStream, stepCountIs, streamText, type ToolSet } from "ai";

import { getCodexModelSettings } from "@/lib/ai/provider";
import type { AppUIMessage } from "@/lib/types";

interface StreamCodexAgentOptions<TOOLS extends ToolSet> {
  id: string;
  instructions: string;
  messages: AppUIMessage[];
  tools?: TOOLS;
  maxSteps?: number;
}

export async function streamCodexAgent<TOOLS extends ToolSet = Record<string, never>>({
  id,
  instructions,
  messages,
  tools,
  maxSteps = 3,
}: StreamCodexAgentOptions<TOOLS>) {
  return streamText({
    ...getCodexModelSettings(),
    experimental_telemetry: { functionId: id },
    experimental_transform: smoothStream({ chunking: "word", delayInMs: 24 }),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(maxSteps),
    system: instructions,
    tools,
  });
}
