# Sprint Buddy Knowledge Base Instructions

This repository uses the LLM Wiki pattern with graphify as the machine-readable
graph layer.

## Conversation Memory

- Keep `MEMORY.md` current after substantive conversations or code changes.
- Update it before the final response when the durable project state changes:
  architecture decisions, important files, verification commands, runtime notes,
  known pitfalls, or open follow-ups.
- Keep entries concise. Prefer replacing stale bullets with the latest truth over
  appending a chat log.
- Do not record trivial turns, temporary debugging noise, or information already
  captured clearly elsewhere.

## Layers

- `sources/` is the source-of-truth corpus. Do not rewrite source files while
  ingesting them.
- `sources/sources.json` is the source registry. Use `tools/wiki_sources.py`
  instead of hand-editing it unless a small manual fix is clearly safer.
- `wiki/` is the LLM-maintained human-readable wiki. The LLM may create, edit,
  split, and remove wiki pages as the corpus evolves.
- `graphify-out/` is generated graphify output. Treat it as rebuildable.

## Source Workflow

Use these commands from the repository root:

```bash
python3 tools/wiki_sources.py add <file-or-dir> --title "Source title" --advisor marten --tags founder-sprint,marten
python3 tools/wiki_sources.py list
python3 tools/wiki_sources.py edit <source-id> --title "Better title" --tags tag-a,tag-b
python3 tools/wiki_sources.py remove <source-id>
python3 tools/wiki_sources.py restore <source-id>
python3 tools/wiki_sources.py graphify-command
```

Source statuses:

- `active`: included in the next graphify/wiki refresh.
- `draft`: captured in the registry but not yet included.
- `removed`: excluded from active refreshes; files are moved under
  `sources/archive/` when possible.

## Graphify + Wiki Workflow

1. Add or edit sources with `tools/wiki_sources.py`.
2. Run graphify on the active corpus:

   ```bash
   python3 -m graphify extract sources/active --out .
   ```

3. Read `graphify-out/GRAPH_REPORT.md` and the generated wiki/community pages.
4. Update the LLM wiki layer in `wiki/`:
   - preserve citations back to source IDs from `sources/sources.json`;
   - update `wiki/index.md`;
   - append an entry to `wiki/log.md`;
   - flag contradictions instead of silently overwriting them.

Graphify is allowed to suggest structure; the LLM wiki remains the curated,
founder-facing knowledge artifact.

## `/graphify`

When the user types `/graphify`, invoke the graphify skill before doing anything
else. If no path is given, use the repository root.

## graphify

This project has a graphify knowledge graph at graphify-out/.

This machine may have Graphify installed as a Python module while the `graphify`
entrypoint is outside `PATH`. Prefer `python3 -m graphify ...` unless
`command -v graphify` succeeds. For the app viewer, refresh the graph with:

```bash
python3 tools/graphify_refresh.py
```

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `python3 -m graphify query "<question>"`, `python3 -m graphify path "<A>" "<B>"`, or `python3 -m graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `python3 tools/graphify_refresh.py` to keep the app graph current without relying on legacy graph.md files
