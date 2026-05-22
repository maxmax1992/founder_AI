import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { updateCheckin } from "@/lib/store";
import { UpdateCheckinBodySchema } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = UpdateCheckinBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const checkin = await updateCheckin(id, parsed.data.status);
  if (!checkin) return errorJson("not_found", "Check-in not found", 404);
  return Response.json({ checkin });
}
