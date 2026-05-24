import { safeValidateUIMessages } from "ai";
import { streamCodexAgent } from "@/lib/ai/agents";
import { buddySystemPrompt, fallbackBuddyAnswer } from "@/lib/ai/prompts";
import { hasModelCredentials, providerErrorMessage } from "@/lib/ai/provider";
import { textStreamResponse } from "@/lib/ai/streams";
import { buddyContextTools } from "@/lib/ai/tools";
import { buildBuddyAnswerContext } from "@/lib/buddy-context";
import { graphFallbackDirectAnswer } from "@/lib/graph-fallback-skill";
import { errorJson, zodError } from "@/lib/http";
import { saveConversationMessages, updateFounderMemoryFromMessages } from "@/lib/store";
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

  const userText = lastUserText(validated.data);
  const context = await buildBuddyAnswerContext(
    parsed.data.advisorId,
    parsed.data.founderId,
    userText,
  );
  if (!context) return errorJson("not_found", "Advisor or founder not found", 404);

  if (!context.graphifyEnabled) {
    const directFallbackAnswer = graphFallbackDirectAnswer(userText, context.graphFallbackSkill);
    if (directFallbackAnswer) {
      return textStreamResponse<AppUIMessage>(
        validated.data,
        directFallbackAnswer,
        async (messages) => {
          await saveConversationMessages(
            parsed.data.id,
            context.advisor.id,
            context.founder.id,
            messages,
          );
        },
      );
    }
  }

  if (!hasModelCredentials()) {
    return textStreamResponse<AppUIMessage>(
      validated.data,
      fallbackBuddyAnswer(userText, context),
      async (messages) => {
        await saveConversationMessages(
          parsed.data.id,
          context.advisor.id,
          context.founder.id,
          messages,
        );
        await updateFounderMemoryFromMessages(context.founder.id, messages);
      },
    );
  }

  const result = await streamCodexAgent({
    id: "sprint-buddy-chat",
    instructions: buddySystemPrompt(context),
    messages: validated.data,
    tools: buddyContextTools(context.advisor.id, context.founder.id),
    maxSteps: 3,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: validated.data,
    onFinish: async ({ messages }) => {
      await saveConversationMessages(
        parsed.data.id,
        context.advisor.id,
        context.founder.id,
        messages as AppUIMessage[],
      );
      await updateFounderMemoryFromMessages(context.founder.id, messages as AppUIMessage[]);
    },
    onError: providerErrorMessage,
  });
}
