import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { compileLlmWikiFromSources } from "@/lib/llm-wiki-workshop";
import { createSource, getAdvisor, listSources } from "@/lib/store";
import { type ListSourcesResponse, UpsertSourceBodySchema } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getAdvisor(id))) return errorJson("not_found", "Advisor not found", 404);
  const body: ListSourcesResponse = { sources: await listSources(id) };
  return Response.json(body);
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = UpsertSourceBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const source = await createSource(id, parsed.data);
  if (!source) return errorJson("not_found", "Advisor not found", 404);
  await compileLlmWikiFromSources(id);
  return Response.json({ source }, { status: 201 });
}
