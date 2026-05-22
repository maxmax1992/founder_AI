import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { createAdvisor, listAdvisors } from "@/lib/store";
import { CreateAdvisorBodySchema, type ListAdvisorsResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const body: ListAdvisorsResponse = { advisors: await listAdvisors() };
  return Response.json(body);
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = CreateAdvisorBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const advisor = await createAdvisor(parsed.data);
  return Response.json({ advisor }, { status: 201 });
}
