import type { z } from "zod";
import { errorJson, zodError } from "@/lib/http";
import { getAppSettings, updateAppSettings } from "@/lib/store";
import { type SettingsResponse, UpdateSettingsBodySchema } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const body: SettingsResponse = { settings: await getAppSettings() };
  return Response.json(body);
}

export async function PATCH(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("bad_request", "Body must be valid JSON");
  }
  const parsed = UpdateSettingsBodySchema.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const body: SettingsResponse = { settings: await updateAppSettings(parsed.data) };
  return Response.json(body);
}
