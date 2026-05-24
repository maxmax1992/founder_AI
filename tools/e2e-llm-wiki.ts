import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import { basename, resolve } from "node:path";
import { buildBuddyAnswerContext } from "../src/lib/buddy-context";
import { graphFallbackDirectAnswer, loadGraphFallbackSkill } from "../src/lib/graph-fallback-skill";
import { getGraphifyRuntimeStatus } from "../src/lib/graphify-config";
import { answerQuestionFromCompiledWiki, semanticWikiDigest } from "../src/lib/llm-wiki-workshop";
import type {
  Advisor,
  AdvisorBrainResponse,
  AdvisorSource,
  FounderBrainResponse,
  ListSourcesResponse,
} from "../src/lib/types";

const DOCX_PATH = resolve("marten/Marten Mickos Social Media Postings.docx");
const DOCX_TITLE = "Marten Mickos Social Media Postings";
const NEW_INFO_TITLE = "E2E Founder Evidence Checkpoint";
const NEW_INFO_TOKEN = "E2E_NEW_SIGNAL_FOUNDER_EVIDENCE_CHECKPOINTS";
const NEW_INFO_BODY = [
  `${NEW_INFO_TOKEN}: Founders should set weekly evidence checkpoints before they keep building.`,
  "At each checkpoint, they must name what customer evidence would change the current plan.",
  "This source exists only inside the temporary E2E advisor and is removed before the script exits.",
].join("\n");
const FOUNDER_CONTEXT_TOKEN = `E2E_FOUNDER_CONTEXT_${Date.now()}`;
const ADVISOR_CONTEXT_TOKEN = `E2E_ADVISOR_CONTEXT_${Date.now()}`;

interface DevServer {
  baseUrl: string;
  process: ChildProcessWithoutNullStreams | null;
  logs: string[];
}

interface QaResult {
  question: string;
  answer: string;
}

