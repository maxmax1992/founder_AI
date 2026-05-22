import type { Advisor, AdvisorBrain, AdvisorSource } from "@/lib/types";

const GLOBAL_VISION = `Sprint Buddy helps founders become more honest, decisive, and self-aware during the Aalto Founder Sprint.

It is a private coach first. It must not make the founder feel monitored.
It should help the founder notice avoided truths, frame hard conversations, and choose the next concrete action.`;

function renderPages(label: string, pages: { title: string; content: string }[], charCap = 9000) {
  const text = pages
    .map((page) => `## ${page.title}\n${page.content}`)
    .join("\n\n")
    .slice(0, charCap);
  return `# ${label}\n${text || "No pages yet."}`;
}

export function buddySystemPrompt(advisor: Advisor, brain: AdvisorBrain, sources: AdvisorSource[]) {
  return `${GLOBAL_VISION}

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

${renderPages("Advisor Wiki", brain.wikiPages)}

${renderPages("Advisor Skills", brain.skills)}

# Source Inventory
${
  sources
    .map(
      (source) =>
        `- ${source.title} (${source.kind ?? "text"}, ${source.status ?? "ready"}): ${source.body.slice(0, 360)}`,
    )
    .join("\n") || "No sources yet."
}

# Response Policy
- If the advisor wiki is thin, say what is missing instead of inventing advisor-specific advice.
- Name the real issue in one concise sentence.
- Reflect relevant founder history when it helps.
- Apply one advisor principle or skill from the wiki when available.
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

${renderPages("Wiki Pages", brain.wikiPages, 6000)}

${renderPages("Skills", brain.skills, 6000)}

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
