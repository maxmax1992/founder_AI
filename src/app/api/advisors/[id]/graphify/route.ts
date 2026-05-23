import { refreshAdvisorGraphifyBrain } from "@/lib/graphify-brain";
import { errorJson } from "@/lib/http";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const result = await refreshAdvisorGraphifyBrain(id);
  if (!result) return errorJson("not_found", "Advisor not found", 404);
  return Response.json({ advisor: result.advisor, brain: result.brain });
}