async function main() {
  const existingServer = await findExistingDevServer();
  const server = existingServer ?? (await startDevServer(await findOpenPort(3380)));
  let advisorId = "";
  let originalFounder: FounderBrainResponse | null = null;
  const qaResults: QaResult[] = [];

  try {
    const advisor = await postJson<{ advisor: Advisor }>(server.baseUrl, "/api/advisors", {
      name: `E2E LLM Wiki ${Date.now()}`,
      description: "Temporary advisor for source import and LLM wiki E2E validation.",
    });
    advisorId = advisor.advisor.id;
    originalFounder = await getJson<FounderBrainResponse>(server.baseUrl, "/api/founders/default");
    await patchJson<FounderBrainResponse>(server.baseUrl, "/api/founders/default", {
      name: `E2E Founder ${Date.now()}`,
      profile: `# E2E Founder\n\n${FOUNDER_CONTEXT_TOKEN}: founder is privately wrestling with a pricing decision.`,
      memory: "# Founder Memory\n",
    });

    const firstDocx = await importDocxSource(server.baseUrl, advisorId);
    assert(firstDocx.status === "ready", "DOCX import should be ready");
    assert(firstDocx.kind === "docx", "DOCX import should preserve source kind");
    assert(
      firstDocx.body.includes("Sell before you build"),
      "DOCX import should extract Marten social posting text",
    );

    const firstBrain = await getJson<AdvisorBrainResponse>(
      server.baseUrl,
      `/api/advisors/${advisorId}/brain`,
    );
    const digestAfterFirstImport = semanticWikiDigest(firstBrain.brain);
    qaResults.push(
      qaPass(firstBrain.brain, "What should a founder do before building?", [
        "Selling is essential",
      ]),
    );
    qaResults.push(
      qaPass(firstBrain.brain, "How should a founder handle VC disagreement?", [
        "do not argue back",
      ]),
    );

    await importDocxSource(server.baseUrl, advisorId);
    await workshop(
      server.baseUrl,
      advisorId,
      "Refresh the LLM wiki from sources after the duplicate DOCX import.",
    );
    const duplicateBrain = await getJson<AdvisorBrainResponse>(
      server.baseUrl,
      `/api/advisors/${advisorId}/brain`,
    );
    const digestAfterDuplicateImport = semanticWikiDigest(duplicateBrain.brain);
    assert(
      digestAfterDuplicateImport === digestAfterFirstImport,
      "Duplicate DOCX import should not change the compiled semantic wiki pages",
    );
    const duplicateIndex = pageContent(duplicateBrain.brain, "source-index");
    assert(duplicateIndex.includes("Imported sources: 2"), "Source index should see both imports");
    assert(
      duplicateIndex.includes("Unique source bodies: 1"),
      "Source index should collapse duplicate source bodies",
    );

    await importTextSource(
      server.baseUrl,
      advisorId,
      NEW_INFO_TITLE,
      `${ADVISOR_CONTEXT_TOKEN}: advisor source says evidence checkpoints matter.\n${NEW_INFO_BODY}`,
    );
    const newInfoBrain = await getJson<AdvisorBrainResponse>(
      server.baseUrl,
      `/api/advisors/${advisorId}/brain`,
    );
    assert(
      semanticWikiDigest(newInfoBrain.brain) !== digestAfterDuplicateImport,
      "New source information should change the compiled semantic wiki digest",
    );
    qaResults.push(
      qaPass(newInfoBrain.brain, "What does the wiki say about evidence checkpoints?", [
        "evidence checkpoints",
      ]),
    );

    await buddyChat(server.baseUrl, {
      id: `e2e-founder-context-${Date.now()}`,
      advisorId,
      founderId: originalFounder.founder.id,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: `${FOUNDER_CONTEXT_TOKEN}: I keep postponing the pricing decision.`,
            },
          ],
        },
      ],
    });
    const founderAfterChat = await getJson<FounderBrainResponse>(
      server.baseUrl,
      "/api/founders/default",
    );
    assert(
      founderAfterChat.brain.memory.includes(FOUNDER_CONTEXT_TOKEN),
      "Founder's Chat should update founder memory",
    );
    assert(
      founderAfterChat.brain.graph.includes(FOUNDER_CONTEXT_TOKEN),
      "Founder's Chat should refresh founder graph",
    );
    const advisorAfterChat = await getJson<AdvisorBrainResponse>(
      server.baseUrl,
      `/api/advisors/${advisorId}/brain`,
    );
    const advisorTextAfterChat = [
      advisorAfterChat.brain.profile,
      advisorAfterChat.brain.memory,
      ...advisorAfterChat.brain.wikiPages.map((page) => page.content),
    ].join("\n");
    assert(
      !advisorTextAfterChat.includes(FOUNDER_CONTEXT_TOKEN),
      "Founder context should not be written into advisor files",
    );
    const buddyContext = await buildBuddyAnswerContext(
      advisorId,
      originalFounder.founder.id,
      `${ADVISOR_CONTEXT_TOKEN} ${FOUNDER_CONTEXT_TOKEN}`,
    );
    assert(buddyContext, "Founder's Chat context compiler should load advisor and founder context");
    assert(
      buddyContext.advisorHits.some((hit) => hit.excerpt.includes(ADVISOR_CONTEXT_TOKEN)),
      "Founder's Chat context should retrieve scoped advisor evidence",
    );
    assert(
      buddyContext.advisorHits.some((hit) => hit.scope === "advisor" && hit.source === "source"),
      "Founder's Chat context should retrieve advisor source evidence without advisor graph.md fallback",
    );
    assert(
      buddyContext.founderHits.some((hit) => hit.excerpt.includes(FOUNDER_CONTEXT_TOKEN)),
      "Founder's Chat context should retrieve scoped founder evidence",
    );
    assert(
      buddyContext.founderHits.some(
        (hit) =>
          hit.scope === "founder" && (hit.retrieval === "graph" || hit.retrieval === "hybrid"),
      ),
      "Founder's Chat context should use graphify-aware founder relationships during retrieval",
    );

    await workshop(
      server.baseUrl,
      advisorId,
      `Remove source "${NEW_INFO_TITLE}" and update the wiki.`,
    );
    const afterRemovalSources = await getJson<ListSourcesResponse>(
      server.baseUrl,
      `/api/advisors/${advisorId}/sources`,
    );
    assert(
      !afterRemovalSources.sources.some((source) => source.title === NEW_INFO_TITLE),
      "Workshop remove command should delete the targeted source",
    );
    const afterRemovalBrain = await getJson<AdvisorBrainResponse>(
      server.baseUrl,
      `/api/advisors/${advisorId}/brain`,
    );
    const afterRemovalWikiText = afterRemovalBrain.brain.wikiPages
      .map((page) => page.content)
      .join("\n");
    assert(
      !afterRemovalWikiText.includes(NEW_INFO_TOKEN),
      "Workshop remove command should remove targeted source information from compiled wiki",
    );
    const removedAnswer = answerQuestionFromCompiledWiki(
      afterRemovalBrain.brain,
      "What does the wiki say about evidence checkpoints?",
    );
    assert(
      removedAnswer.includes("No compiled wiki passage"),
      "Q&A should stop answering from removed source information",
    );
    qaResults.push({
      question: "What does the wiki say about evidence checkpoints after removal?",
      answer: removedAnswer,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          advisorId,
          checks: [
            "DOCX import extracted Word content",
            "Source import auto-compiled source inventory into wiki pages",
            "Duplicate DOCX import kept semantic wiki digest stable",
            "New text source changed the compiled wiki",
            "Founder's Chat updated founder memory and graph",
            "Founder's Chat context compiler retrieved advisor and founder context separately",
            "Founder's Chat context retrieved advisor evidence without advisor graph.md fallback",
            "Founder context stayed out of advisor files",
            "Workshop remove command deleted the source and refreshed the wiki",
            "Multiple Q&A passes matched expected source-grounded answers",
            ...(await fallbackSkillChecks(server.baseUrl)),
          ],
          qaResults,
        },
        null,
        2,
      ),
    );
  } finally {
    if (advisorId) {
      await fetch(`${server.baseUrl}/api/advisors/${advisorId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
    if (originalFounder) {
      await patchJson(server.baseUrl, "/api/founders/default", {
        name: originalFounder.founder.name,
        profile: originalFounder.brain.profile,
        memory: originalFounder.brain.memory,
        graph: originalFounder.brain.graph,
      }).catch(() => undefined);
    }
    await stopDevServer(server.process);
  }
}

async function importDocxSource(baseUrl: string, advisorId: string) {
  const file = Bun.file(DOCX_PATH);
  const formData = new FormData();
  formData.set("kind", "docx");
  formData.set("title", DOCX_TITLE);
  formData.set(
    "file",
    new File([await file.arrayBuffer()], basename(DOCX_PATH), {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  const data = await postForm<{ source: AdvisorSource }>(
    baseUrl,
    `/api/advisors/${advisorId}/sources/import`,
    formData,
  );
  return data.source;
}

async function importTextSource(baseUrl: string, advisorId: string, title: string, body: string) {
  const formData = new FormData();
  formData.set("kind", "text");
  formData.set("title", title);
  formData.set("body", body);
  const data = await postForm<{ source: AdvisorSource }>(
    baseUrl,
    `/api/advisors/${advisorId}/sources/import`,
    formData,
  );
  return data.source;
}

async function workshop(baseUrl: string, advisorId: string, text: string) {
  const res = await fetch(`${baseUrl}/api/advisors/${advisorId}/workshop-chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: `${advisorId}-workshop-e2e`,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Workshop request failed (${res.status}): ${raw}`);
  assert(
    raw.includes("Compiled") || raw.includes("Removed"),
    `Unexpected workshop response: ${raw}`,
  );
  return raw;
}

async function buddyChat(baseUrl: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Founder's Chat request failed (${res.status}): ${raw}`);
  return raw;
}

async function fallbackSkillChecks(baseUrl: string) {
  const previousUseGraphify = process.env.USE_GRAPHIFY;
  let advisorId = "";
  try {
    process.env.USE_GRAPHIFY = "false";
    const status = await getGraphifyRuntimeStatus();
    assert(status.enabled === false, "USE_GRAPHIFY=false should disable Graphify");
    assert(status.forcedDisabled === true, "Graphify status should report forced disabled");

    const fallbackSkill = await loadGraphFallbackSkill();
    assert(fallbackSkill?.name === "graph_fallback", "Fallback graph skill should be loaded");

    const summaryText = graphFallbackDirectAnswer(
      "Print the graph fallback skill name and summary.",
      fallbackSkill,
    );
    assert(summaryText, "Founder’s Chat should return fallback skill summary");
    assert(
      summaryText.includes("graph_fallback"),
      "Founder’s Chat should print fallback skill name",
    );
    assert(summaryText.includes("Summary"), "Founder’s Chat should print fallback skill summary");

    const fullText = graphFallbackDirectAnswer(
      "Print all exact contents of the graph fallback skill.",
      fallbackSkill,
    );
    assert(fullText === fallbackSkill.content, "Fallback skill exact-print should return SKILL.md");

    const token = `E2E_FALLBACK_MARKDOWN_${Date.now()}`;
    const advisor = await postJson<{ advisor: Advisor }>(baseUrl, "/api/advisors", {
      name: `E2E Fallback ${Date.now()}`,
      description: "Temporary advisor for fallback skill validation.",
    });
    advisorId = advisor.advisor.id;
    const markdownSource = await importTextSource(
      baseUrl,
      advisorId,
      "E2E Fallback Markdown Source",
      `# Fallback Markdown Context\n\n${token}: fallback markdown imports should stay retrievable without Graphify.`,
    );
    assert(markdownSource.kind === "text", "Markdown text import should be accepted as text");

    const context = await buildBuddyAnswerContext(advisorId, undefined, token);
    assert(context, "Fallback context compiler should load temporary advisor");
    assert(context.graphifyEnabled === false, "Context compiler should observe USE_GRAPHIFY=false");
    assert(
      context.graphFallbackSkill?.name === "graph_fallback",
      "Context should include fallback skill",
    );
    assert(
      context.advisorHits.some((hit) => hit.source === "fallback_skill"),
      "Fallback skill should be part of advisor retrieval when Graphify is disabled",
    );
    assert(
      context.advisorHits.some((hit) => hit.excerpt.includes(token)),
      "Markdown source token should be retrievable without Graphify",
    );

    return [
      "USE_GRAPHIFY=false loaded graph fallback skill",
      "Founder’s Chat printed fallback skill summary",
      "Founder’s Chat exact-print path exposed fallback skill contents",
      "Markdown text source stayed retrievable through fallback context",
    ];
  } finally {
    if (advisorId) {
      await fetch(`${baseUrl}/api/advisors/${advisorId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
    if (previousUseGraphify === undefined) {
      delete process.env.USE_GRAPHIFY;
    } else {
      process.env.USE_GRAPHIFY = previousUseGraphify;
    }
  }
}

function qaPass(
  brain: AdvisorBrainResponse["brain"],
  question: string,
  expectedFragments: string[],
) {
  const answer = answerQuestionFromCompiledWiki(brain, question);
  for (const fragment of expectedFragments) {
    assert(
      answer.toLowerCase().includes(fragment.toLowerCase()),
      `Q&A failed for "${question}". Expected "${fragment}" in: ${answer}`,
    );
  }
  return { question, answer };
}

function pageContent(brain: AdvisorBrainResponse["brain"], slug: string) {
  const page = brain.wikiPages.find((candidate) => candidate.slug === slug);
  assert(page, `Expected wiki page ${slug}`);
  return page.content;
}

async function getJson<T>(baseUrl: string, pathname: string): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${pathname} failed (${res.status}): ${text}`);
  return JSON.parse(text) as T;
}

async function postJson<T>(baseUrl: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${pathname} failed (${res.status}): ${text}`);
  return JSON.parse(text) as T;
}

async function patchJson<T>(baseUrl: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH ${pathname} failed (${res.status}): ${text}`);
  return JSON.parse(text) as T;
}

async function postForm<T>(baseUrl: string, pathname: string, formData: FormData): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${pathname} failed (${res.status}): ${text}`);
  return JSON.parse(text) as T;
}

async function startDevServer(port: number): Promise<DevServer> {
  const logs: string[] = [];
  const child = spawn(
    "bun",
    ["--bun", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    },
  );

  child.stdout.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next dev server exited early:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/advisors`);
      if (res.ok) return { baseUrl, process: child, logs };
    } catch {
      // Server is still starting.
    }
    await delay(500);
  }

  await stopDevServer(child);
  throw new Error(`Timed out waiting for Next dev server:\n${logs.join("")}`);
}

async function findExistingDevServer(): Promise<DevServer | null> {
  for (const port of [3000, 3001, 3002]) {
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const res = await fetch(`${baseUrl}/api/advisors`);
      if (!res.ok) continue;
      const body = (await res.json()) as { advisors?: unknown };
      const founderRes = await fetch(`${baseUrl}/api/founders/default`);
      if (Array.isArray(body.advisors) && founderRes.ok) {
        return { baseUrl, process: null, logs: [] };
      }
    } catch {
      // Port is not serving this app.
    }
  }
  return null;
}

async function stopDevServer(child: ChildProcessWithoutNullStreams | null) {
  if (!child) return;
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function findOpenPort(start: number) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No open port found from ${start} to ${start + 99}`);
}

async function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
