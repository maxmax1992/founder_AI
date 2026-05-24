# The Schema

This file defines how Marten Mickos's LLM Wiki is maintained.

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
