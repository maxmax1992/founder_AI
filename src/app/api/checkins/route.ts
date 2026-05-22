import { generateCheckinDrafts } from "@/lib/checkins";
import { errorJson } from "@/lib/http";
import {
  addCheckins,
  getAdvisor,
  getAdvisorBrain,
  listCheckins,
  shouldGenerateCheckins,
} from "@/lib/store";
import type { CheckinsResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const advisorId = searchParams.get("advisorId");
  if (!advisorId) return errorJson("bad_request", "advisorId is required");
  const advisor = await getAdvisor(advisorId);
  const brain = await getAdvisorBrain(advisorId);
  if (!advisor || !brain) return errorJson("not_found", "Advisor not found", 404);
  if (await shouldGenerateCheckins(advisorId)) {
    await addCheckins(advisorId, await generateCheckinDrafts(advisor, brain));
  }
  const body: CheckinsResponse = { checkins: await listCheckins(advisorId) };
  return Response.json(body);
}
