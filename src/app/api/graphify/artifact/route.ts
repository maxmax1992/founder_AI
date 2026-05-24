import { readGraphifyArtifact } from "@/lib/graphify-config";
import { errorJson } from "@/lib/http";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  "graph.html": "text/html; charset=utf-8",
  "index.html": "text/html; charset=utf-8",
  "graph.json": "application/json; charset=utf-8",
  "GRAPH_REPORT.md": "text/markdown; charset=utf-8",
};

export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const artifact = await readGraphifyArtifact(file);
  if (!artifact) return errorJson("not_found", "Graphify artifact not found", 404);
  return new Response(artifact.content, {
    headers: {
      "content-type": CONTENT_TYPES[artifact.file] ?? "application/octet-stream",
    },
  });
}
