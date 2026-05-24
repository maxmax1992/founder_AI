import type { SearchHit } from "@/lib/types";

export interface RetrievalDocument {
  scope: SearchHit["scope"];
  source: SearchHit["source"];
  slug: string;
  title: string;
  text: string;
}

interface RankedDocument extends RetrievalDocument {
  score: number;
  textScore: number;
  graphScore: number;
  relationships: string[];
}

const STOPWORDS = new Set([
  "about",
  "after",
  "before",
  "context",
  "does",
  "founder",
  "from",
  "graph",
  "handle",
  "should",
  "the",
  "what",
  "where",
  "which",
  "with",
]);

export function graphifyRetrieve(documents: RetrievalDocument[], query: string, limit = 6) {
  const tokens = queryTokens(query);
  const documentByKey = new Map(documents.map((doc) => [docKey(doc), doc]));
  const ranked = new Map<string, RankedDocument>();
  for (const doc of documents) {
    const textScore = scoreText(tokens, `${doc.title}\n${doc.slug}\n${doc.text}`);
    ranked.set(docKey(doc), {
      ...doc,
      score: textScore,
      textScore,
      graphScore: 0,
      relationships: [],
    });
  }

  const graphRows = documents
    .filter((doc) => doc.source === "graph")
    .flatMap((doc) => graphRelationshipRows(doc.text));
  const directlyMatchedKeys = new Set(
    [...ranked.values()].filter((doc) => doc.textScore > 0).map((doc) => docKey(doc)),
  );

  for (const row of graphRows) {
    const rowTokens = scoreText(tokens, row);
    const refs = referencedDocumentKeys(row, documentByKey);
    const touchesDirectHit = refs.some((key) => directlyMatchedKeys.has(key));
    const boost = rowTokens > 0 ? 4 + rowTokens : touchesDirectHit ? 2 : 0;
    if (boost === 0) continue;

    const targetRefs = new Set([
      ...(refs.length > 0 ? refs : []),
      ...graphDocumentKeysForScope(row, documents),
    ]);
    for (const key of targetRefs) {
      const doc = ranked.get(key);
      if (!doc) continue;
      doc.graphScore += boost;
      if (!doc.relationships.includes(row)) doc.relationships.push(row);
    }
  }

  return [...ranked.values()]
    .map((doc) => ({
      ...doc,
      score: doc.textScore + doc.graphScore,
    }))
    .filter((doc) => doc.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((doc): SearchHit => {
      const retrieval =
        doc.textScore > 0 && doc.graphScore > 0 ? "hybrid" : doc.graphScore > 0 ? "graph" : "text";
      return {
        scope: doc.scope,
        source: doc.source,
        slug: doc.slug,
        title: doc.title,
        excerpt: doc.textScore > 0 ? excerpt(doc.text, tokens) : doc.relationships[0] || "",
        score: doc.score,
        retrieval,
        relationships: doc.relationships.slice(0, 3),
      };
    });
}

function queryTokens(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function scoreText(tokens: string[], text: string) {
  if (tokens.length === 0) return 1;
  const lower = text.toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function excerpt(text: string, tokens: string[]) {
  const clean = text.replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const index = tokens
    .map((token) => lower.indexOf(token))
    .filter((item) => item >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (index ?? 0) - 100);
  return clean.slice(start, start + 420);
}

function docKey(doc: Pick<RetrievalDocument, "source" | "slug">) {
  return `${doc.source}:${doc.slug}`;
}

function graphRelationshipRows(graphText: string) {
  return graphText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line.includes("->") || /^[a-z-]+:[^\s]+/.test(line));
}

function referencedDocumentKeys(row: string, documentByKey: Map<string, RetrievalDocument>) {
  const refs = new Set<string>();
  for (const explicit of row.matchAll(
    /\b(profile|vision|direction|memory|schema|graph|wiki|fallback_skill|fallback_reference|source):([a-z0-9-]+)/gi,
  )) {
    const key = `${explicit[1].toLowerCase()}:${explicit[2].toLowerCase()}`;
    if (documentByKey.has(key)) refs.add(key);
  }

  const normalized = row.toLowerCase();
  const aliases: Array<[RegExp, string]> = [
    [/\badvisor-memory\b/, "memory:memory"],
    [/\bfounder-memory\b/, "memory:memory"],
    [/\bfounder-profile\b|\bprofile\b/, "profile:profile"],
    [/\badvisor-graph\b|\bfounder-graph\b/, "graph:graph"],
  ];
  for (const [pattern, key] of aliases) {
    if (pattern.test(normalized) && documentByKey.has(key)) refs.add(key);
  }

  return [...refs];
}

function graphDocumentKeysForScope(row: string, documents: RetrievalDocument[]) {
  const scope = row.toLowerCase().includes("founder") ? "founder" : "advisor";
  return documents
    .filter((doc) => doc.scope === scope && doc.source === "graph")
    .map((doc) => docKey(doc));
}
