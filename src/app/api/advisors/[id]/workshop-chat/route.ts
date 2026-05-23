import { safeValidateUIMessages } from "ai";
import { callAdvisorEditorMcpServerTool } from "@/lib/ai/advisor-mcp";
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

function lastUserText(messages: AppUIMessage[]) {
  const lastUser = messages.findLast((message) => message.role === "user");
  return (
    lastUser?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim() ?? ""
  );
}

async function runDirectAdvisorEditorCommand(advisorId: string, text: string) {
  if (/(refresh|rebuild|regenerate).{0,50}(graphify brain|graph\.md)/i.test(text)) {
    await callAdvisorEditorMcpServerTool(advisorId, "refresh_graphify_brain", {});
    return "Saved Graphify Brain via the local advisor_editor MCP server.";
  }

  if (/mcp__advisor_editor__refresh_graphify_brain|refresh_graphify_brain/i.test(text)) {
    await callAdvisorEditorMcpServerTool(advisorId, "refresh_graphify_brain", {});
    return "Saved Graphify Brain via the local advisor_editor MCP server.";
  }

  const updateMatch = text.match(
    /(?:update|set|replace)\s+(?:advisor\s+)?(profile|vision|direction|memory|graphify brain|graph)\s*(?:to|:)\s*([\s\S]+)/i,
  );
  if (!updateMatch) return null;

  const sectionLabel = updateMatch[1].toLowerCase();
  const content = updateMatch[2].trim();
  if (!content) return null;

  const section = sectionLabel === "graphify brain" ? "graph" : sectionLabel;
  await callAdvisorEditorMcpServerTool(advisorId, "update_advisor_brain_section", {
    section,
    content,
  });
  const displaySection = section === "graph" ? "Graphify Brain" : section;
  return `Saved ${displaySection} via the local advisor_editor MCP server.`;
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
  const directEditorResult = await runDirectAdvisorEditorCommand(id, lastUserText(validated.data));
  if (directEditorResult) {
    return textStreamResponse<AppUIMessage>(validated.data, directEditorResult);
  }

  if (!hasModelCredentials()) {
    return textStreamResponse<AppUIMessage>(validated.data, fallbackWorkshopAnswer(advisor));
  }

  const result = await streamCodexAgent({
    id: "advisor-brain-workshop",
    instructions: workshopSystemPrompt(advisor, brain, sources),
    messages: validated.data,
    maxSteps: 6,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: validated.data,
    onError: providerErrorMessage,
  });
}
