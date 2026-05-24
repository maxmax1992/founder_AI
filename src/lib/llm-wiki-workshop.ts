import { createHash } from "node:crypto";
import { slugify } from "@/lib/slug";
import {
  deleteSource,
  getAdvisor,
  getAdvisorBrain,
  listSources,
  refreshAdvisorGraph,
  updateAdvisorBrain,
} from "@/lib/store";
import type { AdvisorBrain, AdvisorSource, BrainPage } from "@/lib/types";

const COMPILED_WIKI_PAGE_SLUGS = new Set([
  "source-index",
  "founder-operating-principles",
  "compiled-source-signals",
]);

const COMPILED_WIKI_PAGE_PRIORITY = new Map([
  ["founder-operating-principles", 0],
  ["compiled-source-signals", 1],
  ["source-index", 2],
]);

interface UniqueSource {
  source: AdvisorSource;
  duplicateIds: string[];
  fingerprint: string;
}

export interface LlmWikiCompileResult {
  importedSourceCount: number;
  uniqueSourceCount: number;
  duplicateSourceCount: number;
  wikiPages: BrainPage[];
  brain: AdvisorBrain;
}

export interface WorkshopActionResult {
  kind: "compile" | "remove";
  message: string;
  compileResult: LlmWikiCompileResult;
  removedSourceIds?: string[];
}

export async function applyWorkshopCommand(
  advisorId: string,
  userText: string,
): Promise<WorkshopActionResult | null> {
  if (isRemovalRequest(userText)) {
    const target = extractRemovalTarget(userText);
    if (!target) {
      const compileResult = await compileLlmWikiFromSources(advisorId);
      return {
        kind: "remove",
        message:
          'Name the source or source text to remove in quotes, for example: remove source "Customer interview" and update the wiki.',
        compileResult,
        removedSourceIds: [],
      };
    }

    const sources = await listSources(advisorId);
    const matches = sources.filter((source) => sourceMatchesTarget(source, target));
    for (const source of matches) {
      await deleteSource(advisorId, source.id);
    }
    const compileResult = await compileLlmWikiFromSources(advisorId);

    return {
      kind: "remove",
      message:
        matches.length > 0
          ? [
              `Removed ${matches.length} source(s): ${matches.map((source) => source.id).join(", ")}.`,
              renderCompileSummary(compileResult),
            ].join("\n\n")
          : [
              `No source matched "${target}".`,
              "I refreshed the compiled wiki from the remaining source inventory so the wiki still reflects the current corpus.",
              renderCompileSummary(compileResult),
            ].join("\n\n"),
      compileResult,
      removedSourceIds: matches.map((source) => source.id),
    };
  }

  if (!isCompileRequest(userText)) return null;

  const compileResult = await compileLlmWikiFromSources(advisorId);
  return {
    kind: "compile",
    message: renderCompileSummary(compileResult),
    compileResult,
  };
}

export async function compileLlmWikiFromSources(advisorId: string): Promise<LlmWikiCompileResult> {
  const advisor = await getAdvisor(advisorId);
  const brain = await getAdvisorBrain(advisorId);
  if (!advisor || !brain) throw new Error("Advisor not found");

  const sources = await listSources(advisorId);
  const uniqueSources = uniqueSourcesByBody(sources);
  const compiledPages = buildCompiledWikiPages(advisor.name, uniqueSources, sources.length);
  const preservedPages = brain.wikiPages.filter((page) => !COMPILED_WIKI_PAGE_SLUGS.has(page.slug));
  const nextBrain = await updateAdvisorBrain(advisorId, {
    ...brain,
    wikiPages: [...preservedPages, ...compiledPages],
  });
  if (!nextBrain) throw new Error("Failed to update advisor brain");
  const refreshedBrain = await refreshAdvisorGraph(advisorId);

  return {
    importedSourceCount: sources.length,
    uniqueSourceCount: uniqueSources.length,
    duplicateSourceCount: sources.length - uniqueSources.length,
    wikiPages: compiledPages,
    brain: refreshedBrain ?? nextBrain,
  };
}

