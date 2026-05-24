import { promises as fs } from "node:fs";
import path from "node:path";
import { generateId } from "ai";
import type { AppSettings } from "@/lib/ai/model-settings";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "@/lib/ai/model-settings";
import { loadGraphFallbackSkill } from "@/lib/graph-fallback-skill";
import { readGraphifyRetrievalDocuments, shouldUseGraphFallback } from "@/lib/graphify-config";
import { graphifyRetrieve, type RetrievalDocument } from "@/lib/graphify-retrieval";
import { slugify } from "./slug";
import type {
  Advisor,
  AdvisorBrain,
  AdvisorSource,
  AppUIMessage,
  BrainPage,
  CheckinItem,
  CheckinStatus,
  Conversation,
  Founder,
  FounderBrain,
  SearchHit,
  StoredMessage,
} from "./types";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const ADVISORS_DIR = path.join(DATA_DIR, "advisors");
const FOUNDERS_DIR = path.join(DATA_DIR, "founders");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

interface StoreIndex {
  version: 1;
  advisors: Advisor[];
  founders: Founder[];
  conversations: Conversation[];
  messages: StoredMessage[];
  checkins: CheckinItem[];
  settings: AppSettings;
}

const DEFAULT_ADVISOR_ID = "marten-mickos";
const DEFAULT_FOUNDER_ID = "local-founder";

function now() {
  return Date.now();
}

