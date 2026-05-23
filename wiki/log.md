# Wiki Log

Append-only history of source ingests, graph refreshes, wiki edits, and lint
passes.

Use entries like:

```markdown
## [2026-05-22] ingest | Source title

- Source ID: `20260522-source-title`
- Changed pages: `wiki/index.md`
- Notes: Initial source ingest.
```

## [2026-05-22] graph | Advisor Graphify Brain

- Changed pages: `wiki/index.md`, `LLM_WIKI.md`, `MEMORY.md`
- Notes: Added per-advisor `graph.md` as the default Graphify Brain concept for Sprint Buddy advisor contexts, with an editor refresh path and local MCP-backed agentic editor workflow.
- Verification: Browser E2E covered Buddy Chat tips, Advisor Editor graph refresh/save, and Advisor Agentic Editor graph refresh through the local advisor MCP path.

## [2026-05-23] graph-ui | Advisor Graph View

- Changed pages: `wiki/index.md`, `LLM_WIKI.md`, `MEMORY.md`
- Notes: Added a zoomable, clickable Graphify Brain node view in Advisor Editor, with node text and relationship inspection similar to Obsidian graph view.
- Verification: Lint/build passed; browser automation verified zoom and selecting a `Focus Principle` graph node updates the inspector text.