export function answerQuestionFromCompiledWiki(brain: AdvisorBrain, question: string) {
  const terms = questionTerms(question);
  const pages = brain.wikiPages
    .filter((page) => COMPILED_WIKI_PAGE_SLUGS.has(page.slug))
    .sort((a, b) => compiledWikiPageRank(a.slug) - compiledWikiPageRank(b.slug))
    .map((page) => ({
      title: page.title,
      lines: page.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    }));

  const matches: string[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (line === `# ${page.title}`) continue;
      const normalized = line.toLowerCase();
      if (terms.some((term) => normalized.includes(term))) {
        matches.push(`${page.title}: ${line.replace(/^[-#]\s*/, "")}`);
      }
      if (matches.length >= 5) break;
    }
    if (matches.length >= 5) break;
  }

  return matches.length > 0
    ? matches.join("\n")
    : "No compiled wiki passage supports this answer yet.";
}

function compiledWikiPageRank(slug: string) {
  return COMPILED_WIKI_PAGE_PRIORITY.get(slug) ?? COMPILED_WIKI_PAGE_PRIORITY.size;
}

export function semanticWikiDigest(brain: AdvisorBrain) {
  const semanticText = brain.wikiPages
    .filter(
      (page) =>
        page.slug === "founder-operating-principles" || page.slug === "compiled-source-signals",
    )
    .map((page) => `${page.slug}\n${page.content}`)
    .join("\n\n");
  return createHash("sha256").update(normalizeForFingerprint(semanticText)).digest("hex");
}

function buildCompiledWikiPages(
  advisorName: string,
  uniqueSources: UniqueSource[],
  importedSourceCount: number,
): BrainPage[] {
  const timestamp = Date.now();
  const readySources = uniqueSources.filter(({ source }) => (source.status ?? "ready") === "ready");
  return [
    {
      slug: "source-index",
      title: "Source Index",
      content: buildSourceIndexPage(advisorName, uniqueSources, importedSourceCount),
      updatedAt: timestamp,
    },
    {
      slug: "founder-operating-principles",
      title: "Founder Operating Principles",
      content: buildPrinciplesPage(readySources),
      updatedAt: timestamp,
    },
    {
      slug: "compiled-source-signals",
      title: "Compiled Source Signals",
      content: buildSignalsPage(uniqueSources),
      updatedAt: timestamp,
    },
  ];
}

