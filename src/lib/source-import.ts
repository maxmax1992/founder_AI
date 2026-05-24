import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { fetchTranscript } from "youtube-transcript";

import type { AdvisorSource } from "@/lib/types";

// Fix for pdfjs-dist worker in Next.js/Node environment
if (typeof process !== "undefined" && (process.env.NODE_ENV as string) !== "browser") {
  try {
    const workerPath = path.resolve(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
    PDFParse.setWorker(workerPath);
  } catch (e) {
    console.error("Failed to set PDF worker path:", e);
  }
}

export type ImportedSource = Pick<AdvisorSource, "title" | "body"> &
  Partial<Pick<AdvisorSource, "kind" | "sourceUrl" | "status" | "extractionNote">>;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function buildTextSource(title: string, body: string): ImportedSource {
  return {
    kind: "text",
    title: title || "Plain text source",
    body: withHeader(title || "Plain text source", "Plain text", undefined, body),
    status: "ready",
  };
}

export async function importWebsiteSource(url: string, title?: string): Promise<ImportedSource> {
  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) {
    throw new Error(`Website fetch failed (${res.status})`);
  }
  const html = await res.text();
  const inferredTitle = title || extractTitle(html) || new URL(url).hostname;

  // Try SPA-specific extraction first (Inertia, Next.js, etc)
  let fullText = extractSpaContent(html);

  // Fallback to traditional HTML stripping
  if (!fullText || fullText.length < 200) {
    fullText = stripHtml(html);
  }

  return {
    kind: "website",
    title: inferredTitle,
    sourceUrl: url,
    body: withHeader(inferredTitle, "Website", url, fullText),
    status: fullText.length > 50 ? "ready" : "needs_review",
    extractionNote:
      fullText.length > 50 ? undefined : "Fetched the URL but extracted very little text.",
  };
}

function extractSpaContent(html: string): string | null {
  // Inertia.js (used by YC library)
  const inertiaMatch = html.match(/data-page="([\s\S]*?)"/);
  if (inertiaMatch) {
    try {
      const json = JSON.parse(decodeEntities(inertiaMatch[1]));
      return findRichContent(json);
    } catch {}
  }

  // Next.js
  const nextMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (nextMatch) {
    try {
      const json = JSON.parse(nextMatch[1]);
      return findRichContent(json);
    } catch {}
  }

  return null;
}

/**
 * Heuristically find the "main" content in a large JSON blob by looking for
 * long strings that contain multiple sentences or common content keys.
 */
function findRichContent(obj: unknown): string | null {
  let best = "";
  const queue = [obj];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || (typeof current === "object" && seen.has(current))) continue;
    if (typeof current === "object") seen.add(current);

    if (typeof current === "string") {
      if (current.length > best.length) {
        // Simple heuristic: must have spaces and some punctuation to be prose
        if (current.includes(" ") && (current.includes(".") || current.includes("\n"))) {
          best = current;
        }
      }
    } else if (Array.isArray(current)) {
      queue.push(...current);
    } else if (typeof current === "object" && current !== null) {
      // Check for specific keys first in this specific object level
      const priorityKeys = ["content", "body", "article", "text", "description"];
      const currentObj = current as Record<string, unknown>;
      for (const key of priorityKeys) {
        if (typeof currentObj[key] === "string" && currentObj[key].length > 500) {
          return currentObj[key] as string;
        }
      }

      for (const k in currentObj) {
        try {
          queue.push(currentObj[k]);
        } catch {
          // Ignore potential getter errors
        }
      }
    }
  }

  return best.length > 100 ? best : null;
}

export async function importYoutubeSource(url: string, title?: string): Promise<ImportedSource> {
  const inferredTitle = title || (await fetchYoutubeTitle(url)) || "YouTube video";
  try {
    const transcript = await fetchTranscript(url);
    const fullText = transcript
      .map((item) => `[${formatSeconds(item.offset / 1000)}] ${item.text}`)
      .join("\n");

    return {
      kind: "youtube",
      title: inferredTitle,
      sourceUrl: url,
      body: withHeader(inferredTitle, "YouTube transcript", url, fullText),
      status: "ready",
    };
  } catch (err) {
    const note = err instanceof Error ? err.message : "Transcript extraction failed.";
    return {
      kind: "youtube",
      title: inferredTitle,
      sourceUrl: url,
      body: withHeader(
        inferredTitle,
        "YouTube video",
        url,
        [
          "Transcript was not available through the automatic extractor.",
          "Paste transcript, notes, or key excerpts into this source before relying on advisor-specific claims.",
        ].join("\n\n"),
      ),
      status: "needs_review",
      extractionNote: note,
    };
  }
}

export async function importPdfSource(file: File, title?: string): Promise<ImportedSource> {
  const inferredTitle = title || file.name.replace(/\.pdf$/i, "") || "PDF source";
  const buffer = Buffer.from(await file.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const fullText = result.text.trim();

    return {
      kind: "pdf",
      title: inferredTitle,
      sourceUrl: file.name,
      body: withHeader(inferredTitle, "PDF", file.name, fullText),
      status: fullText ? "ready" : "needs_review",
      extractionNote: fullText ? undefined : "PDF parsed, but no text was extracted.",
    };
  } catch (err) {
    return {
      kind: "pdf",
      title: inferredTitle,
      sourceUrl: file.name,
      body: withHeader(
        inferredTitle,
        "PDF",
        file.name,
        "PDF upload was captured, but automatic text extraction failed. Paste selected excerpts here before distilling into the advisor wiki.",
      ),
      status: "needs_review",
      extractionNote: err instanceof Error ? err.message : "PDF extraction failed.",
    };
  } finally {
    await parser.destroy();
  }
}

export async function importDocxSource(file: File, title?: string): Promise<ImportedSource> {
  const inferredTitle = title || file.name.replace(/\.docx$/i, "") || "Word source";
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    const fullText = result.value.trim();

    return {
      kind: "docx",
      title: inferredTitle,
      sourceUrl: file.name,
      body: withHeader(inferredTitle, "Word (.docx)", file.name, fullText),
      status: fullText ? "ready" : "needs_review",
      extractionNote: fullText ? undefined : "Word file parsed, but no text was extracted.",
    };
  } catch (err) {
    return {
      kind: "docx",
      title: inferredTitle,
      sourceUrl: file.name,
      body: withHeader(
        inferredTitle,
        "Word (.docx)",
        file.name,
        "Word upload was captured, but automatic text extraction failed. Paste selected excerpts here before distilling into the advisor wiki.",
      ),
      status: "needs_review",
      extractionNote: err instanceof Error ? err.message : "Word extraction failed.",
    };
  }
}

function withHeader(title: string, kind: string, url: string | undefined, content: string) {
  return [
    `# ${title}`,
    "",
    `Source type: ${kind}`,
    url ? `Source URL/file: ${url}` : undefined,
    "",
    content.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

function stripHtml(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function extractTitle(html: string) {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
}

async function fetchYoutubeTitle(url: string) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    );
    if (!res.ok) return "";
    const json = (await res.json()) as { title?: string };
    return json.title ?? "";
  } catch {
    return "";
  }
}

function decodeEntities(value: string) {
  if (!value) return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function formatSeconds(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
