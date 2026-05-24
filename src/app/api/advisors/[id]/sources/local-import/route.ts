import { promises as fs } from "node:fs";
import path from "node:path";
import { errorJson } from "@/lib/http";
import { compileLlmWikiFromSources } from "@/lib/llm-wiki-workshop";
import {
  buildTextSource,
  type ImportedSource,
  importDocxSource,
  importPdfSource,
} from "@/lib/source-import";
import { createSource, getAdvisor } from "@/lib/store";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getAdvisor(id))) return errorJson("not_found", "Advisor not found", 404);

  const { dirPath } = await req.json();
  if (!dirPath) return errorJson("bad_request", "dirPath is required");

  const fullPath = path.resolve(process.cwd(), dirPath);
  try {
    const stats = await fs.stat(fullPath);
    if (!stats.isDirectory()) return errorJson("bad_request", "Path is not a directory");

    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const importedCount = { success: 0, failed: 0 };

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(fullPath, entry.name);
      const lowerName = entry.name.toLowerCase();

      try {
        let imported: ImportedSource | undefined;
        if (lowerName.endsWith(".pdf")) {
          const buffer = await fs.readFile(filePath);
          const file = new File([buffer], entry.name, { type: "application/pdf" });
          imported = await importPdfSource(file);
        } else if (lowerName.endsWith(".docx")) {
          const buffer = await fs.readFile(filePath);
          const file = new File([buffer], entry.name, {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          imported = await importDocxSource(file);
        } else if (
          lowerName.endsWith(".txt") ||
          lowerName.endsWith(".md") ||
          lowerName.endsWith(".markdown")
        ) {
          const content = await fs.readFile(filePath, "utf8");
          imported = buildTextSource(entry.name.replace(/\.[^.]+$/, ""), content);
        }

        if (imported) {
          await createSource(id, imported);
          importedCount.success++;
        }
      } catch (err) {
        console.error(`Failed to import ${entry.name}:`, err);
        importedCount.failed++;
      }
    }

    await compileLlmWikiFromSources(id);

    return Response.json({
      message: `Import complete. ${importedCount.success} succeeded, ${importedCount.failed} failed.`,
      ...importedCount,
    });
  } catch (err) {
    return errorJson(
      "bad_request",
      err instanceof Error ? err.message : "Failed to access directory",
      400,
    );
  }
}