function buildSourceIndexPage(
  advisorName: string,
  uniqueSources: UniqueSource[],
  importedSourceCount: number,
) {
  const duplicateCount = importedSourceCount - uniqueSources.length;
  const rows = uniqueSources.map(({ source, duplicateIds }) =>
    [
      `- ${source.title} (${source.kind ?? "text"}, sources/${source.id}.md)`,
      source.status ? `  - Status: ${source.status}` : undefined,
      source.sourceUrl ? `  - Original file or URL: ${source.sourceUrl}` : undefined,
      duplicateIds.length > 0
        ? `  - Duplicate imports collapsed: ${duplicateIds.map((id) => `sources/${id}.md`).join(", ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    "# Source Index",
    "",
    `Compiled wiki index for ${advisorName}.`,
    "",
    `Imported sources: ${importedSourceCount}`,
    `Unique source bodies: ${uniqueSources.length}`,
    `Duplicate source bodies collapsed: ${duplicateCount}`,
    "",
    "## Active Sources",
    rows.join("\n") || "No sources imported yet.",
  ].join("\n");
}

function buildPrinciplesPage(uniqueSources: UniqueSource[]) {
  const corpus = uniqueSources.map(({ source }) => source.body).join("\n\n");
  const sections: string[] = [];

  if (/sell before you build|selling is essential/i.test(corpus)) {
    sections.push(
      [
        "## Sell Before You Build",
        "- Selling is essential, and founders can start selling before they have a prototype.",
        "- Coaching implication: pressure-test the customer conversation before over-investing in product work.",
        citeMatchingSource(uniqueSources, /sell before you build|selling is essential/i),
      ].join("\n"),
    );
  }

  if (/product-market fit|PMF/i.test(corpus)) {
    sections.push(
      [
        "## Product-Market Fit Starts With The Exact Problem",
        "- First understand exactly what problem is being solved, then form a testable solution idea.",
        "- The wiki should keep looking for the deep truth behind PMF instead of summarizing surface advice.",
        citeMatchingSource(uniqueSources, /product-market fit|PMF/i),
      ].join("\n"),
    );
  }

  if (/magical thing/i.test(corpus)) {
    sections.push(
      [
        "## The Magical Thing Must Be Durable",
        "- A startup needs a unique realization, technical innovation, business-model move, or other durable edge.",
        "- Coaching implication: ask what is both true and non-obvious about the opportunity.",
        citeMatchingSource(uniqueSources, /magical thing/i),
      ].join("\n"),
    );
  }

  if (/when you pitch to a VC|don'?t argue|arguing back/i.test(corpus)) {
    sections.push(
      [
        "## Turn VC Disagreement Into Learning",
        "- When a VC disagrees, do not argue back. Ask them to explain how they see the business.",
        "- Coaching implication: preserve the constructive room and extract the investor's model.",
        citeMatchingSource(uniqueSources, /when you pitch to a VC|don'?t argue|arguing back/i),
      ].join("\n"),
    );
  }

  if (/attention to detail|meticulousness/i.test(corpus)) {
    sections.push(
      [
        "## Improve Meticulousness With Systems And Complementary Strengths",
        "- Do not pretend every founder can become world-class at detail work, but do improve the habit.",
        "- Use software, AI, reviews, notes, and teammates with complementary strengths.",
        citeMatchingSource(uniqueSources, /attention to detail|meticulousness/i),
      ].join("\n"),
    );
  }

  if (/evidence checkpoints?|checkpoint/i.test(corpus)) {
    sections.push(
      [
        "## Use Evidence Checkpoints",
        "- New source material says founders should set evidence checkpoints and inspect learning on a regular cadence.",
        "- Coaching implication: make the founder name what evidence would change the plan.",
        citeMatchingSource(uniqueSources, /evidence checkpoints?|checkpoint/i),
      ].join("\n"),
    );
  }

  return [
    "# Founder Operating Principles",
    "",
    sections.join("\n\n") ||
      "No durable operating principles have been compiled from the imported sources yet.",
  ].join("\n");
}

function buildSignalsPage(uniqueSources: UniqueSource[]) {
  const sections = uniqueSources.map(({ source }) => {
    const highlights = sourceHighlights(source.body);
    return [
      `## ${source.title}`,
      `Source: sources/${source.id}.md`,
      source.kind ? `Type: ${source.kind}` : undefined,
      `Status: ${source.status ?? "ready"}`,
      source.status === "needs_review"
        ? "Evidence strength: weak until the extracted source text is reviewed."
        : undefined,
      "",
      highlights.map((highlight) => `- ${highlight}`).join("\n") ||
        "- No concise highlights extracted yet.",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  });

  return [
    "# Compiled Source Signals",
    "",
    sections.join("\n\n") || "No sources imported yet.",
  ].join("\n");
}

function uniqueSourcesByBody(sources: AdvisorSource[]): UniqueSource[] {
  const unique = new Map<string, UniqueSource>();
  for (const source of [...sources].sort((a, b) => a.createdAt - b.createdAt)) {
    const fingerprint = fingerprintSource(source);
    const existing = unique.get(fingerprint);
    if (existing) {
      existing.duplicateIds.push(source.id);
      continue;
    }
    unique.set(fingerprint, { source, duplicateIds: [], fingerprint });
  }
  return [...unique.values()];
}

function fingerprintSource(source: AdvisorSource) {
  return createHash("sha256").update(normalizeForFingerprint(source.body)).digest("hex");
}

function normalizeForFingerprint(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/sources\/[a-z0-9-]+\.md/g, "sources/source.md")
    .trim();
}

function citeMatchingSource(uniqueSources: UniqueSource[], pattern: RegExp) {
  const match = uniqueSources.find(({ source }) => pattern.test(source.body));
  if (!match) return "";
  return `- Source: ${match.source.title} (sources/${match.source.id}.md)`;
}

