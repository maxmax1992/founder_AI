import type { Advisor, AdvisorBrain, AdvisorSource } from "@/lib/types";

const GLOBAL_VISION = `Sprint Buddy helps founders become more honest, decisive, and self-aware during the Aalto Founder Sprint.

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

function buddyContextMap(advisor: Advisor) {
  return `# Context Lookup Map
Use the context below as a local advisor wiki for ${advisor.name}. When answering, look in these places:

1. Active Advisor: use the advisor name and description for identity and scope.
2. Advisor Profile (profile.md): use for advisor voice, background, and perspective.
3. Advisor Vision (vision.md): use for the long-term founder outcome.
4. Advisor Direction (direction.md): use for response rules and coaching constraints.
5. Founder Memory (memory.md): use for founder-specific history and preferences.
6. LLM Wiki Schema (schema.md): use for wiki maintenance rules and source-handling policy.
7. Advisor Wiki (wiki/*.md): prefer these pages for distilled principles, frameworks, and synthesized claims.
8. Advisor Skills (skills/*.md): use these pages for repeatable coaching moves.
9. Raw Source Inventory (sources/*.md): use these primary sources when the user asks for evidence, the wiki is thin, or a synthesized claim needs grounding.

If the user asks where a fact came from, name the layer and the file or source title. If a layer is empty or does not support the answer, say that directly instead of filling the gap.`;
}

export function buddySystemPrompt(advisor: Advisor, brain: AdvisorBrain, sources: AdvisorSource[]) {
  return `${GLOBAL_VISION}

${buddyContextMap(advisor)}

# Active Advisor
${advisor.name}
${advisor.description}

# Advisor Profile
${brain.profile}

# Advisor Vision
${brain.vision}

# Advisor Direction
${brain.direction}

# Founder Memory
${brain.memory}

# LLM Wiki Schema
${brain.schema}

${renderPages("Advisor Wiki", "wiki", brain.wikiPages)}

${renderPages("Advisor Skills", "skills", brain.skills)}

${renderSourceInventory(sources)}

# Response Policy
- If the advisor wiki is thin, say what is missing instead of inventing advisor-specific advice.
- Name the real issue in one concise sentence.
- Reflect relevant founder history when it helps.
- Apply one advisor principle or skill from the wiki when available.
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
  return `You are the user-in-the-loop editor for Sprint Buddy advisor brains.

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

${renderPages("Skills", "skills", brain.skills, 6000)}

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
5. Propose skills.

Important:
- If a source is marked needs_review, ask the user to verify or edit it before treating it as authoritative.
- Do not claim you saved changes.
- Provide copy-ready markdown drafts and tell the user which editor field they should paste or update.`;
}

export function fallbackBuddyAnswer(userText: string, advisor: Advisor, brain: AdvisorBrain) {
  const principle = brain.skills[0]?.title ?? "hard question, then next action";
  return `The real issue seems to be deciding what truth needs to be faced before the next founder move.

I am using ${advisor.name}'s current advisor brain, but live Codex credentials are not configured. Run \`codex login\` for Codex CLI SSO or configure a direct API key.

Advisor lens: ${principle}.

Hard question: what are you avoiding saying out loud because it might force a decision?

Next action: write the one sentence version of the conversation you need to have, then send a message today to schedule it.

Your note: "${userText.slice(0, 180)}"`;
}

export function fallbackWorkshopAnswer(advisor: Advisor) {
  return `Live Codex credentials are not configured. Run \`codex login\` for Codex CLI SSO or configure a direct API key.

For ${advisor.name}, use this editing workflow:

1. Add one source text with a clear title.
2. Write the advisor vision as the long-term founder outcome.
3. Write direction as answer rules.
4. Create one wiki page per framework, story, or principle.
5. Create one skill per repeatable coaching behavior.

Copy-ready starter:

\`\`\`md
# Vision

Help founders become more honest, decisive, and self-aware. Prefer direct conversations and concrete next actions over abstract reassurance.
\`\`\``;
}
