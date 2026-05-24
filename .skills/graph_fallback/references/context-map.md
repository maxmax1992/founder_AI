# Fallback Context Map

Founder’s Chat should treat the repository context as modular markdown:

- Advisor core files: `data/advisors/<advisorId>/profile.md`, `vision.md`, `direction.md`, `memory.md`, and `schema.md`.
- Advisor wiki pages: `data/advisors/<advisorId>/wiki/*.md`.
- Advisor raw sources: `data/advisors/<advisorId>/sources/*.md` plus `_sources.json` metadata.
- Founder-private files: `data/founders/<founderId>/profile.md`, `memory.md`, and `graph.md`.

Do not merge founder-private context into advisor essence. Use founder files only for the named founder’s current state, patterns, decisions, and conversation-derived memory.