function sourceHighlights(body: string) {
  const sourceText = body
    .replace(/^# .+$/gm, "")
    .replace(/^Source type:.+$/gm, "")
    .replace(/^Source URL\/file:.+$/gm, "")
    .trim();
  const compactSourceText = sourceText.replace(/\s+/g, " ").trim();
  if (compactSourceText.length >= 20 && compactSourceText.length <= 220) {
    return [compactSourceText];
  }

  const notableLines = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(
      (line) =>
        line.length >= 20 &&
        line.length <= 260 &&
        /first tweet|bug bounty|hackerone|security|vulnerability/i.test(line),
    );
  const sentences = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 260);

  const priority = [
    /sell/i,
    /product-market fit|PMF/i,
    /magical/i,
    /VC|argu/i,
    /attention to detail|meticulousness/i,
    /evidence|checkpoint/i,
    /customer/i,
    /tweet|bug bounty|hackerone|security|vulnerability/i,
  ];
  const scored = sentences
    .map((sentence, index) => ({
      sentence,
      score: priority.reduce((sum, pattern) => sum + (pattern.test(sentence) ? 1 : 0), 0),
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return uniqueHighlights([...notableLines, ...scored.map(({ sentence }) => sentence)]).slice(0, 5);
}

function uniqueHighlights(highlights: string[]) {
  const unique = new Set<string>();
  const result: string[] = [];
  for (const highlight of highlights) {
    const normalized = highlight.toLowerCase();
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    result.push(highlight);
  }
  return result;
}

function questionTerms(question: string) {
  const normalized = question.toLowerCase();
  const terms = new Set<string>();
  const stopwords = new Set([
    "about",
    "after",
    "before",
    "concrete",
    "detail",
    "details",
    "does",
    "first",
    "founder",
    "handle",
    "marten",
    "mickos",
    "should",
    "source",
    "sources",
    "what",
    "where",
    "which",
    "wiki",
  ]);
  for (const token of normalized.split(/[^a-z0-9]+/)) {
    if (token.length >= 5 && !stopwords.has(token)) terms.add(token);
  }
  if (/before build|building|prototype/.test(normalized)) terms.add("sell");
  if (/vc|investor|disagree/.test(normalized)) terms.add("argue");
  if (/pmf|product/.test(normalized)) terms.add("product-market");
  if (/magical|unique|edge/.test(normalized)) terms.add("magical");
  if (/attention to detail|meticulous/.test(normalized)) terms.add("meticulousness");
  if (/evidence|checkpoint/.test(normalized)) terms.add("checkpoint");
  if (/tweet/.test(normalized)) terms.add("tweet");
  return [...terms];
}

function isCompileRequest(userText: string) {
  const normalized = userText.toLowerCase();
  return (
    /\b(compile|distill|index|ingest|refresh|update|turn)\b/.test(normalized) &&
    /\b(wiki|llm wiki|source|sources)\b/.test(normalized)
  );
}

function isRemovalRequest(userText: string) {
  const normalized = userText.toLowerCase();
  return (
    /\b(remove|delete|drop|forget)\b/.test(normalized) &&
    /\b(wiki|source|sources)\b/.test(normalized)
  );
}

function extractRemovalTarget(userText: string) {
  const quoted = userText.match(/["'`]([^"'`]+)["'`]/)?.[1]?.trim();
  if (quoted) return quoted;

  const afterSource = userText.match(
    /\b(?:source|sources|information|info)\s+(.+?)(?:\s+from\s+|\s+and\s+|$)/i,
  )?.[1];
  return afterSource?.trim();
}

function sourceMatchesTarget(source: AdvisorSource, target: string) {
  const normalizedTarget = normalizeTarget(target);
  return (
    normalizeTarget(source.id) === normalizedTarget ||
    normalizeTarget(source.title) === normalizedTarget ||
    normalizeTarget(source.sourceUrl ?? "") === normalizedTarget ||
    normalizeTarget(source.body).includes(normalizedTarget)
  );
}

function normalizeTarget(value: string) {
  return slugify(value).toLowerCase();
}

function renderCompileSummary(result: LlmWikiCompileResult) {
  return [
    "Compiled the LLM wiki from the current source inventory.",
    `Imported sources: ${result.importedSourceCount}`,
    `Unique source bodies: ${result.uniqueSourceCount}`,
    `Duplicate source bodies collapsed: ${result.duplicateSourceCount}`,
    `Updated wiki pages: ${result.wikiPages.map((page) => `wiki/${page.slug}.md`).join(", ")}`,
  ].join("\n");
}
