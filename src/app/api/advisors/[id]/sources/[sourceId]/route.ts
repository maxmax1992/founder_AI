import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { compileLlmWikiFromSources } from "@/lib/llm-wiki-workshop";
import { deleteSource, updateSource } from "@/lib/store";
import { UpsertSourceBodySchema } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string; sourceId: string }>;
}

export async function PATCH(req: Request, { params }: Params) {
  const { id, sourceId } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = UpsertSourceBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const source = await updateSource(id, sourceId, parsed.data);
  if (!source) return errorJson("not_found", "Source not found", 404);
  await compileLlmWikiFromSources(id);
  return Response.json({ source });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, sourceId } = await params;
  const deleted = await deleteSource(id, sourceId);
  if (!deleted) return errorJson("not_found", "Source not found", 404);
  await compileLlmWikiFromSources(id);
  return Response.json({ ok: true });
}
