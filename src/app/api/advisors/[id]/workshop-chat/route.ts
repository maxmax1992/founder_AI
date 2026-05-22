import { safeValidateUIMessages } from "ai";
import { streamCodexAgent } from "@/lib/ai/agents";
import { fallbackWorkshopAnswer, workshopSystemPrompt } from "@/lib/ai/prompts";
import { hasModelCredentials, providerErrorMessage } from "@/lib/ai/provider";
import { textStreamResponse } from "@/lib/ai/streams";
import { errorJson, zodError } from "@/lib/http";
import { getAdvisor, getAdvisorBrain, listSources } from "@/lib/store";
import { type AppUIMessage, WorkshopChatRequestBodySchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = WorkshopChatRequestBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error);

  const validated = await safeValidateUIMessages<AppUIMessage>({ messages: parsed.data.messages });
  if (!validated.success) {
    return errorJson("bad_request", "Invalid UI messages", 400, validated.error.message);
  }

  const advisor = await getAdvisor(id);
  const brain = await getAdvisorBrain(id);
  if (!advisor || !brain) return errorJson("not_found", "Advisor not found", 404);
  const sources = await listSources(id);

  if (!hasModelCredentials()) {
    return textStreamResponse<AppUIMessage>(validated.data, fallbackWorkshopAnswer(advisor));
  }

  const result = await streamCodexAgent({
    id: "advisor-brain-workshop",
    instructions: workshopSystemPrompt(advisor, brain, sources),
    messages: validated.data,
    maxSteps: 3,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: validated.data,
    onError: providerErrorMessage,
  });
}
