import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { deleteAdvisor, getAdvisor, updateAdvisor } from "@/lib/store";
import { UpdateAdvisorBodySchema } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const advisor = await getAdvisor(id);
  if (!advisor) return errorJson("not_found", "Advisor not found", 404);
  return Response.json({ advisor });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = UpdateAdvisorBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const advisor = await updateAdvisor(id, parsed.data);
  if (!advisor) return errorJson("not_found", "Advisor not found", 404);
  return Response.json({ advisor });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await deleteAdvisor(id);
  if (!deleted) return errorJson("not_found", "Advisor not found", 404);
  return Response.json({ ok: true });
}
