import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import {
  getDefaultFounder,
  getFounderBrain,
  refreshFounderGraph,
  updateFounder,
  updateFounderBrain,
} from "@/lib/store";
import { type FounderBrainResponse, UpdateFounderBodySchema } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const founder = await getDefaultFounder();
  const brain = await getFounderBrain(founder.id);
  if (!brain) return errorJson("not_found", "Founder not found", 404);
  const body: FounderBrainResponse = { founder, brain };
  return Response.json(body);
}

export async function PATCH(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }

  const parsed = UpdateFounderBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);

  const currentFounder = await getDefaultFounder();
  const founder =
    parsed.data.name !== undefined
      ? await updateFounder(currentFounder.id, { name: parsed.data.name })
      : currentFounder;
  if (!founder) return errorJson("not_found", "Founder not found", 404);

  const currentBrain = await getFounderBrain(founder.id);
  if (!currentBrain) return errorJson("not_found", "Founder not found", 404);
  const shouldUpdateBrain =
    parsed.data.profile !== undefined ||
    parsed.data.memory !== undefined ||
    parsed.data.graph !== undefined;

  if (shouldUpdateBrain) {
    await updateFounderBrain(founder.id, {
      profile: parsed.data.profile ?? currentBrain.profile,
      memory: parsed.data.memory ?? currentBrain.memory,
      graph: parsed.data.graph ?? currentBrain.graph,
    });
  }

  const refreshedBrain = await refreshFounderGraph(founder.id);
  const body: FounderBrainResponse = {
    founder,
    brain: refreshedBrain ?? (await getFounderBrain(founder.id)) ?? currentBrain,
  };
  return Response.json(body);
}
