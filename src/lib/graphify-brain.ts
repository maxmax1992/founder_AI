import type { Advisor, AdvisorBrain, AdvisorSource, BrainPage } from "@/lib/types";
import { getAdvisor, getAdvisorBrain, listSources, updateAdvisorBrain } from "./store";

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function excerpt(value: string, max = 180) {
  const clean = cleanLine(value);
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function sourceLine(source: AdvisorSource) {
  const status = source.status ?? "ready";
  const kind = source.kind ?? "text";
  const note = source.extractionNote ? `; note: ${excerpt(source.extractionNote, 120)}` : "";
  return `- [source:${source.id}] ${source.title} (${kind}, ${status})${source.sourceUrl ? ` from ${source.sourceUrl}` : ""}${note}`;
}

function pageLine(prefix: "wiki" | "skill", page: BrainPage) {
  return `- [${prefix}:${page.slug}] ${page.title}: ${excerpt(page.content)}`;
}

function relationshipLines(sources: AdvisorSource[], brain: AdvisorBrain) {
  const lines = [
    "- profile -> grounds -> advisor responses",
    "- vision -> sets_outcome -> advisor responses",
    "- direction -> constrains_style -> advisor responses",
    "- founder-memory -> personalizes -> advisor responses",
    "- graphify-brain -> maps -> advisor wiki and source corpus",
  ];

  for (const source of sources.slice(0, 12)) {
    lines.push(`- source:${source.id} -> can_support -> advisor-wiki`);
  }
  for (const page of brain.wikiPages.slice(0, 12)) {
    lines.push(`- wiki:${page.slug} -> informs -> buddy-chat`);
  }
  for (const page of brain.skills.slice(0, 12)) {
    lines.push(`- skill:${page.slug} -> shapes -> response-behavior`);
  }
  return lines;
}

export function buildGraphifyBrainMarkdown(
  advisor: Advisor,
  brain: AdvisorBrain,
  sources: AdvisorSource[],
) {
  const readySources = sources.filter((source) => (source.status ?? "ready") === "ready").length;
  const reviewSources = sources.filter((source) => source.status === "needs_review").length;
  const refreshedAt = new Date().toISOString();

  return [
    "# Graphify Brain",
    "",
    `Advisor: ${advisor.name}`,
    `Refreshed: ${refreshedAt}`,
    "",
    "## Role In The LLM Wiki",
    "",
    "Graphify Brain is the machine-readable map for this advisor. It is the place to inspect the shape of the advisor corpus before turning it into founder-facing wiki pages, skills, and coaching responses.",
    "",
    "- Sources are the raw evidence layer.",
    "- Graphify Brain is the map of entities and relationships.",
    "- Advisor Wiki is the curated human-readable synthesis.",
    "- Buddy Chat should cite the wiki/skills when possible and admit gaps when this graph is thin.",
    "",
    "## Corpus Snapshot",
    "",
    `- Sources: ${sources.length} total, ${readySources} ready, ${reviewSources} need review.`,
    `- Wiki pages: ${brain.wikiPages.length}.`,
    `- Advisor skills: ${brain.skills.length}.`,
    "- Source registry command: `python3 tools/wiki_sources.py list`.",
    "- Project graph refresh command: `graphify sources/active --update --wiki --obsidian --obsidian-dir wiki`.",
    "",
    "## Source Nodes",
    "",
    sources.length > 0 ? sources.map(sourceLine).join("\n") : "- No advisor sources captured yet.",
    "",
    "## Wiki Nodes",
    "",
    brain.wikiPages.length > 0
      ? brain.wikiPages.map((page) => pageLine("wiki", page)).join("\n")
      : "- No advisor wiki pages yet.",
    "",
    "## Skill Nodes",
    "",
    brain.skills.length > 0
      ? brain.skills.map((page) => pageLine("skill", page)).join("\n")
      : "- No advisor skills yet.",
    "",
    "## Core Relationships",
    "",
    relationshipLines(sources, brain).join("\n"),
    "",
    "## Curation Rules",
    "",
    "- Treat `needs_review` sources as weak evidence until a human checks the extracted text.",
    "- Use graph nodes to decide what wiki pages or skills are missing.",
    "- Flag contradictions in wiki pages instead of overwriting them silently.",
    "- Refresh this page after source imports, wiki edits, or agentic editor updates.",
  ].join("\n");
}

export async function refreshAdvisorGraphifyBrain(advisorId: string) {
  const advisor = await getAdvisor(advisorId);
  const brain = await getAdvisorBrain(advisorId);
  if (!advisor || !brain) return null;
  const sources = await listSources(advisorId);
  const graph = buildGraphifyBrainMarkdown(advisor, brain, sources);
  const updated = await updateAdvisorBrain(advisorId, { ...brain, graph });
  return updated ? { advisor, brain: updated, graph, sources } : null;
}
