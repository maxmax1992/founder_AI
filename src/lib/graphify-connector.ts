import { readGraphifyArtifact } from "@/lib/graphify-config";
import {
  type GraphifyGraphLink,
  type GraphifyGraphNode,
  normalizeGraphifyGraph,
} from "@/lib/graphify-graph";

interface RankedNode extends GraphifyGraphNode {
  degree: number;
  score: number;
}

export interface QueryGraphifyConnectorOptions {
  advisorId?: string;
  advisorName?: string;
}

const STOPWORDS = new Set([
  "about",
  "after",
  "before",
  "context",
  "does",
  "founder",
  "graph",
  "into",
  "that",
  "the",
  "what",
  "where",
  "which",
  "with",
]);

export async function queryGraphifyConnector(
  query: string,
  budget = 1200,
  options: QueryGraphifyConnectorOptions = {},
) {
  const artifact = await readGraphifyArtifact("graph.json");
  if (!artifact) {
    return {
      available: false,
      reason: "graphify-out/graph.json is missing. Run python3 tools/graphify_refresh.py.",
    };
  }

  const graph = normalizeGraphifyGraph(JSON.parse(artifact.content.toString("utf8")), options);
  if (graph.nodes.length === 0) {
    return {
      available: false,
      reason: options.advisorId
        ? `graphify-out/graph.json exists, but no Graphify nodes were found for advisor ${options.advisorId}.`
        : "graphify-out/graph.json exists, but no non-graph.md Graphify nodes were found.",
    };
  }

  const tokens = queryTokens(query);
  const degree = nodeDegrees(graph.links);
  const ranked = graph.nodes
    .map((node): RankedNode => {
      const haystack = `${node.label}\n${node.sourceFile}\n${node.fileType}`.toLowerCase();
      const textScore = tokens.reduce(
        (score, token) => score + (haystack.includes(token) ? 2 : 0),
        0,
      );
      return {
        ...node,
        degree: degree.get(node.id) ?? 0,
        score: textScore + (node.isCore ? 0.5 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || b.degree - a.degree);

  const seeds = ranked.filter((node) => node.score > 0).slice(0, 5);
  const selected = expandNeighborhood(seeds.length ? seeds : ranked.slice(0, 5), graph.links);
  const selectedNodes = graph.nodes
    .filter((node) => selected.nodeIds.has(node.id))
    .sort((a, b) => Number(b.isCore) - Number(a.isCore) || a.label.localeCompare(b.label));
  const selectedLinks = graph.links.filter((link) => selected.linkIds.has(linkId(link)));

  return {
    available: true,
    source: "graphify-out/graph.json",
    query,
    summary: `Graphify connector returned ${selectedNodes.length} nodes and ${selectedLinks.length} relationships from the current graph.`,
    nodes: selectedNodes.slice(0, Math.max(3, Math.floor(budget / 100))).map((node) => ({
      id: node.id,
      label: node.label,
      sourceFile: node.sourceFile,
      community: node.community,
      core: node.isCore,
    })),
    relationships: selectedLinks.slice(0, Math.max(5, Math.floor(budget / 80))).map((link) => ({
      source: link.source,
      relation: link.relation,
      target: link.target,
      confidence: link.confidence,
      sourceFile: link.sourceFile,
    })),
  };
}

function queryTokens(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function nodeDegrees(links: GraphifyGraphLink[]) {
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  return degree;
}

function expandNeighborhood(seeds: GraphifyGraphNode[], links: GraphifyGraphLink[]) {
  const nodeIds = new Set(seeds.map((node) => node.id));
  const linkIds = new Set<string>();
  for (const link of links) {
    if (!nodeIds.has(link.source) && !nodeIds.has(link.target)) continue;
    nodeIds.add(link.source);
    nodeIds.add(link.target);
    linkIds.add(linkId(link));
  }
  return { nodeIds, linkIds };
}

function linkId(link: GraphifyGraphLink) {
  return `${link.source}->${link.relation}->${link.target}`;
}
