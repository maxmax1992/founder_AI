import { safeValidateUIMessages } from "ai";
import { streamCodexAgent } from "@/lib/ai/agents";
import { buddySystemPrompt, fallbackBuddyAnswer } from "@/lib/ai/prompts";
import { hasModelCredentials, providerErrorMessage } from "@/lib/ai/provider";
import { textStreamResponse } from "@/lib/ai/streams";
import { advisorTools } from "@/lib/ai/tools";
import { errorJson, zodError } from "@/lib/http";
import {
  getAdvisor,
  getAdvisorBrain,
  listSources,
  saveConversationMessages,
  updateMemoryFromMessages,
} from "@/lib/store";
import { type AppUIMessage, ChatRequestBodySchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function lastUserText(messages: AppUIMessage[]) {
  const message = [...messages].reverse().find((item) => item.role === "user");
  if (!message) return "";
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = ChatRequestBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error);

  const validated = await safeValidateUIMessages<AppUIMessage>({ messages: parsed.data.messages });
  if (!validated.success) {
    return errorJson("bad_request", "Invalid UI messages", 400, validated.error.message);
  }

  const advisor = await getAdvisor(parsed.data.advisorId);
  const brain = await getAdvisorBrain(parsed.data.advisorId);
  if (!advisor || !brain) return errorJson("not_found", "Advisor not found", 404);
  const sources = await listSources(advisor.id);

  if (!hasModelCredentials()) {
    return textStreamResponse<AppUIMessage>(
      validated.data,
      fallbackBuddyAnswer(lastUserText(validated.data), advisor, brain),
      async (messages) => {
        await saveConversationMessages(parsed.data.id, advisor.id, messages);
        await updateMemoryFromMessages(advisor.id, messages);
      },
    );
  }

  const result = await streamCodexAgent({
    id: "sprint-buddy-chat",
    instructions: buddySystemPrompt(advisor, brain, sources),
    messages: validated.data,
    tools: advisorTools(advisor.id),
    maxSteps: 3,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: validated.data,
    onFinish: async ({ messages }) => {
      await saveConversationMessages(parsed.data.id, advisor.id, messages as AppUIMessage[]);
      await updateMemoryFromMessages(advisor.id, messages as AppUIMessage[]);
    },
    onError: providerErrorMessage,
  });
}
