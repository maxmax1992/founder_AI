import { promises as fs } from "node:fs";
import path from "node:path";

import type { SearchHit } from "@/lib/types";

const ROOT = process.cwd();
export const GRAPH_FALLBACK_SKILL_PATH = ".skills/graph_fallback/SKILL.md";
const GRAPH_FALLBACK_DIR = path.join(ROOT, ".skills", "graph_fallback");
const GRAPH_FALLBACK_SKILL_ABSOLUTE_PATH = path.join(ROOT, GRAPH_FALLBACK_SKILL_PATH);

export interface GraphFallbackReference {
  slug: string;
  title: string;
  relativePath: string;
  content: string;
}

export interface GraphFallbackSkill {
  name: string;
  summary: string;
  relativePath: string;
  content: string;
  references: GraphFallbackReference[];
}

export async function loadGraphFallbackSkill(): Promise<GraphFallbackSkill | null> {
  if (!(await exists(GRAPH_FALLBACK_SKILL_ABSOLUTE_PATH))) return null;
  const content = await fs.readFile(GRAPH_FALLBACK_SKILL_ABSOLUTE_PATH, "utf8");
  return {
    name: frontmatterValue(content, "name") ?? "graph_fallback",
    summary: extractSummary(content),
    relativePath: GRAPH_FALLBACK_SKILL_PATH,
    content,
    references: await readReferences(),
  };
}

export function graphFallbackDirectAnswer(userText: string, skill: GraphFallbackSkill | null) {
  if (!skill) return null;
  const normalized = userText.toLowerCase();
  const asksForSkill = /\b(skill|graph fallback|graph_fallback)\b/.test(normalized);
  const asksForFullContents =
    /\b(print|show|display|return)\b/.test(normalized) &&
    /\b(full|all|exact|entire|contents?)\b/.test(normalized);
  if (asksForSkill && asksForFullContents) return skill.content;

  const asksForSummary =
    asksForSkill && /\b(name|summary|summarize|what'?s in|what is in)\b/.test(normalized);
  if (!asksForSummary) return null;

  const refs = skill.references
    .map((reference) => `- ${reference.relativePath}: ${reference.title}`)
    .join("\n");
  return [
    `Skill: ${skill.name}`,
    "",
    `Summary: ${skill.summary}`,
    "",
    "References:",
    refs || "- No references found.",
  ].join("\n");
}

export function fallbackSkillAuditNote(skill: GraphFallbackSkill | null, hits: SearchHit[]) {
  if (!skill) return "Fallback skill unavailable.";
  const usedReferences = new Set(
    hits
      .filter((hit) => hit.source === "fallback_reference" || hit.source === "fallback_skill")
      .map((hit) => hit.slug),
  );
  return `Fallback skill consulted: ${skill.name}; references used: ${
    [...usedReferences].join(", ") || skill.relativePath
  }.`;
}

function extractSummary(content: string) {
  const summaryMatch = content.match(/## Summary\s+([\s\S]*?)(?:\n## |\n# |$)/);
  if (summaryMatch?.[1]) return firstParagraph(summaryMatch[1]);
  return firstParagraph(content.replace(/^---[\s\S]*?---\s*/, ""));
}

function firstParagraph(content: string) {
  return (
    content
      .split(/\n{2,}/)
      .map((part) =>
        part
          .replace(/^#+\s+/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "Mandatory fallback context audit for Founder’s Chat."
  );
}

function frontmatterValue(content: string, key: string) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

async function readReferences() {
  const referencesDir = path.join(GRAPH_FALLBACK_DIR, "references");
  if (!(await exists(referencesDir))) return [];
  const entries = await fs.readdir(referencesDir, { withFileTypes: true });
  const references = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const absolutePath = path.join(referencesDir, entry.name);
        const content = await fs.readFile(absolutePath, "utf8");
        const slug = entry.name.replace(/\.md$/, "");
        return {
          slug,
          title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug.replace(/-/g, " "),
          relativePath: path.relative(ROOT, absolutePath),
          content,
        };
      }),
  );
  return references.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
