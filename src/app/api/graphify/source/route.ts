import { readGraphifySourceDocument } from "@/lib/graphify-config";
import { errorJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sourceFile = new URL(req.url).searchParams.get("path") ?? "";
  const document = await readGraphifySourceDocument(sourceFile);
  if (!document) return errorJson("not_found", "Graphify source document not found", 404);

  return Response.json({
    path: document.sourceFile,
    title: titleFromMarkdown(document.content, document.sourceFile),
    body: document.content,
    badges: badgesForSource(document.sourceFile, document.content),
    extractionNote: extractionNoteForSource(document.content),
  });
}

function titleFromMarkdown(content: string, sourceFile: string) {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (heading) return heading.replace(/^#+\s*/, "").trim() || filenameTitle(sourceFile);
  return filenameTitle(sourceFile);
}

function badgesForSource(sourceFile: string, content: string) {
  const badges = ["graphify", "read-only"];
  const chunkMatch = /(^|\/)chunk-(\d+)\.md$/.exec(sourceFile);
  if (chunkMatch) badges.push(`chunk ${chunkMatch[2]}`);
  const chunkSummary = /^Chunk:\s*(.+)$/im.exec(content);
  if (chunkSummary) badges.push(chunkSummary[1].trim());
  return badges;
}

function extractionNoteForSource(content: string) {
  const originalSource = /^Original source:\s*(.+)$/im.exec(content)?.[1]?.trim();
  return originalSource
    ? `Generated Graphify corpus document from ${originalSource}. Edit the canonical source from Raw sources.`
    : "Generated Graphify corpus document. Edit the canonical source from Raw sources.";
}

function filenameTitle(sourceFile: string) {
  const basename = sourceFile.split("/").pop() ?? sourceFile;
  return basename.replace(/\.[^.]+$/, "");
}
