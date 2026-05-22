import { errorJson } from "@/lib/http";
import {
  buildTextSource,
  importPdfSource,
  importWebsiteSource,
  importYoutubeSource,
} from "@/lib/source-import";
import { createSource, getAdvisor } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getAdvisor(id))) return errorJson("not_found", "Advisor not found", 404);

  const formData = await req.formData();
  const kind = String(formData.get("kind") ?? "text");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const file = formData.get("file");

  try {
    const imported =
      kind === "website"
        ? await importWebsiteSource(requireUrl(url), title)
        : kind === "youtube"
          ? await importYoutubeSource(requireUrl(url), title)
          : kind === "pdf"
            ? await importPdfSource(requireFile(file), title)
            : buildTextSource(title, body);

    if (!imported.body.trim()) {
      return errorJson("bad_request", "Source content is empty");
    }

    const source = await createSource(id, imported);
    return Response.json({ source }, { status: 201 });
  } catch (err) {
    return errorJson(
      "bad_request",
      err instanceof Error ? err.message : "Failed to import source",
      400,
    );
  }
}

function requireUrl(url: string) {
  if (!url) throw new Error("URL is required for this source type");
  try {
    return new URL(url).toString();
  } catch {
    throw new Error("URL must be valid");
  }
}

function requireFile(file: FormDataEntryValue | null) {
  if (!(file instanceof File)) throw new Error("PDF file is required");
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Only PDF files are supported for PDF source import");
  }
  return file;
}
