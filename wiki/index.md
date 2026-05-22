# Wiki Index

This is the human-readable knowledge layer for Sprint Buddy.

## Core Pages

- No generated pages yet.

## Sources

Source metadata lives in `sources/sources.json`. Run:

```bash
python3 tools/wiki_sources.py list
```

## Refresh Flow

1. Add or update sources with `tools/wiki_sources.py`.
2. Run graphify on `sources/active`.
3. Integrate the graphify output into wiki pages.
4. Append the work to `wiki/log.md`.

