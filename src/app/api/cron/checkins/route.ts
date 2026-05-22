import { generateCheckinDrafts } from "@/lib/checkins";
import { errorJson } from "@/lib/http";
import { addCheckins, getAdvisor, getAdvisorBrain, listAdvisors } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestedAdvisorId = searchParams.get("advisorId");
  const advisors = requestedAdvisorId
    ? [await getAdvisor(requestedAdvisorId)].filter((advisor) => advisor !== null)
    : await listAdvisors();

  if (requestedAdvisorId && advisors.length === 0) {
    return errorJson("not_found", "Advisor not found", 404);
  }

  const generated = [];
  for (const advisor of advisors) {
    const brain = await getAdvisorBrain(advisor.id);
    if (!brain) continue;
    generated.push(...(await addCheckins(advisor.id, await generateCheckinDrafts(advisor, brain))));
  }

  return Response.json({ generated });
}
