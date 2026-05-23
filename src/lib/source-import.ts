import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { fetchTranscript } from "youtube-transcript";

import type { AdvisorSource } from "@/lib/types";

export type ImportedSource = Pick<AdvisorSource, "title" | "body"> &
  Partial<Pick<AdvisorSource, "kind" | "sourceUrl" | "status" | "extractionNote">>;

const MAX_SOURCE_CHARS = 80_000;

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
      "user-agent": "SprintBuddySourceImporter/0.1",
      accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`Website fetch failed (${res.status})`);
  }
  const html = await res.text();
  const inferredTitle = title || extractTitle(html) || new URL(url).hostname;
  const text = stripHtml(html).slice(0, MAX_SOURCE_CHARS);
  return {
    kind: "website",
    title: inferredTitle,
    sourceUrl: url,
    body: withHeader(inferredTitle, "Website", url, text),
    status: text ? "ready" : "needs_review",
    extractionNote: text ? undefined : "Fetched the URL but did not extract readable text.",
  };
}

export async function importYoutubeSource(url: string, title?: string): Promise<ImportedSource> {
  const inferredTitle = title || (await fetchYoutubeTitle(url)) || "YouTube video";
  try {
    const transcript = await fetchTranscript(url);
    const text = transcript
      .map((item) => `[${formatSeconds(item.offset / 1000)}] ${item.text}`)
      .join("\n");
    return {
      kind: "youtube",
      title: inferredTitle,
      sourceUrl: url,
      body: withHeader(inferredTitle, "YouTube transcript", url, text.slice(0, MAX_SOURCE_CHARS)),
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
    const text = result.text.trim();
    return {
      kind: "pdf",
      title: inferredTitle,
      sourceUrl: file.name,
      body: withHeader(inferredTitle, "PDF", file.name, text.slice(0, MAX_SOURCE_CHARS)),
      status: text ? "ready" : "needs_review",
      extractionNote: text ? undefined : "PDF parsed, but no text was extracted.",
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
    const text = result.value.trim();
    return {
      kind: "text",
      title: inferredTitle,
      sourceUrl: file.name,
      body: withHeader(inferredTitle, "Word (.docx)", file.name, text.slice(0, MAX_SOURCE_CHARS)),
      status: text ? "ready" : "needs_review",
      extractionNote: text ? undefined : "Word file parsed, but no text was extracted.",
    };
  } catch (err) {
    return {
      kind: "text",
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
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function formatSeconds(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
