# Sprint Buddy Memory

Durable repo context for future agents. Keep this concise and replace stale bullets instead of appending a chat log.

## Product And Architecture

- Sprint Buddy is a local-first Founder Sprint companion with three tabs: Buddy Chat, Advisor Editor, and Daily Check-ins.
- Stack: Next 16, React 19, Bun, AI SDK v6, Tailwind 4, shadcn/Base UI-style primitives, Biome.
- UI direction: quiet operational shell with left advisor/sidebar navigation and large editor/chat surfaces; avoid marketing-page patterns.
- Storage is intentionally local-first under gitignored `data/`. This is fine for the hackathon MVP but not Vercel-durable yet.
- Advisor brains are markdown directories under `data/advisors/<advisorId>/`:
  - `profile.md`, `vision.md`, `direction.md`, `memory.md`
  - `wiki/*.md`
  - `skills/*.md`
  - `sources/*.md` plus `sources/_sources.json`
- App metadata, conversations, messages, check-ins, and model settings live in `data/index.json` via `src/lib/store.ts`.

## AI Provider And Streaming

- Shared agent entrypoint: `src/lib/ai/agents.ts`.
- Agent routes use AI SDK v6 `streamText`, `convertToModelMessages`, and `smoothStream({ chunking: "word", delayInMs: 24 })`.
- Provider selection lives in `src/lib/ai/provider.ts`.
- Default local provider path uses Codex App Server through `ai-sdk-provider-codex-cli` when `~/.codex/auth.json` exists.
- OpenAI API mode can be enabled by setting `AI_PROVIDER=openai` in `.env` and providing an `OPENAI_API_KEY`.
- The UI now supports entering the OpenAI API key directly in the sidebar settings, which is persisted in `data/index.json`. This key takes precedence over the environment variable.
- Provider modes:
  - `AI_PROVIDER=codex` / `codex-cli` / `cli`
  - `AI_PROVIDER=openai`
  - `AI_PROVIDER=gateway`
- Codex App Server settings include `approvalPolicy: "never"`, `sandboxPolicy: "read-only"`, `cwd: process.cwd()`, `idleTimeoutMs: 120_000`, and `minCodexVersion: "0.130.0"`.
- Model/thinking/verbosity settings are normalized in `src/lib/ai/model-settings.ts`, persisted through `src/lib/store.ts`, exposed at `/api/settings`, and controlled in the app header/sidebar.
- If direct OpenAI mode is selected with an exhausted key, chat surfaces provider quota errors; Codex CLI SSO avoids that path when available.

## Current UI Behavior

- `src/components/sprint-buddy-shell.tsx` is the main client shell.
- Advisor list cards are clickable and switch the active advisor.
- Add advisor is now a modal (`CreateAdvisorDialog`), not always-visible sidebar fields.
- Advisor metadata is a compact top row with name, description, save, and delete controls; the redundant “Selected advisor” heading was removed.
- Sources editor supports:
  - plain text
  - website URL import
  - YouTube transcript import
  - PDF text extraction
  - drag/drop or file picker for PDF/text/markdown/URLs/plain text
- Source import route: `src/app/api/advisors/[id]/sources/import/route.ts`.
- Source import helpers: `src/lib/source-import.ts`.
- Sources carry `kind`, `sourceUrl`, `status`, and `extractionNote`; `needs_review` is used when extraction is incomplete or unreliable.
- Advisor Skills no longer uses generic “Add page” creation. “Add skill” opens `SkillCreatorDialog`, which supports dropped context, existing source chips, a skill-creator chat, and a draft markdown editor. Inserting a skill adds it to the unsaved brain; the user must still click “Save brain” to write markdown files.
- Advisor Wiki still uses the generic page editor.
- Daily Check-ins are generated/toggled through `/api/checkins`, `/api/checkins/[id]`, and `/api/cron/checkins`; default interval is `CHECKIN_INTERVAL_DAYS=2`.

## Important Files

- `src/components/sprint-buddy-shell.tsx`: main UI, chat, model controls, advisor editor, source editor, skill creator modal.
- `src/lib/store.ts`: local persistence for advisors, brain markdown, sources, conversations, check-ins, settings.
- `src/lib/types.ts`: public interfaces and Zod request schemas.
- `src/lib/ai/provider.ts`: provider detection, model settings, Codex/OpenAI/Gateway options, provider error labels.
- `src/lib/ai/agents.ts`: shared streaming agent wrapper.
- `src/lib/ai/prompts.ts`: Buddy Chat and workshop system prompts.
- `src/lib/source-import.ts`: website, YouTube, PDF, and text source import logic.
- `src/components/ui/markdown.tsx`: markdown rendering, streaming repair, newline handling.
- `AGENTS.md`: repo instructions for conversation memory, source registry, graphify, and LLM-wiki workflow.
- `package.json`: Bun scripts and core dependencies.

## Verification Status

Latest known checks passed:

```bash
bun run lint
bun run build
```

Additional checks already performed during implementation:

- API smoke-tested source import/delete for text, website, PDF fallback, and YouTube transcript import.
- Browser checked on `http://localhost:3001/`:
  - source intake options and drop zone render without console errors;
  - `Add skill` opens the skill-creator modal;
  - `Add advisor` opens the advisor creation modal;
  - the redundant “Selected advisor” heading is gone.

## Runtime Notes

- Dev server was run on `http://localhost:3001`; port 3000 may already be occupied.
- Start locally with:

```bash
bun install
bun run dev
```

- `.env.example` defaults to Codex CLI SSO:

```bash
AI_PROVIDER=codex-cli
CODEX_CLI_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=medium
CODEX_TEXT_VERBOSITY=medium
CHECKIN_INTERVAL_DAYS=2
```

## Known Pitfalls And Follow-Ups

- `data/` is local demo state and should not be treated as production storage.
- Vercel deployment needs durable hosted storage before the app is real beyond a local demo.
- PDF, YouTube, and website extraction are best-effort; keep `needs_review` visible and do not let Buddy fabricate source-specific advice from weak extraction.
- The skill creator inserts a draft into local UI state first; saving to disk still requires “Save brain”.
- Website text extraction is simple HTML stripping, not a full readability pipeline.
- No auth, multi-user isolation, or organizer dashboard exists in this MVP.
- Add tests later for provider mode selection, model settings persistence, source import fallbacks, source deletion, markdown newline rendering, and streaming response behavior.

## LLM Wiki Workflow Reminder

- Source-of-truth corpus: `sources/`.
- Source registry: `sources/sources.json`; use `tools/wiki_sources.py` instead of hand-editing when possible.
- Curated wiki: `wiki/`.
- Generated graph layer: `graphify-out/`.
- Standard graph/wiki refresh:

```bash
graphify sources/active --update --wiki --obsidian --obsidian-dir wiki
```

- Preserve citations back to source IDs, update `wiki/index.md`, append to `wiki/log.md`, and flag contradictions instead of silently overwriting them.
