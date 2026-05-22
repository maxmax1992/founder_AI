import type { z } from "zod";
import type { ApiErrorResponse } from "./types";

export function errorJson(code: string, message: string, status = 400, details?: unknown) {
  const body: ApiErrorResponse = { error: { code, message, details } };
  return Response.json(body, { status });
}

export function zodError(error: z.ZodError) {
  return errorJson("bad_request", "Invalid request body", 400, error.issues);
}
