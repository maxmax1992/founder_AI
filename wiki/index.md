# Wiki Index

This is the human-readable knowledge layer for Sprint Buddy.

## Core Pages

- Advisor Graphify Brain: per-advisor `graph.md` files under `data/advisors/<advisorId>/` map sources, wiki pages, skills, and relationships for Buddy Chat and the Advisor Agentic Editor.
- Advisor Graph View: the Advisor Editor renders `graph.md` as a zoomable, clickable node map with an inspector for source/wiki/skill text.

## Sources

Source metadata lives in `sources/sources.json`. Run:

```bash
python3 tools/wiki_sources.py list
```

## Refresh Flow

1. Add or update sources with `tools/wiki_sources.py`.
2. Run graphify on `sources/active`.
3. Integrate the graphify output into wiki pages.
4. Refresh the selected advisor Graphify Brain from the Advisor Editor when advisor context changes.
5. Append the work to `wiki/log.md`.
