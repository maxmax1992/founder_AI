import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { getAdvisor, getAdvisorBrain, updateAdvisorBrain } from "@/lib/store";
import { UpdateBrainBodySchema } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const advisor = await getAdvisor(id);
  const brain = await getAdvisorBrain(id);
  if (!advisor || !brain) return errorJson("not_found", "Advisor not found", 404);
  return Response.json({ advisor, brain });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = UpdateBrainBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const currentBrain = await getAdvisorBrain(id);
  const brain = await updateAdvisorBrain(id, {
    ...parsed.data,
    schema: parsed.data.schema ?? currentBrain?.schema ?? "",
    wikiPages: parsed.data.wikiPages.map((page) => ({
      ...page,
      updatedAt: page.updatedAt ?? Date.now(),
    })),
    skills: parsed.data.skills.map((page) => ({
      ...page,
      updatedAt: page.updatedAt ?? Date.now(),
    })),
  });
  const advisor = await getAdvisor(id);
  if (!advisor || !brain) return errorJson("not_found", "Advisor not found", 404);
  return Response.json({ advisor, brain });
}
