import { promises as fs } from "node:fs";
import path from "node:path";
import { generateId } from "ai";
import type { AppSettings } from "@/lib/ai/model-settings";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "@/lib/ai/model-settings";
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
  SearchHit,
  StoredMessage,
} from "./types";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const ADVISORS_DIR = path.join(DATA_DIR, "advisors");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

interface StoreIndex {
  version: 1;
  advisors: Advisor[];
  conversations: Conversation[];
  messages: StoredMessage[];
  checkins: CheckinItem[];
  settings: AppSettings;
}

const DEFAULT_ADVISOR_ID = "marten-mickos";

function now() {
  return Date.now();
}

function defaultIndex(): StoreIndex {
  const timestamp = now();
  return {
    version: 1,
    advisors: [
      {
        id: DEFAULT_ADVISOR_ID,
        name: "Marten Mickos",
        description: "Aalto Founder School advisor voice for Sprint Buddy.",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    conversations: [],
    messages: [],
    checkins: [],
    settings: DEFAULT_APP_SETTINGS,
  };
}

function defaultBrain(advisorName = "Marten Mickos"): AdvisorBrain {
  return {
    profile: `# ${advisorName}\n\nAdvisor profile for Sprint Buddy. Add real source material in the Advisor Editor before relying on advisor-specific claims.`,
    vision:
      "# Vision\n\nHelp founders become more honest, decisive, and self-aware during the 15-week Founder Sprint. Optimize for useful reflection, direct conversations, and concrete next actions.",
    direction:
      "# Direction\n\n- Be concise and direct.\n- Name the real issue before giving advice.\n- Ask one uncomfortable but useful question.\n- End with one next action the founder can take within 24 hours.\n- Do not fabricate advisor-specific frameworks when the wiki is empty.",
    memory:
      "# Founder Memory\n\nConcise pattern memory from Buddy Chat will appear here. Keep it short, private, and action-oriented.",
    wikiPages: [
      {
        slug: "sprint-buddy-challenge",
        title: "Sprint Buddy Challenge",
        updatedAt: now(),
        content:
          "# Sprint Buddy Challenge\n\nSprint Buddy is an AI companion for Founder Sprint participants. It should feel like a private coach in the founder pocket, not a survey tool or organizer monitor.",
      },
    ],
    skills: [
      {
        slug: "hard-question-then-next-action",
        title: "Hard Question, Then Next Action",
        updatedAt: now(),
        content:
          "# Hard Question, Then Next Action\n\nWhen a founder brings a vague concern, ask one precise question that reveals the avoided truth, then propose one concrete action for the next 24 hours.",
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
  if (!(await exists(INDEX_PATH))) {
    const index = defaultIndex();
    await saveIndex(index);
    await ensureAdvisorFiles(index.advisors[0], defaultBrain(index.advisors[0].name));
  }
}

async function loadIndex(): Promise<StoreIndex> {
  await ensureDataDir();
  const raw = await fs.readFile(INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw) as StoreIndex & { settings?: unknown };
  const index: StoreIndex = {
    ...parsed,
    settings: normalizeAppSettings(parsed.settings),
  };
  if (!parsed.settings) await saveIndex(index);
  return index;
}

async function saveIndex(index: StoreIndex) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

function advisorDir(advisorId: string) {
  return path.join(ADVISORS_DIR, advisorId);
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

async function ensureAdvisorFiles(advisor: Advisor, brain = defaultBrain(advisor.name)) {
  const dir = advisorDir(advisor.id);
  await fs.mkdir(path.join(dir, "sources"), { recursive: true });
  await fs.mkdir(path.join(dir, "wiki"), { recursive: true });
  await fs.mkdir(path.join(dir, "skills"), { recursive: true });
  if (!(await exists(path.join(dir, "profile.md"))))
    await writeText(path.join(dir, "profile.md"), brain.profile);
  if (!(await exists(path.join(dir, "vision.md"))))
    await writeText(path.join(dir, "vision.md"), brain.vision);
  if (!(await exists(path.join(dir, "direction.md"))))
    await writeText(path.join(dir, "direction.md"), brain.direction);
  if (!(await exists(path.join(dir, "memory.md"))))
    await writeText(path.join(dir, "memory.md"), brain.memory);
  if ((await readPageDir(path.join(dir, "wiki"))).length === 0) {
    await writePageDir(path.join(dir, "wiki"), brain.wikiPages);
  }
  if ((await readPageDir(path.join(dir, "skills"))).length === 0) {
    await writePageDir(path.join(dir, "skills"), brain.skills);
  }
  if (!(await exists(sourcesMetaPath(advisor.id)))) {
    await writeText(sourcesMetaPath(advisor.id), "[]\n");
  }
}

async function writeAdvisorBrain(advisorId: string, brain: AdvisorBrain) {
  const dir = advisorDir(advisorId);
  await writeText(path.join(dir, "profile.md"), brain.profile);
  await writeText(path.join(dir, "vision.md"), brain.vision);
  await writeText(path.join(dir, "direction.md"), brain.direction);
  await writeText(path.join(dir, "memory.md"), brain.memory);
  await writePageDir(path.join(dir, "wiki"), brain.wikiPages);
  await writePageDir(path.join(dir, "skills"), brain.skills);
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
    wikiPages: await readPageDir(path.join(dir, "wiki")),
    skills: await readPageDir(path.join(dir, "skills")),
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

function textFromMessage(message: AppUIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

export async function saveConversationMessages(
  conversationId: string,
  advisorId: string,
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
    existing.updatedAt = timestamp;
  } else {
    index.conversations.push({
      id: conversationId,
      advisorId,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  index.messages = index.messages.filter((message) => message.conversationId !== conversationId);
  index.messages.push(
    ...messages.map((message) => ({
      id: message.id,
      conversationId,
      role: message.role,
      parts: message.parts,
      createdAt: timestamp,
    })),
  );
  await saveIndex(index);
}

export async function updateMemoryFromMessages(advisorId: string, messages: AppUIMessage[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return;
  const text = textFromMessage(lastUser);
  if (!text) return;
  const brain = await getAdvisorBrain(advisorId);
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
  const entry = `- [${new Date().toISOString().slice(0, 10)}] Founder asked: ${text.slice(0, 180)}`;
  brain.memory = `${lines || "# Founder Memory"}\n\n${[...previous, entry].join("\n")}\n`;
  await updateAdvisorBrain(advisorId, brain);
}

function scoreDocument(queryTokens: string[], text: string) {
  const lower = text.toLowerCase();
  return queryTokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function excerpt(text: string, queryTokens: string[]) {
  const clean = text.replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const index = queryTokens
    .map((token) => lower.indexOf(token))
    .filter((item) => item >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (index ?? 0) - 100);
  return clean.slice(start, start + 420);
}

export async function searchAdvisorBrain(advisorId: string, query: string): Promise<SearchHit[]> {
  const brain = await getAdvisorBrain(advisorId);
  if (!brain) return [];
  const sources = await listSources(advisorId);
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  const documents: Array<Omit<SearchHit, "excerpt" | "score"> & { text: string }> = [
    { source: "profile", slug: "profile", title: "Advisor Profile", text: brain.profile },
    { source: "vision", slug: "vision", title: "Vision", text: brain.vision },
    { source: "direction", slug: "direction", title: "Direction", text: brain.direction },
    { source: "memory", slug: "memory", title: "Founder Memory", text: brain.memory },
    ...brain.wikiPages.map((page) => ({
      source: "wiki" as const,
      slug: page.slug,
      title: page.title,
      text: page.content,
    })),
    ...brain.skills.map((page) => ({
      source: "skill" as const,
      slug: page.slug,
      title: page.title,
      text: page.content,
    })),
    ...sources.map((source) => ({
      source: "source" as const,
      slug: source.id,
      title: source.title,
      text: source.body,
    })),
  ];

  return documents
    .map((doc) => ({
      source: doc.source,
      slug: doc.slug,
      title: doc.title,
      excerpt: excerpt(doc.text, tokens),
      score: scoreDocument(tokens, doc.text),
    }))
    .filter((hit) => hit.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function readAdvisorPage(advisorId: string, slug: string) {
  const brain = await getAdvisorBrain(advisorId);
  if (!brain) return null;
  const sources = await listSources(advisorId);
  const pages = [
    { slug: "profile", title: "Advisor Profile", content: brain.profile },
    { slug: "vision", title: "Vision", content: brain.vision },
    { slug: "direction", title: "Direction", content: brain.direction },
    { slug: "memory", title: "Founder Memory", content: brain.memory },
    ...brain.wikiPages,
    ...brain.skills,
    ...sources.map((source) => ({ slug: source.id, title: source.title, content: source.body })),
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
  const dueAt = timestamp + Number(process.env.CHECKIN_INTERVAL_DAYS ?? 2) * 24 * 60 * 60 * 1000;
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
  const intervalDays = Number(process.env.CHECKIN_INTERVAL_DAYS ?? 2);
  const checkins = await listCheckins(advisorId);
  const newest = checkins[0];
  if (!newest) return true;
  return now() - newest.createdAt > intervalDays * 24 * 60 * 60 * 1000;
}
