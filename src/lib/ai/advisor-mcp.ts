import {
  createLocalMcpServer,
  type LocalMcpServer,
  type LocalTool,
  tool as localMcpTool,
} from "ai-sdk-provider-codex-cli";
import { z } from "zod";

import { refreshAdvisorGraphifyBrain } from "@/lib/graphify-brain";
import { slugify } from "@/lib/slug";
import {
  getAdvisor,
  getAdvisorBrain,
  listSources,
  readAdvisorPage,
  searchAdvisorBrain,
  updateAdvisor,
  updateAdvisorBrain,
} from "@/lib/store";
import type { AdvisorBrain, BrainPage } from "@/lib/types";

const sectionSchema = z.enum(["profile", "vision", "direction", "memory", "graph"]);
const pageKindSchema = z.enum(["wiki", "skill"]);

async function loadAdvisorContext(advisorId: string) {
  const advisor = await getAdvisor(advisorId);
  const brain = await getAdvisorBrain(advisorId);
  if (!advisor || !brain) throw new Error("Advisor not found.");
  const sources = await listSources(advisorId);
  return { advisor, brain, sources };
}

function replacePage(pages: BrainPage[], page: BrainPage) {
  const slug = slugify(page.slug || page.title);
  const normalized = { ...page, slug, updatedAt: Date.now() };
  const existing = pages.findIndex((item) => item.slug === slug);
  if (existing === -1) return [...pages, normalized];
  return pages.map((item, index) => (index === existing ? normalized : item));
}

function patchBrainSection(
  brain: AdvisorBrain,
  section: z.infer<typeof sectionSchema>,
  content: string,
) {
  return { ...brain, [section]: content };
}

const globalMcpCache = globalThis as typeof globalThis & {
  __sprintBuddyAdvisorMcpServers?: Map<string, LocalMcpServer>;
};

type AdvisorEditorToolDefinition<TParams> = {
  name: string;
  description: string;
  parameters: z.ZodType<TParams>;
  execute: (params: TParams) => Promise<unknown>;
};

type ResolvedAdvisorEditorToolDefinition = AdvisorEditorToolDefinition<unknown>;

function defineAdvisorEditorTool<TParams>(
  definition: AdvisorEditorToolDefinition<TParams>,
): ResolvedAdvisorEditorToolDefinition {
  return definition as unknown as ResolvedAdvisorEditorToolDefinition;
}

