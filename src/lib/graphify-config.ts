import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GRAPHIFY_OUT_DIR = path.join(ROOT, "graphify-out");
const HTML_CANDIDATES = ["GRAPH_TREE.html", "graph.html", "index.html"];

export interface GraphifyRuntimeStatus {
  enabled: boolean;
  forcedDisabled: boolean;
  graphifyOutDir: string;
  hasGraphifyOut: boolean;
  hasHtml: boolean;
  htmlFile: string | null;
  hasGraphJson: boolean;
  hasReport: boolean;
}

export interface GraphifyRetrievalDocument {
  slug: string;
  title: string;
  content: string;
}

export function isGraphifyEnabled() {
  return process.env.USE_GRAPHIFY?.trim().toLowerCase() !== "false";
}

export function hasUsableGraphifyArtifacts(status: GraphifyRuntimeStatus) {
  return status.enabled && status.hasGraphifyOut && (status.hasHtml || status.hasGraphJson);
}

export async function shouldUseGraphFallback() {
  return !hasUsableGraphifyArtifacts(await getGraphifyRuntimeStatus());
}

export async function getGraphifyRuntimeStatus(): Promise<GraphifyRuntimeStatus> {
  const enabled = isGraphifyEnabled();
  const hasGraphifyOut = await exists(GRAPHIFY_OUT_DIR);
  const htmlFile = await firstExisting(
    HTML_CANDIDATES.map((file) => path.join(GRAPHIFY_OUT_DIR, file)),
  );
  return {
    enabled,
    forcedDisabled: !enabled,
    graphifyOutDir: GRAPHIFY_OUT_DIR,
    hasGraphifyOut,
    hasHtml: Boolean(htmlFile),
    htmlFile: htmlFile ? path.basename(htmlFile) : null,
    hasGraphJson: await exists(path.join(GRAPHIFY_OUT_DIR, "graph.json")),
    hasReport: await exists(path.join(GRAPHIFY_OUT_DIR, "GRAPH_REPORT.md")),
  };
}

export async function readGraphifyArtifact(file: string) {
  const allowed = new Set([
    "GRAPH_TREE.html",
    "graph.html",
    "index.html",
    "graph.json",
    "GRAPH_REPORT.md",
  ]);
  if (!allowed.has(file)) return null;
  const artifactPath = path.join(GRAPHIFY_OUT_DIR, file);
  if (!(await exists(artifactPath))) return null;
  return {
    file,
    path: artifactPath,
    content: await fs.readFile(artifactPath),
  };
}

export async function readGraphifyRetrievalDocuments(): Promise<GraphifyRetrievalDocument[]> {
  const status = await getGraphifyRuntimeStatus();
  if (!hasUsableGraphifyArtifacts(status)) return [];

  const files = [
    ["GRAPH_REPORT.md", "Graphify Report"],
    ["graph.json", "Graphify Graph JSON"],
    [status.htmlFile, "Graphify HTML Graph"],
  ] as const;
  const documents: GraphifyRetrievalDocument[] = [];
  for (const [file, title] of files) {
    if (!file) continue;
    const artifact = await readGraphifyArtifact(file);
    if (!artifact) continue;
    documents.push({
      slug: file
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase(),
      title,
      content: artifact.content.toString("utf8").slice(0, 40_000),
    });
  }
  return documents;
}

async function firstExisting(paths: string[]) {
  for (const candidate of paths) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