function defaultFounder(timestamp = now()): Founder {
  return {
    id: DEFAULT_FOUNDER_ID,
    name: "Local Founder",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function defaultIndex(): StoreIndex {
  const timestamp = now();
  return {
    version: 1,
    advisors: [
      {
        id: DEFAULT_ADVISOR_ID,
        name: "Marten Mickos",
        description: "Aalto Founder School advisor voice for Founder's harness.",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    founders: [defaultFounder(timestamp)],
    conversations: [],
    messages: [],
    checkins: [],
    settings: DEFAULT_APP_SETTINGS,
  };
}

function defaultWikiSchema(advisorName = "Marten Mickos") {
  return `# The Schema

This file defines how ${advisorName}'s LLM Wiki is maintained.

## Layers

- Raw sources: immutable source material captured under the advisor source registry. Read and cite these, but do not rewrite them while compiling the wiki.
- The wiki: LLM-maintained markdown pages that summarize, connect, and reconcile the sources into reusable founder-facing knowledge.
- The schema: this file. It records the conventions and workflows the LLM should follow when ingesting sources, answering questions, and maintaining the wiki.

## Workflow

1. Ingest one source at a time when possible.
2. Extract durable claims, concepts, people, frameworks, and contradictions.
3. Update the relevant wiki pages instead of creating duplicate summaries.
4. Preserve source provenance in page text when a claim depends on a source.
5. Update index and log pages when the wiki structure changes.
6. Flag contradictions or weak extraction instead of silently choosing a side.

## Response Rules

- Prefer the compiled wiki for synthesis.
- Fall back to raw sources when the wiki is thin, stale, or contested.
- Do not invent advisor-specific frameworks when neither sources nor wiki support them.
- Keep advisor guidance concise, direct, and action-oriented.
`;
}

function defaultFounderBrain(founderName = "Local Founder"): FounderBrain {
  return {
    profile: `# ${founderName}\n\nPrivate founder profile. Add only founder-owned context here; do not mix this into any advisor brain.`,
    memory:
      "# Founder Memory\n\nConcise pattern memory from Founder's Chat will appear here. Keep it short, private, and action-oriented.",
    graph: defaultFounderGraph(
      { id: DEFAULT_FOUNDER_ID, name: founderName, createdAt: now(), updatedAt: now() },
      {
        profile: `# ${founderName}\n\nPrivate founder profile. Add only founder-owned context here; do not mix this into any advisor brain.`,
        memory:
          "# Founder Memory\n\nConcise pattern memory from Founder's Chat will appear here. Keep it short, private, and action-oriented.",
        graph: "",
      },
      [],
      [],
    ),
  };
}

function defaultBrain(advisorName = "Marten Mickos"): AdvisorBrain {
  return {
    profile: `# ${advisorName}\n\nAdvisor profile for Founder's harness. Add real source material in the Advisor Editor before relying on advisor-specific claims.`,
    vision:
      "# Vision\n\nHelp founders become more honest, decisive, and self-aware during the 15-week Founder Sprint. Optimize for useful reflection, direct conversations, and concrete next actions.",
    direction:
      "# Direction\n\n- Be concise and direct.\n- Name the real issue before giving advice.\n- Ask one uncomfortable but useful question.\n- End with one next action the founder can take within 24 hours.\n- Do not fabricate advisor-specific frameworks when the wiki is empty.",
    memory:
      "# Advisor Memory\n\nStable advisor-side notes can appear here. Founder-specific conversation history belongs in the founder graph, not this advisor brain.",
    schema: defaultWikiSchema(advisorName),
    wikiPages: [
      {
        slug: "founders-harness-challenge",
        title: "Founder's harness challenge",
        updatedAt: now(),
        content:
          "# Founder's harness challenge\n\nFounder's harness is an AI companion for Founder Sprint participants. It should feel like a private coach in the founder pocket, not a survey tool or organizer monitor.",
      },
    ],
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDataDir() {
  await fs.mkdir(ADVISORS_DIR, { recursive: true });
  await fs.mkdir(FOUNDERS_DIR, { recursive: true });
  if (!(await exists(INDEX_PATH))) {
    const index = defaultIndex();
    await saveIndex(index);
    await ensureAdvisorFiles(index.advisors[0], defaultBrain(index.advisors[0].name));
    await ensureFounderFiles(index.founders[0], defaultFounderBrain(index.founders[0].name));
  }
}

async function loadIndex(): Promise<StoreIndex> {
  await ensureDataDir();
  const raw = await fs.readFile(INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<StoreIndex> & { settings?: unknown };
  const fallback = defaultIndex();
  const index: StoreIndex = {
    version: 1,
    advisors: Array.isArray(parsed.advisors) ? parsed.advisors : fallback.advisors,
    founders:
      Array.isArray(parsed.founders) && parsed.founders.length > 0
        ? parsed.founders
        : fallback.founders,
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    checkins: Array.isArray(parsed.checkins) ? parsed.checkins : [],
    settings: normalizeAppSettings(parsed.settings),
  };
  const shouldSave = !parsed.settings || !Array.isArray(parsed.founders);
  if (shouldSave) await saveIndex(index);
  return index;
}

async function saveIndex(index: StoreIndex) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

function advisorDir(advisorId: string) {
  return path.join(ADVISORS_DIR, advisorId);
}

function founderDir(founderId: string) {
  return path.join(FOUNDERS_DIR, founderId);
}

function sourcesMetaPath(advisorId: string) {
  return path.join(advisorDir(advisorId), "sources", "_sources.json");
}

async function readText(filePath: string, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function writeText(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function pageTitleFromContent(slug: string, content: string) {
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return firstHeading || slug.replace(/-/g, " ");
}

async function readPageDir(dir: string): Promise<BrainPage[]> {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const pages = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const slug = entry.name.replace(/\.md$/, "");
        const filePath = path.join(dir, entry.name);
        const stat = await fs.stat(filePath);
        const content = await fs.readFile(filePath, "utf8");
        return {
          slug,
          title: pageTitleFromContent(slug, content),
          content,
          updatedAt: stat.mtimeMs,
        };
      }),
  );
  return pages.sort((a, b) => a.title.localeCompare(b.title));
}

async function writePageDir(dir: string, pages: BrainPage[]) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const page of pages) {
    const slug = slugify(page.slug || page.title);
    await writeText(path.join(dir, `${slug}.md`), page.content || `# ${page.title}\n`);
  }
}

function firstParagraph(value: string, maxLength = 180) {
  return (
    value
      .replace(/^# .+$/gm, "")
      .split(/\n{2,}/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .find(Boolean)
      ?.slice(0, maxLength) ?? ""
  );
}

function bulletRows(rows: string[]) {
  return rows.length > 0 ? rows.map((row) => `- ${row}`).join("\n") : "- None yet.";
}

function defaultFounderGraph(
  founder: Founder,
  brain: FounderBrain,
  conversations: Conversation[],
  messages: StoredMessage[],
) {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => textFromStoredMessage(message))
    .filter(Boolean);

  return [
    "# Founder Graph",
    "",
    `Founder: ${founder.name}`,
    `Refreshed: ${new Date().toISOString()}`,
    "",
    "## Purpose",
    "",
    "This graph maps the named founder's private context: profile, conversation history, recurring patterns, decisions, unresolved tensions, and recent asks. It is queryable by Founder's Chat but disconnected from advisor essence.",
    "",
    "## Core Nodes",
    "",
    "- founder-profile -> describes -> current founder context",
    "- founder-memory -> summarizes -> durable founder patterns",
    "- conversations -> provide -> recent founder history",
    "- unresolved-tensions -> inform -> hard questions and next actions",
    "",
    "## Profile Signal",
    "",
    firstParagraph(brain.profile) || "No founder profile details yet.",
    "",
    "## Memory Nodes",
    "",
    bulletRows(
      brain.memory
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- ")),
    ),
    "",
    "## Recent Conversation Nodes",
    "",
    bulletRows(
      conversations
        .slice(-8)
        .map((conversation) => `conversation:${conversation.id} -> ${conversation.title}`),
    ),
    "",
    "## Recent Ask Nodes",
    "",
    bulletRows(recentUserMessages.map((message) => `founder-ask -> ${message.slice(0, 180)}`)),
  ].join("\n");
}

async function ensureAdvisorFiles(advisor: Advisor, brain = defaultBrain(advisor.name)) {
  const dir = advisorDir(advisor.id);
  await fs.mkdir(path.join(dir, "sources"), { recursive: true });
  await fs.mkdir(path.join(dir, "wiki"), { recursive: true });
  if (!(await exists(path.join(dir, "profile.md"))))
    await writeText(path.join(dir, "profile.md"), brain.profile);
  if (!(await exists(path.join(dir, "vision.md"))))
    await writeText(path.join(dir, "vision.md"), brain.vision);
  if (!(await exists(path.join(dir, "direction.md"))))
    await writeText(path.join(dir, "direction.md"), brain.direction);
  if (!(await exists(path.join(dir, "memory.md"))))
    await writeText(path.join(dir, "memory.md"), brain.memory);
  if (!(await exists(path.join(dir, "schema.md"))))
    await writeText(path.join(dir, "schema.md"), brain.schema || defaultWikiSchema(advisor.name));
  if ((await readPageDir(path.join(dir, "wiki"))).length === 0) {
    await writePageDir(path.join(dir, "wiki"), brain.wikiPages);
  }
  if (!(await exists(sourcesMetaPath(advisor.id)))) {
    await writeText(sourcesMetaPath(advisor.id), "[]\n");
  }
}

async function ensureFounderFiles(founder: Founder, brain = defaultFounderBrain(founder.name)) {
  const dir = founderDir(founder.id);
  await fs.mkdir(dir, { recursive: true });
  if (!(await exists(path.join(dir, "profile.md"))))
    await writeText(path.join(dir, "profile.md"), brain.profile);
  if (!(await exists(path.join(dir, "memory.md"))))
    await writeText(path.join(dir, "memory.md"), brain.memory);
  if (!(await exists(path.join(dir, "graph.md"))))
    await writeText(path.join(dir, "graph.md"), brain.graph);
}

async function writeAdvisorBrain(advisorId: string, brain: AdvisorBrain) {
  const dir = advisorDir(advisorId);
  await writeText(path.join(dir, "profile.md"), brain.profile);
  await writeText(path.join(dir, "vision.md"), brain.vision);
  await writeText(path.join(dir, "direction.md"), brain.direction);
  await writeText(path.join(dir, "memory.md"), brain.memory);
  await writeText(path.join(dir, "schema.md"), brain.schema || defaultWikiSchema());
  await writePageDir(path.join(dir, "wiki"), brain.wikiPages);
}

async function writeFounderBrain(founderId: string, brain: FounderBrain) {
  const dir = founderDir(founderId);
  await writeText(path.join(dir, "profile.md"), brain.profile);
  await writeText(path.join(dir, "memory.md"), brain.memory);
  await writeText(path.join(dir, "graph.md"), brain.graph);
}

export async function listAdvisors(): Promise<Advisor[]> {
  const index = await loadIndex();
  for (const advisor of index.advisors) {
    await ensureAdvisorFiles(advisor);
  }
  return index.advisors.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAdvisor(id: string): Promise<Advisor | null> {
  const index = await loadIndex();
  return index.advisors.find((advisor) => advisor.id === id) ?? null;
}

export async function createAdvisor(input: { name: string; description?: string }) {
  const index = await loadIndex();
  const base = slugify(input.name);
  let id = base;
  let n = 2;
  while (index.advisors.some((advisor) => advisor.id === id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const timestamp = now();
  const advisor: Advisor = {
    id,
    name: input.name,
    description: input.description ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  index.advisors.push(advisor);
  await saveIndex(index);
  await ensureAdvisorFiles(advisor, defaultBrain(advisor.name));
  return advisor;
}

export async function updateAdvisor(
  id: string,
  patch: Partial<Pick<Advisor, "name" | "description">>,
) {
  const index = await loadIndex();
  const advisor = index.advisors.find((item) => item.id === id);
  if (!advisor) return null;
  if (patch.name !== undefined) advisor.name = patch.name;
  if (patch.description !== undefined) advisor.description = patch.description;
  advisor.updatedAt = now();
  await saveIndex(index);
  return advisor;
}

export async function getDefaultFounder(): Promise<Founder> {
  const index = await loadIndex();
  const founder = index.founders[0] ?? defaultFounder();
  if (!index.founders.some((item) => item.id === founder.id)) {
    index.founders.push(founder);
    await saveIndex(index);
  }
  await ensureFounderFiles(founder);
  return founder;
}

export async function getFounder(id?: string): Promise<Founder | null> {
  const index = await loadIndex();
  const founderId = id || index.founders[0]?.id || DEFAULT_FOUNDER_ID;
  let founder = index.founders.find((item) => item.id === founderId) ?? null;
  if (!founder && founderId === DEFAULT_FOUNDER_ID) {
    founder = defaultFounder();
    index.founders.push(founder);
    await saveIndex(index);
  }
  if (founder) await ensureFounderFiles(founder);
  return founder;
}

export async function updateFounder(
  id: string,
  patch: Partial<Pick<Founder, "name">>,
): Promise<Founder | null> {
  const index = await loadIndex();
  const founder = index.founders.find((item) => item.id === id);
  if (!founder) return null;
  if (patch.name !== undefined) founder.name = patch.name;
  founder.updatedAt = now();
  await saveIndex(index);
  await ensureFounderFiles(founder);
  return founder;
}

export async function getAppSettings(): Promise<AppSettings> {
  const index = await loadIndex();
  return index.settings;
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  const index = await loadIndex();
  index.settings = normalizeAppSettings(settings);
  await saveIndex(index);
  return index.settings;
}

export async function deleteAdvisor(id: string) {
  const index = await loadIndex();
  const before = index.advisors.length;
  index.advisors = index.advisors.filter((advisor) => advisor.id !== id);
  index.conversations = index.conversations.filter((conversation) => conversation.advisorId !== id);
  index.messages = index.messages.filter((message) =>
    index.conversations.some((conversation) => conversation.id === message.conversationId),
  );
  index.checkins = index.checkins.filter((checkin) => checkin.advisorId !== id);
  await saveIndex(index);
  await fs.rm(advisorDir(id), { recursive: true, force: true });
  return index.advisors.length !== before;
}

export async function getAdvisorBrain(advisorId: string): Promise<AdvisorBrain | null> {
  const advisor = await getAdvisor(advisorId);
  if (!advisor) return null;
  await ensureAdvisorFiles(advisor);
  const dir = advisorDir(advisorId);
  return {
    profile: await readText(path.join(dir, "profile.md")),
    vision: await readText(path.join(dir, "vision.md")),
    direction: await readText(path.join(dir, "direction.md")),
    memory: await readText(path.join(dir, "memory.md")),
    schema: await readText(path.join(dir, "schema.md"), defaultWikiSchema(advisor.name)),
    wikiPages: await readPageDir(path.join(dir, "wiki")),
  };
}

export async function updateAdvisorBrain(advisorId: string, brain: AdvisorBrain) {
  const advisor = await getAdvisor(advisorId);
  if (!advisor) return null;
  await ensureAdvisorFiles(advisor, brain);
  await writeAdvisorBrain(advisorId, brain);
  await updateAdvisor(advisorId, {});
  return getAdvisorBrain(advisorId);
}

export async function getFounderBrain(founderId?: string): Promise<FounderBrain | null> {
  const founder = await getFounder(founderId);
  if (!founder) return null;
  await ensureFounderFiles(founder);
  const dir = founderDir(founder.id);
  return {
    profile: await readText(path.join(dir, "profile.md")),
    memory: await readText(path.join(dir, "memory.md")),
    graph: await readText(path.join(dir, "graph.md")),
  };
}

export async function updateFounderBrain(founderId: string, brain: FounderBrain) {
  const founder = await getFounder(founderId);
  if (!founder) return null;
  await ensureFounderFiles(founder, brain);
  await writeFounderBrain(founderId, brain);
  await updateFounder(founderId, {});
  return getFounderBrain(founderId);
}

async function loadSourcesMeta(advisorId: string): Promise<Omit<AdvisorSource, "body">[]> {
  await fs.mkdir(path.dirname(sourcesMetaPath(advisorId)), { recursive: true });
  if (!(await exists(sourcesMetaPath(advisorId)))) return [];
  return JSON.parse(await fs.readFile(sourcesMetaPath(advisorId), "utf8")) as Omit<
    AdvisorSource,
    "body"
  >[];
}

async function saveSourcesMeta(advisorId: string, sources: Omit<AdvisorSource, "body">[]) {
  await writeText(sourcesMetaPath(advisorId), `${JSON.stringify(sources, null, 2)}\n`);
}

function sourcePath(advisorId: string, sourceId: string) {
  return path.join(advisorDir(advisorId), "sources", `${sourceId}.md`);
}

export async function listSources(advisorId: string): Promise<AdvisorSource[]> {
  if (!(await getAdvisor(advisorId))) return [];
  const meta = await loadSourcesMeta(advisorId);
  const sources = await Promise.all(
    meta.map(async (source) => ({
      ...source,
      body: await readText(sourcePath(advisorId, source.id)),
    })),
  );
  return sources.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createSource(
  advisorId: string,
  input: Pick<AdvisorSource, "title" | "body"> &
    Partial<Pick<AdvisorSource, "kind" | "sourceUrl" | "status" | "extractionNote">>,
): Promise<AdvisorSource | null> {
  if (!(await getAdvisor(advisorId))) return null;
  const timestamp = now();
  const meta = await loadSourcesMeta(advisorId);
  const base = slugify(input.title);
  let id = base;
  let n = 2;
  while (meta.some((source) => source.id === id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const source: AdvisorSource = {
    id,
    advisorId,
    title: input.title,
    body: input.body,
    kind: input.kind ?? "text",
    sourceUrl: input.sourceUrl,
    status: input.status ?? "ready",
    extractionNote: input.extractionNote,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  meta.push({
    id: source.id,
    advisorId: source.advisorId,
    title: source.title,
    kind: source.kind,
    sourceUrl: source.sourceUrl,
    status: source.status,
    extractionNote: source.extractionNote,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  });
  await saveSourcesMeta(advisorId, meta);
  await writeText(sourcePath(advisorId, id), input.body);
  return source;
}

export async function updateSource(
  advisorId: string,
  sourceId: string,
  input: Pick<AdvisorSource, "title" | "body"> &
    Partial<Pick<AdvisorSource, "kind" | "sourceUrl" | "status" | "extractionNote">>,
): Promise<AdvisorSource | null> {
  const meta = await loadSourcesMeta(advisorId);
  const source = meta.find((item) => item.id === sourceId);
  if (!source) return null;
  source.title = input.title;
  if (input.kind !== undefined) source.kind = input.kind;
  if (input.sourceUrl !== undefined) source.sourceUrl = input.sourceUrl;
  if (input.status !== undefined) source.status = input.status;
  if (input.extractionNote !== undefined) source.extractionNote = input.extractionNote;
  source.updatedAt = now();
  await saveSourcesMeta(advisorId, meta);
  await writeText(sourcePath(advisorId, sourceId), input.body);
  return { ...source, body: input.body };
}

export async function deleteSource(advisorId: string, sourceId: string) {
  const meta = await loadSourcesMeta(advisorId);
  const before = meta.length;
  const next = meta.filter((source) => source.id !== sourceId);
  await saveSourcesMeta(advisorId, next);
  await fs.rm(sourcePath(advisorId, sourceId), { force: true });
  return next.length !== before;
}

export async function refreshAdvisorGraph(advisorId: string) {
  const brain = await getAdvisorBrain(advisorId);
  if (!brain) return null;
  return brain;
}

export async function refreshFounderGraph(founderId?: string) {
  const founder = await getFounder(founderId);
  if (!founder) return null;
  const brain = await getFounderBrain(founder.id);
  if (!brain) return null;
  const index = await loadIndex();
  const conversations = index.conversations.filter(
    (conversation) => (conversation.founderId ?? DEFAULT_FOUNDER_ID) === founder.id,
  );
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  const messages = index.messages
    .filter((message) => conversationIds.has(message.conversationId))
    .sort((a, b) => a.createdAt - b.createdAt);

  return updateFounderBrain(founder.id, {
    ...brain,
    graph: defaultFounderGraph(founder, brain, conversations, messages),
  });
}

function textFromMessage(message: AppUIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function textFromStoredMessage(message: StoredMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function metadataCreatedAt(message: AppUIMessage) {
  if (!message.metadata || typeof message.metadata !== "object") return null;
  const value = (message.metadata as { createdAt?: unknown }).createdAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toAppMessage(message: StoredMessage): AppUIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: { createdAt: message.createdAt },
  } as AppUIMessage;
}

export async function listConversations(advisorId?: string) {
  const index = await loadIndex();
  return index.conversations
    .filter((conversation) => !advisorId || conversation.advisorId === advisorId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(conversationId: string, advisorId?: string) {
  const index = await loadIndex();
  const conversation = index.conversations.find(
    (item) => item.id === conversationId && (!advisorId || item.advisorId === advisorId),
  );
  if (!conversation) return null;

  const messages = index.messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toAppMessage);

  return { conversation, messages };
}

export async function saveConversationMessages(
  conversationId: string,
  advisorId: string,
  founderId: string,
  messages: AppUIMessage[],
) {
  const index = await loadIndex();
  const firstUser = messages.find((message) => message.role === "user");
  const title = firstUser
    ? textFromMessage(firstUser).slice(0, 60) || "New conversation"
    : "New conversation";
  const timestamp = now();
  const existing = index.conversations.find((conversation) => conversation.id === conversationId);
  if (existing) {
    existing.title = existing.title || title;
    existing.founderId = founderId;
    existing.updatedAt = timestamp;
  } else {
    index.conversations.push({
      id: conversationId,
      advisorId,
      founderId,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  const existingMessageTimes = new Map(
    index.messages
      .filter((message) => message.conversationId === conversationId)
      .map((message) => [message.id, message.createdAt] as const),
  );
  index.messages = index.messages.filter((message) => message.conversationId !== conversationId);
  index.messages.push(
    ...messages.map((message) => ({
      id: message.id,
      conversationId,
      role: message.role,
      parts: message.parts,
      createdAt: metadataCreatedAt(message) ?? existingMessageTimes.get(message.id) ?? timestamp,
    })),
  );
  await saveIndex(index);
}

export async function updateFounderMemoryFromMessages(founderId: string, messages: AppUIMessage[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return;
  const text = textFromMessage(lastUser);
  if (!text) return;
  const brain = await getFounderBrain(founderId);
  if (!brain) return;
  const lines = brain.memory
    .split("\n")
    .filter((line) => !line.startsWith("- [20"))
    .join("\n")
    .trim();
  const previous = brain.memory
    .split("\n")
    .filter((line) => line.startsWith("- [20"))
    .slice(-11);
  const entry = `- [${new Date().toISOString().slice(0, 10)}] Founder said: ${text.slice(0, 180)}`;
  brain.memory = `${lines || "# Founder Memory"}\n\n${[...previous, entry].join("\n")}\n`;
  await updateFounderBrain(founderId, brain);
  await refreshFounderGraph(founderId);
}

export async function searchAdvisorBrain(advisorId: string, query: string): Promise<SearchHit[]> {
  const brain = await getAdvisorBrain(advisorId);
  if (!brain) return [];
  const sources = await listSources(advisorId);
  const useFallback = await shouldUseGraphFallback();
  const [fallbackSkill, graphifyDocuments] = await Promise.all([
    useFallback ? loadGraphFallbackSkill() : Promise.resolve(null),
    useFallback ? Promise.resolve([]) : readGraphifyRetrievalDocuments(),
  ]);
  const documents: RetrievalDocument[] = [
    {
      scope: "advisor",
      source: "profile",
      slug: "profile",
      title: "Advisor Profile",
      text: brain.profile,
    },
    { scope: "advisor", source: "vision", slug: "vision", title: "Vision", text: brain.vision },
    {
      scope: "advisor",
      source: "direction",
      slug: "direction",
      title: "Direction",
      text: brain.direction,
    },
    {
      scope: "advisor",
      source: "memory",
      slug: "memory",
      title: "Advisor Memory",
      text: brain.memory,
    },
    {
      scope: "advisor",
      source: "schema",
      slug: "schema",
      title: "The Schema",
      text: brain.schema,
    },
    ...brain.wikiPages.map((page) => ({
      scope: "advisor" as const,
      source: "wiki" as const,
      slug: page.slug,
      title: page.title,
      text: page.content,
    })),
    ...graphifyDocuments.map((document) => ({
      scope: "advisor" as const,
      source: "graph" as const,
      slug: document.slug,
      title: document.title,
      text: document.content,
    })),
    ...(fallbackSkill
      ? [
          {
            scope: "advisor" as const,
            source: "fallback_skill" as const,
            slug: "graph_fallback",
            title: fallbackSkill.name,
            text: fallbackSkill.content,
          },
          ...fallbackSkill.references.map((reference) => ({
            scope: "advisor" as const,
            source: "fallback_reference" as const,
            slug: reference.slug,
            title: reference.title,
            text: reference.content,
          })),
        ]
      : []),
    ...sources.map((source) => ({
      scope: "advisor" as const,
      source: "source" as const,
      slug: source.id,
      title: source.title,
      text: source.body,
    })),
  ];

  return graphifyRetrieve(documents, query, 6);
}

export async function searchFounderBrain(founderId: string, query: string): Promise<SearchHit[]> {
  const brain = await getFounderBrain(founderId);
  if (!brain) return [];

  const documents: RetrievalDocument[] = [
    {
      scope: "founder",
      source: "profile",
      slug: "profile",
      title: "Founder Profile",
      text: brain.profile,
    },
    {
      scope: "founder",
      source: "memory",
      slug: "memory",
      title: "Founder Memory",
      text: brain.memory,
    },
    {
      scope: "founder",
      source: "graph",
      slug: "graph",
      title: "Founder Graph",
      text: brain.graph,
    },
  ];

  return graphifyRetrieve(documents, query, 6);
}

export async function searchBuddyContext(
  advisorId: string,
  founderId: string,
  query: string,
): Promise<SearchHit[]> {
  const [advisorHits, founderHits] = await Promise.all([
    searchAdvisorBrain(advisorId, query),
    searchFounderBrain(founderId, query),
  ]);
  return [...advisorHits, ...founderHits].sort((a, b) => b.score - a.score).slice(0, 10);
}

export async function readAdvisorPage(advisorId: string, slug: string) {
  const brain = await getAdvisorBrain(advisorId);
  if (!brain) return null;
  const sources = await listSources(advisorId);
  const pages = [
    { slug: "profile", title: "Advisor Profile", content: brain.profile },
    { slug: "vision", title: "Vision", content: brain.vision },
    { slug: "direction", title: "Direction", content: brain.direction },
    { slug: "memory", title: "Advisor Memory", content: brain.memory },
    { slug: "schema", title: "The Schema", content: brain.schema },
    ...brain.wikiPages,
    ...sources.map((source) => ({ slug: source.id, title: source.title, content: source.body })),
  ];
  const useFallback = await shouldUseGraphFallback();
  const graphifyDocuments = useFallback ? [] : await readGraphifyRetrievalDocuments();
  pages.push(
    ...graphifyDocuments.map((document) => ({
      slug: document.slug,
      title: document.title,
      content: document.content,
    })),
  );
  const fallbackSkill = useFallback ? await loadGraphFallbackSkill() : null;
  if (fallbackSkill) {
    pages.push({
      slug: "graph_fallback",
      title: fallbackSkill.name,
      content: fallbackSkill.content,
    });
    pages.push(
      ...fallbackSkill.references.map((reference) => ({
        slug: reference.slug,
        title: reference.title,
        content: reference.content,
      })),
    );
  }
  return pages.find((page) => page.slug === slug) ?? null;
}

export async function readFounderPage(founderId: string, slug: string) {
  const brain = await getFounderBrain(founderId);
  if (!brain) return null;
  const pages = [
    { slug: "profile", title: "Founder Profile", content: brain.profile },
    { slug: "memory", title: "Founder Memory", content: brain.memory },
    { slug: "graph", title: "Founder Graph", content: brain.graph },
  ];
  return pages.find((page) => page.slug === slug) ?? null;
}

export async function listCheckins(advisorId: string) {
  const index = await loadIndex();
  return index.checkins
    .filter((checkin) => checkin.advisorId === advisorId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function addCheckins(
  advisorId: string,
  items: Array<Pick<CheckinItem, "title" | "prompt">>,
) {
  const index = await loadIndex();
  const timestamp = now();
  const dueAt = timestamp + index.settings.checkins.intervalDays * 24 * 60 * 60 * 1000;
  const checkins = items.map((item) => ({
    id: generateId(),
    advisorId,
    title: item.title,
    prompt: item.prompt,
    status: "todo" as CheckinStatus,
    createdAt: timestamp,
    dueAt,
  }));
  index.checkins.push(...checkins);
  await saveIndex(index);
  return checkins;
}

export async function updateCheckin(id: string, status: CheckinStatus) {
  const index = await loadIndex();
  const checkin = index.checkins.find((item) => item.id === id);
  if (!checkin) return null;
  checkin.status = status;
  await saveIndex(index);
  return checkin;
}

export async function shouldGenerateCheckins(advisorId: string) {
  const index = await loadIndex();
  const intervalDays = index.settings.checkins.intervalDays;
  const checkins = await listCheckins(advisorId);
  const newest = checkins[0];
  if (!newest) return true;
  return now() - newest.createdAt > intervalDays * 24 * 60 * 60 * 1000;
}