function advisorEditorToolDefinitions(advisorId: string): ResolvedAdvisorEditorToolDefinition[] {
  return [
    defineAdvisorEditorTool({
      name: "read_advisor_context",
      description:
        "Read the selected Sprint Buddy advisor context, including profile, vision, direction, memory, graphify brain, wiki pages, skills, and source inventory. Use before deciding what to edit. This tool is scoped to the currently selected advisor only.",
      parameters: z.object({}),
      execute: async () => {
        const { advisor, brain, sources } = await loadAdvisorContext(advisorId);
        return {
          advisor,
          brain,
          sources: sources.map((source) => ({
            id: source.id,
            title: source.title,
            kind: source.kind,
            status: source.status,
            sourceUrl: source.sourceUrl,
            excerpt: source.body.slice(0, 700),
          })),
        };
      },
    }),
    defineAdvisorEditorTool({
      name: "search_advisor_context",
      description:
        "Search the selected advisor brain across profile, vision, direction, memory, graphify brain, wiki, skills, and sources. Use this to find the right page or section before editing it.",
      parameters: z.object({
        query: z.string().min(1).describe("Search terms for the selected advisor context."),
      }),
      execute: async ({ query }) => ({ results: await searchAdvisorBrain(advisorId, query) }),
    }),
    defineAdvisorEditorTool({
      name: "read_advisor_page",
      description:
        "Read one complete selected-advisor page by slug. Known slugs include profile, vision, direction, memory, graph, wiki page slugs, skill slugs, and source ids.",
      parameters: z.object({
        slug: z.string().min(1).describe("The page slug to read."),
      }),
      execute: async ({ slug }) => {
        const page = await readAdvisorPage(advisorId, slug);
        return page ? { found: true, page } : { found: false, slug };
      },
    }),
    defineAdvisorEditorTool({
      name: "update_advisor_metadata",
      description:
        "Update the selected advisor name and/or short description. Use only when the user explicitly asks to rename or describe the advisor. Returns the saved advisor metadata.",
      parameters: z.object({
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(240).optional(),
      }),
      execute: async ({ name, description }) => {
        const advisor = await updateAdvisor(advisorId, { name, description });
        if (!advisor) throw new Error("Advisor not found.");
        return { saved: true, advisor };
      },
    }),
    defineAdvisorEditorTool({
      name: "update_advisor_brain_section",
      description:
        "Replace one selected-advisor brain section and save it to local markdown. Use for profile, vision, direction, founder memory, or graphify brain updates. Do not use for wiki pages or skills.",
      parameters: z.object({
        section: sectionSchema.describe("The brain section to replace."),
        content: z.string().min(1).describe("Complete markdown content for the selected section."),
      }),
      execute: async ({ section, content }) => {
        const { brain } = await loadAdvisorContext(advisorId);
        const updated = await updateAdvisorBrain(
          advisorId,
          patchBrainSection(brain, section, content),
        );
        if (!updated) throw new Error("Advisor not found.");
        return { saved: true, section, brain: updated };
      },
    }),
    defineAdvisorEditorTool({
      name: "upsert_advisor_page",
      description:
        "Create or replace one selected-advisor wiki page or skill page and save it to local markdown. Use wiki pages for sourced concepts and skill pages for repeatable coaching behavior.",
      parameters: z.object({
        kind: pageKindSchema.describe("Whether to update the advisor wiki or advisor skills."),
        slug: z.string().min(1).max(100).describe("Stable page slug, for example hard-question."),
        title: z.string().min(1).max(120).describe("Human-readable page title."),
        content: z.string().min(1).describe("Complete markdown content for the page."),
      }),
      execute: async ({ kind, slug, title, content }) => {
        const { brain } = await loadAdvisorContext(advisorId);
        const page = { slug, title, content, updatedAt: Date.now() };
        const nextBrain =
          kind === "wiki"
            ? { ...brain, wikiPages: replacePage(brain.wikiPages, page) }
            : { ...brain, skills: replacePage(brain.skills, page) };
        const updated = await updateAdvisorBrain(advisorId, nextBrain);
        if (!updated) throw new Error("Advisor not found.");
        return { saved: true, kind, slug: slugify(slug || title), brain: updated };
      },
    }),
    defineAdvisorEditorTool({
      name: "refresh_graphify_brain",
      description:
        "Refresh the selected advisor Graphify Brain from current sources, wiki pages, and skills, then save graph.md. Use after source imports or after changing wiki/skill context.",
      parameters: z.object({}),
      execute: async () => {
        const result = await refreshAdvisorGraphifyBrain(advisorId);
        if (!result) throw new Error("Advisor not found.");
        return { saved: true, graph: result.graph, brain: result.brain };
      },
    }),
  ];
}

function advisorEditorTools(advisorId: string): LocalTool[] {
  return advisorEditorToolDefinitions(advisorId).map((definition) =>
    localMcpTool({
      ...definition,
      execute: definition.execute,
    }),
  );
}

export async function callAdvisorEditorMcpServerTool(
  advisorId: string,
  toolName: string,
  args: unknown,
) {
  const config = await getAdvisorEditorMcpServerConfig(advisorId);
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.bearerToken ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${toolName}-${Date.now()}`,
      method: "tools/call",
      params: { name: toolName, arguments: args ?? {} },
    }),
  });
  if (!response.ok) throw new Error(`Local advisor MCP call failed: HTTP ${response.status}`);

  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: { content?: Array<{ type: string; text?: string }> };
  };
  if (payload.error) throw new Error(payload.error.message ?? "Local advisor MCP call failed.");
  const text = payload.result?.content?.find((item) => item.type === "text")?.text ?? "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function localToolName(toolName: string) {
  return toolName.startsWith("mcp__") ? (toolName.split("__").at(-1) ?? toolName) : toolName;
}

export async function executeAdvisorEditorMcpTool(
  advisorId: string,
  toolName: string,
  args: unknown,
) {
  const name = localToolName(toolName);
  const selectedTool = advisorEditorToolDefinitions(advisorId).find((item) => item.name === name);
  if (!selectedTool) throw new Error(`Unknown advisor_editor tool: ${toolName}`);
  return selectedTool.execute(selectedTool.parameters.parse(args ?? {}));
}

export async function getAdvisorEditorMcpServerConfig(advisorId: string) {
  globalMcpCache.__sprintBuddyAdvisorMcpServers ??= new Map();
  const existing = globalMcpCache.__sprintBuddyAdvisorMcpServers.get(advisorId);
  if (existing) return existing.config;

  const server = await createLocalMcpServer({
    name: "advisor_editor",
    tools: advisorEditorTools(advisorId),
  });
  globalMcpCache.__sprintBuddyAdvisorMcpServers.set(advisorId, server);
  return server.config;
}
