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
   graphify sources/active --update --wiki --obsidian --obsidian-dir wiki
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
