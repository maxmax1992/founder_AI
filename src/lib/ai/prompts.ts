import type { BuddyAnswerContext } from "@/lib/buddy-context";
import { fallbackSkillAuditNote } from "@/lib/graph-fallback-skill";
import type { Advisor, AdvisorBrain, AdvisorSource, SearchHit } from "@/lib/types";

const GLOBAL_VISION = `Founder's harness helps founders become more honest, decisive, and self-aware during the Aalto Founder Sprint.

It is a private coach first. It must not make the founder feel monitored.
It should help the founder notice avoided truths, frame hard conversations, and choose the next concrete action.`;

function pageLocation(page: { slug?: string }, folder: string) {
  return page.slug ? ` (${folder}/${page.slug}.md)` : "";
}

function renderPages(
  label: string,
  folder: string,
  pages: { slug?: string; title: string; content: string }[],
  charCap = 9000,
) {
  const text = pages
    .map((page) => `## ${page.title}${pageLocation(page, folder)}\n${page.content}`)
    .join("\n\n")
    .slice(0, charCap);
  return `# ${label}\n${text || "No pages yet."}`;
}

function renderSourceInventory(sources: AdvisorSource[], charCap = 9000) {
  if (sources.length === 0) return "# Raw Source Inventory\nNo sources yet.";

  const text = sources
    .map((source) =>
      [
        `## ${source.title} (sources/${source.id}.md)`,
        `Type: ${source.kind ?? "text"}`,
        `Status: ${source.status ?? "ready"}`,
        source.sourceUrl ? `URL: ${source.sourceUrl}` : "",
        source.extractionNote ? `Extraction note: ${source.extractionNote}` : "",
        "",
        source.body,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
    .slice(0, charCap);

  return `# Raw Source Inventory\n${text}`;
}

function renderSearchHits(label: string, hits: SearchHit[]) {
  if (hits.length === 0) return `# ${label}\nNo direct retrieval hits for the latest question.`;
  const text = hits
    .map((hit) =>
      [
        `- [${hit.scope}:${hit.source}:${hit.slug}; ${hit.retrieval ?? "text"} retrieval] ${hit.title}: ${hit.excerpt || "No excerpt."}`,
        ...(hit.relationships ?? []).map((row) => `  - graphify: ${row}`),
      ].join("\n"),
    )
    .join("\n");
  return `# ${label}\n${text}`;
}

function buddyContextMap(advisor: Advisor, founderName: string) {
  return `# Context Lookup Map
Use the context below as two disconnected but queryable graphs.

Advisor context graph: ${advisor.name}'s stable advisor essence.
Founder graph: ${founderName}'s private conversation history and founder-owned context.

1. Active Advisor: use the advisor name and description for identity and scope.
2. Advisor Profile (profile.md): use for advisor voice, background, and perspective.
3. Advisor Vision (vision.md): use for the long-term founder outcome.
4. Advisor Direction (direction.md): use for response rules and coaching constraints.
5. LLM Wiki Schema (schema.md): use for wiki maintenance rules and source-handling policy.
6. Advisor Wiki (wiki/*.md): prefer these pages for distilled principles, frameworks, and synthesized claims.
7. Raw Source Inventory (sources/*.md): use these primary sources when the user asks for evidence, the wiki is thin, or a synthesized claim needs grounding.
8. Graphify output: use graphify-out/graph.json as the relationship graph. Do not treat graph.md as a Graphify substitute.
9. Graph Fallback Skill: when Graphify is disabled or unavailable, treat .skills/graph_fallback/SKILL.md as context-audit routing for answers, not as the graph viewer.
10. Founder Profile and Memory: use only for ${founderName}'s private context, patterns, decisions, and history.
11. Founder Graph (graph.md): use for founder-owned context relationships.

If the user asks where a fact came from, name the scope and layer, for example advisor/wiki or founder/memory. If a layer is empty or does not support the answer, say that directly instead of filling the gap.`;
}

function renderFallbackSkill(context: BuddyAnswerContext) {
  const skill = context.graphFallbackSkill;
  if (context.graphifyEnabled) {
    return "# Graphify Mode\nGraphify is enabled. Prefer graphify-out relationship context when available.";
  }
  if (!skill) {
    return "# Graph Fallback Skill\nGraph fallback is active, but .skills/graph_fallback/SKILL.md was not found.";
  }
  const refs =
    skill.references
      .map((reference) => `## ${reference.relativePath}\n${reference.content}`)
      .join("\n\n") || "No fallback references found.";
  return `# Graph Fallback Skill
Graph fallback is active because Graphify is disabled or graphify-out is unavailable. You must audit this skill before every substantive answer.

## Entrypoint: ${skill.relativePath}
${skill.content}

# Graph Fallback References
${refs}`;
}

export function buddySystemPrompt(context: BuddyAnswerContext) {
  const { advisor, advisorBrain: brain, advisorSources: sources, founder, founderBrain } = context;
  return `${GLOBAL_VISION}

${buddyContextMap(advisor, founder.name)}

# Active Advisor
Advisor: ${advisor.name}
${advisor.description}

# Active Founder
Founder: ${founder.name}

# Advisor Profile
${brain.profile}

# Advisor Vision
${brain.vision}

# Advisor Direction
${brain.direction}

# Advisor Memory
${brain.memory}

# LLM Wiki Schema
${brain.schema}

${renderPages("Advisor Wiki", "wiki", brain.wikiPages)}

${renderSourceInventory(sources)}

${renderFallbackSkill(context)}

# Founder Profile
${founderBrain.profile}

# Founder Memory
${founderBrain.memory}

# Founder Graph
${founderBrain.graph}

${renderSearchHits("Relevant Advisor Retrieval", context.advisorHits)}

${renderSearchHits("Relevant Founder Retrieval", context.founderHits)}

# Response Policy
- If the advisor wiki is thin, say what is missing instead of inventing advisor-specific advice.
- Use the queryGraphify tool before generic text search when the question asks about relationships, graph nodes, source navigation, or how context connects.
- If graph fallback is active, use the Graph Fallback Skill audit before answering and include a concise fallback audit note.
- Keep advisor essence and founder context separate: do not attribute founder history to the advisor.
- Name the real issue in one concise sentence.
- Reflect relevant founder history when it helps.
- Apply one advisor principle from the wiki when available.
- Prefer distilled wiki pages for synthesis, and use raw sources for grounding or conflict checks.
- Ask one uncomfortable but useful question.
- End with one concrete next action the founder can take within 24 hours.
- Keep the answer compact unless the founder asks for depth.`;
}

export function workshopSystemPrompt(
  advisor: Advisor,
  brain: AdvisorBrain,
  sources: AdvisorSource[],
) {
  return `You are the user-in-the-loop editor for Founder's harness advisor brains.

The user is building the advisor named ${advisor.name}. Help them maintain a local LLM-wiki, not a black-box upload.

# Current Advisor Brain

## Profile
${brain.profile}

## Vision
${brain.vision}

## Direction
${brain.direction}

## LLM Wiki Schema
${brain.schema}

${renderPages("Wiki Pages", "wiki", brain.wikiPages, 6000)}

# Sources
${
  sources
    .map(
      (source) =>
        `## ${source.title}\nType: ${source.kind ?? "text"}\nStatus: ${source.status ?? "ready"}${source.sourceUrl ? `\nSource: ${source.sourceUrl}` : ""}${source.extractionNote ? `\nExtraction note: ${source.extractionNote}` : ""}\n\n${source.body}`,
    )
    .join("\n\n") || "No sources yet."
}

# Workflow
Guide the user through:
1. Add, inspect, or clarify text, website, YouTube, or PDF sources.
2. Draft or refine vision.
3. Draft or refine advisor direction.
4. Propose wiki pages.
5. Propose fallback references for .skills/graph_fallback/references when Graphify is disabled.

Important:
- If a source is marked needs_review, ask the user to verify or edit it before treating it as authoritative.
- Do not claim you saved changes.
- Provide copy-ready markdown drafts and tell the user which editor field they should paste or update.`;
}

export function fallbackBuddyAnswer(userText: string, context: BuddyAnswerContext) {
  const { advisor, advisorBrain: brain, founder, founderBrain } = context;
  const advisorLens =
    firstLine(brain.direction) || firstLine(brain.vision) || "hard question, then next action";
  const audit = context.graphifyEnabled
    ? "Graphify enabled: graphify-out is preferred when available."
    : fallbackSkillAuditNote(context.graphFallbackSkill, context.advisorHits);
  return `The real issue seems to be deciding what truth needs to be faced before the next founder move.

I am using Advisor: ${advisor.name} and Founder: ${founder.name}, but live Codex credentials are not configured. Run \`codex login\` for Codex CLI SSO or configure a direct API key.

Advisor lens: ${advisorLens}.

Founder context: ${firstLine(founderBrain.memory) || firstLine(founderBrain.profile) || "No durable founder memory yet."}

${audit}

Hard question: what are you avoiding saying out loud because it might force a decision?

Next action: write the one sentence version of the conversation you need to have, then send a message today to schedule it.

Your note: "${userText.slice(0, 180)}"`;
}

function firstLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
}

export function fallbackWorkshopAnswer(advisor: Advisor) {
  return `Live Codex credentials are not configured. Run \`codex login\` for Codex CLI SSO or configure a direct API key.

For ${advisor.name}, use this editing workflow:

1. Add one source text with a clear title.
2. Write the advisor vision as the long-term founder outcome.
3. Write direction as answer rules.
4. Create one wiki page per framework, story, or principle.
5. Add fallback-reference notes under .skills/graph_fallback/references when Graphify is disabled.

Copy-ready starter:

\`\`\`md
# Vision

Help founders become more honest, decisive, and self-aware. Prefer direct conversations and concrete next actions over abstract reassurance.
\`\`\``;
}
