import { errorJson } from "@/lib/http";
import { getConversation } from "@/lib/store";
import type { ConversationResponse } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(req.url);
  const advisorId = url.searchParams.get("advisorId") || undefined;
  const conversation = await getConversation(id, advisorId);
  if (!conversation) return errorJson("not_found", "Conversation not found", 404);

  const body: ConversationResponse = conversation;
  return Response.json(body);
}
