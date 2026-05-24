export interface GraphifyGraphNode {
  id: string;
  label: string;
  sourceFile: string;
  fileType: string;
  community: number | null;
  isCore: boolean;
  isRoot: boolean;
}

export interface GraphifyGraphLink {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidenceScore: number | null;
  sourceFile: string;
}

export interface NormalizedGraphifyGraph {
  nodes: GraphifyGraphNode[];
  links: GraphifyGraphLink[];
  communities: number;
  coreNodeCount: number;
}

export interface NormalizeGraphifyOptions {
  advisorId?: string;
  advisorName?: string;
}

interface RawGraphifyNode {
  id?: unknown;
  label?: unknown;
  source_file?: unknown;
  file_type?: unknown;
  community?: unknown;
}

interface RawGraphifyLink {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
  confidence?: unknown;
  confidence_score?: unknown;
  source_file?: unknown;
}

export function normalizeGraphifyGraph(
  raw: unknown,
  options: NormalizeGraphifyOptions = {},
): NormalizedGraphifyGraph {
  const record = isRecord(raw) ? raw : {};
  const rawNodes = Array.isArray(record.nodes) ? (record.nodes as RawGraphifyNode[]) : [];
  const rawLinks = Array.isArray(record.links)
    ? (record.links as RawGraphifyLink[])
    : Array.isArray(record.edges)
      ? (record.edges as RawGraphifyLink[])
      : [];

  const nodes = rawNodes
    .map((node) => normalizeNode(node, options))
    .filter((node): node is GraphifyGraphNode => Boolean(node))
    .filter((node) => !isGraphMdSource(node.sourceFile))
    .filter((node) => belongsToAdvisor(node.sourceFile, options.advisorId));
  const root = advisorRootNode(options);
  const visibleNodes = root ? [root, ...nodes] : nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));

  const links = rawLinks
    .map(normalizeLink)
    .filter((link): link is GraphifyGraphLink => Boolean(link))
    .filter((link) => !isGraphMdSource(link.sourceFile))
    .filter((link) => belongsToAdvisor(link.sourceFile, options.advisorId))
    .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
  const visibleLinks = root ? [...advisorRootLinks(root, nodes), ...links] : links;

  const communityIds = new Set(
    nodes
      .map((node) => node.community)
      .filter((community): community is number => typeof community === "number"),
  );

  return {
    nodes: visibleNodes,
    links: visibleLinks,
    communities: communityIds.size,
    coreNodeCount: nodes.filter((node) => node.isCore).length,
  };
}

export function graphifySourceLabel(sourceFile: string) {
  return sourceFile.replace(/^\.graphify-corpus\//, "").replace(/^data\//, "");
}

function normalizeNode(node: RawGraphifyNode, options: NormalizeGraphifyOptions) {
  const id = stringValue(node.id);
  if (!id) return null;
  const sourceFile = graphifySourceLabel(stringValue(node.source_file));
  return {
    id,
    label: labelForSource(sourceFile, stringValue(node.label) || id, options.advisorId),
    sourceFile,
    fileType: stringValue(node.file_type) || "document",
    community: numberValue(node.community),
    isCore: isCoreSource(sourceFile),
    isRoot: false,
  };
}

function normalizeLink(link: RawGraphifyLink) {
  const source = linkEndpointId(link.source);
  const target = linkEndpointId(link.target);
  if (!source || !target) return null;
  return {
    source,
    target,
    relation: stringValue(link.relation) || "related",
    confidence: stringValue(link.confidence) || "UNKNOWN",
    confidenceScore: numberValue(link.confidence_score),
    sourceFile: graphifySourceLabel(stringValue(link.source_file)),
  };
}

function linkEndpointId(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isRecord(value)) return stringValue(value.id);
  return "";
}

function isCoreSource(sourceFile: string) {
  return /(^|\/)(profile|vision|direction|memory)\.md$/.test(sourceFile);
}

function isGraphMdSource(sourceFile: string) {
  return /(^|\/)graph\.md$/.test(sourceFile);
}

function belongsToAdvisor(sourceFile: string, advisorId?: string) {
  if (!advisorId) return true;
  return sourceFile.startsWith(`advisors/${advisorId}/`);
}

function advisorRootNode(options: NormalizeGraphifyOptions): GraphifyGraphNode | null {
  if (!options.advisorId) return null;
  return {
    id: advisorRootId(options.advisorId),
    label: options.advisorName || titleFromSlug(options.advisorId),
    sourceFile: `advisors/${options.advisorId}`,
    fileType: "advisor",
    community: null,
    isCore: true,
    isRoot: true,
  };
}

function advisorRootLinks(root: GraphifyGraphNode, nodes: GraphifyGraphNode[]) {
  return nodes
    .slice()
    .sort((a, b) => sourcePriority(a.sourceFile) - sourcePriority(b.sourceFile))
    .map(
      (node): GraphifyGraphLink => ({
        source: root.id,
        target: node.id,
        relation: "contains",
        confidence: "APP",
        confidenceScore: 1,
        sourceFile: root.sourceFile,
      }),
    );
}

function advisorRootId(advisorId: string) {
  return `advisor-root:${advisorId}`;
}

function labelForSource(sourceFile: string, fallback: string, advisorId?: string) {
  if (!advisorId || !sourceFile.startsWith(`advisors/${advisorId}/`)) return fallback;
  const localPath = sourceFile.slice(`advisors/${advisorId}/`.length);
  const coreLabels: Record<string, string> = {
    "profile.md": "Profile",
    "vision.md": "Vision",
    "direction.md": "Direction",
    "memory.md": "Memory",
    "schema.md": "Schema",
  };
  return coreLabels[localPath] ?? fallback;
}

function sourcePriority(sourceFile: string) {
  const order = ["profile.md", "vision.md", "direction.md", "memory.md", "schema.md"];
  const index = order.findIndex((suffix) => sourceFile.endsWith(`/${suffix}`));
  return index === -1 ? order.length : index;
}

function titleFromSlug(slug: string) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
