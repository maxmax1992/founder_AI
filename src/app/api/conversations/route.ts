import { listConversations } from "@/lib/store";
import type { ListConversationsResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const advisorId = url.searchParams.get("advisorId") || undefined;
  const body: ListConversationsResponse = {
    conversations: await listConversations(advisorId),
  };
  return Response.json(body);
}
