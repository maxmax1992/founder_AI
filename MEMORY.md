# Founder's harness Memory

Durable repo context for future agents. Keep this concise and replace stale bullets instead of appending a chat log.

## Product And Architecture

- Founder's harness is a local-first Founder Sprint companion with three tabs: Founder's Chat, Advisor Editor, and Daily Check-ins.
- Stack: Next 16, React 19, Bun, AI SDK v6, Tailwind 4, shadcn/Base UI-style primitives, Biome.
- UI direction: quiet operational shell with left advisor/sidebar navigation and large editor/chat surfaces; avoid marketing-page patterns.
- Storage is intentionally local-first under gitignored `data/`. This is fine for the hackathon MVP but not Vercel-durable yet.
- Advisor brains are markdown directories under `data/advisors/<advisorId>/` with `profile.md`, `vision.md`, `direction.md`, `memory.md`, `schema.md`, editable `wiki/*.md`, and raw `sources/*.md` plus `sources/_sources.json`.
- Advisor-specific `graph.md` and advisor `skills/*.md` are deprecated for now. Graphify/`graphify-out` is the preferred graph layer; when `USE_GRAPHIFY=false` or usable `graphify-out` artifacts are missing, Founder's Chat must audit the single local fallback skill at `.skills/graph_fallback/SKILL.md`.
- Founder brains are separate private markdown directories under `data/founders/<founderId>/` with `profile.md`, `memory.md`, and `graph.md`; Founder's Chat uses advisor and founder context together but keeps them disconnected in storage.
- App metadata, advisors, founders, conversations, messages, check-ins, model settings, and check-in cadence live in `data/index.json` via `src/lib/store.ts`.

## AI Provider And Streaming

- Shared agent entrypoint: `src/lib/ai/agents.ts`.
- Agent routes use AI SDK v6 `streamText`, `convertToModelMessages`, and `smoothStream({ chunking: "word", delayInMs: 24 })`.
- Provider selection lives in `src/lib/ai/provider.ts`.
- Default local provider path uses Codex App Server through `ai-sdk-provider-codex-cli` when `~/.codex/auth.json` exists.
- OpenAI API mode can be enabled by setting `AI_PROVIDER=openai` in `.env` and providing an `OPENAI_API_KEY`.
- The UI supports entering the OpenAI API key through the sidebar Settings gear, which is persisted in `data/index.json`. This key takes precedence over the environment variable.
- Provider modes:
  - `AI_PROVIDER=codex` / `codex-cli` / `cli`
  - `AI_PROVIDER=openai`
  - `AI_PROVIDER=gateway`
- Codex App Server settings include `approvalPolicy: "never"`, `sandboxPolicy: "read-only"`, `cwd: process.cwd()`, `idleTimeoutMs: 120_000`, and `minCodexVersion: "0.130.0"`.
- Model/thinking/verbosity and daily check-in frequency settings are normalized in `src/lib/ai/model-settings.ts`, persisted through `src/lib/store.ts`, exposed at `/api/settings`, and controlled from the sidebar Settings gear.
- If direct OpenAI mode is selected with an exhausted key, chat surfaces provider quota errors; Codex CLI SSO avoids that path when available.

## Current UI Behavior

- `src/components/sprint-buddy-shell.tsx` is the main client shell.
- Advisor list cards are clickable and switch the active advisor.
- Add advisor is now a modal (`CreateAdvisorDialog`), not always-visible sidebar fields.
- The left sidebar keeps navigation lean; model controls moved out of the always-visible sidebar card into a `Settings` gear under navigation.
- The sidebar product brand is a serif italic `Founder's harness` wordmark without the former `s` logo mark; app metadata and user-facing prompt/default copy use the same product name.
- The left sidebar shows a `Chats` history section below Settings for the active advisor. Rows use short last-interacted labels like `1h`, `2d`, or `1w`; selecting a row restores the saved Founder's Chat conversation and its previous messages.
- Settings now includes a private founder profile section; the displayed founder name is passed into Founder's Chat as distinct founder context instead of being mixed into the selected advisor.
- Advisor Editor uses a compact advisor selector header instead of a fixed-width advisor list column, leaving the editor tabs and Manager area full-width.
- Advisor metadata is a compact top row with name, description, save, and delete controls; the redundant “Selected advisor” heading was removed.
- Advisor Editor body is tabbed into `Advisor LLM`, `Wiki`, and `Manager` sections. The separate top-level `Skills` and `Sources` editor surfaces were removed; source and graph work now lives inside Wiki.
- Advisor Editor tab panels are flex-height workspaces: in fullscreen desktop, every active tab panel fills the available editor region instead of ending halfway down the canvas. Wiki and Manager keep their own inner scroll/flex areas.
- Advisor brain edits in `Advisor LLM` and Wiki autosave through `/api/advisors/[id]/brain` after a short debounce; the `Save brain` button remains as an immediate flush/retry action. Autosave requests are serialized so stale writes do not overwrite newer edits.
- The Wiki tab is the coherent LLM Wiki workspace with layers for `Raw sources`, `Wiki pages`, `Core nodes`, `Schema`, and `Graph`. It uses a toggleable `Library` rail for files/pages, embeds Raw sources import/listing inside Wiki, and prefers Graphify/`graphify-out` artifacts for node browsing.
- Sources editor supports:
  - plain text
  - website URL import
  - YouTube transcript import
  - PDF text extraction
  - drag/drop or file picker for PDF/text/markdown/URLs/plain text
- Source import route: `src/app/api/advisors/[id]/sources/import/route.ts`.
- Source import helpers: `src/lib/source-import.ts`.
- Sources carry `kind`, `sourceUrl`, `status`, and `extractionNote`; `needs_review` is used when extraction is incomplete or unreliable.
- Word `.docx` imports preserve `kind: "docx"` and are supported through file/drop import and local-directory import.
- Advisor source create/update/delete now auto-compiles the deterministic LLM wiki; `needs_review` sources remain weak evidence and do not drive core advisor operating-principle pages.
- Manager direct commands can still compile the current source inventory into deterministic wiki pages and remove a named source before recompiling the wiki. The implementation is in `src/lib/llm-wiki-workshop.ts`; the chat route intercepts compile/remove requests before falling back to provider streaming.
- Founder's Chat context is compiled through `src/lib/buddy-context.ts` and uses graphify-aware scoped retrieval from `src/lib/graphify-retrieval.ts`; hits are labeled as text, graph, or hybrid retrieval. Chat completion updates founder `memory.md`/`graph.md`, not advisor memory.
- When `USE_GRAPHIFY=false` or Graphify is unavailable, Founder's Chat loads `.skills/graph_fallback/SKILL.md` and `references/*.md`, handles exact skill print and name/summary requests deterministically, and includes fallback skill/references in scoped retrieval.
- Daily Check-ins are generated/toggled through `/api/checkins`, `/api/checkins/[id]`, and `/api/cron/checkins`; generation cadence is stored as `settings.checkins.intervalDays` and edited in Settings.

## Important Files

- `src/components/sprint-buddy-shell.tsx`: main UI, Founder's Chat, model controls, advisor editor, Wiki workspace, source import, and Graphify/fallback graph view.
- `src/lib/store.ts`: local persistence for advisors, brain markdown, sources, conversations, check-ins, settings.
- `src/lib/types.ts`: public interfaces and Zod request schemas.
- `src/lib/ai/provider.ts`: provider detection, model settings, Codex/OpenAI/Gateway options, provider error labels.
- `src/lib/ai/agents.ts`: shared streaming agent wrapper.
- `src/lib/buddy-context.ts`: builds Founder's Chat answer context from selected advisor profile/wiki/source/schema context plus the active founder profile/memory/graph and optional graph fallback skill.
- `src/lib/graphify-retrieval.ts`: graph-aware retrieval harness that ranks direct text matches plus graph-connected advisor/founder nodes and fallback skill references.
- `src/lib/graphify-config.ts`: central `USE_GRAPHIFY` runtime switch and safe `graphify-out` artifact reader.
- `src/lib/graph-fallback-skill.ts`: local fallback skill loader, deterministic exact-print/summary response logic, and fallback audit note helper.
- `src/lib/ai/prompts.ts`: Founder's Chat and workshop system prompts; names both Advisor and Founder explicitly and keeps advisor essence separate from founder-private context.
- `src/lib/ai/tools.ts`: Founder's Chat query tools expose scoped advisor search, scoped founder search, and combined context search.
- `src/lib/source-import.ts`: website, YouTube, PDF, and text source import logic.
- `src/lib/llm-wiki-workshop.ts`: deterministic Manager source compile/remove actions, duplicate-source collapse, compiled wiki Q&A helper, and semantic wiki digest used by the E2E.
- `src/app/api/founders/default`: read/update API for the local founder profile/memory/graph used by Settings and Founder's Chat.
- `src/app/api/graphify/status` and `src/app/api/graphify/artifact`: expose Graphify runtime state, fallback skill metadata, and whitelisted `graphify-out` artifacts for the Wiki Graph layer.
- `src/app/api/conversations`: read API for advisor conversation history and saved message hydration.
- `tools/e2e-llm-wiki.ts`: HTTP E2E for DOCX import, duplicate import stability, source compile/remove through Manager, and multiple source-grounded Q&A passes.
- `src/components/ui/markdown.tsx`: markdown rendering, streaming repair, newline handling.
- `AGENTS.md`: repo instructions for conversation memory, source registry, graphify, and LLM-wiki workflow.
- `package.json`: Bun scripts and core dependencies.

## Verification Status

Latest known checks passed:

```bash
bun run lint
bunx tsc --noEmit --incremental false
bun run e2e:llm-wiki
```

Additional checks already performed during implementation:

- LLM Wiki source E2E verified against the local app with `bun run e2e:llm-wiki`: it imports `marten/Marten Mickos Social Media Postings.docx`, confirms source import auto-compiles wiki pages, confirms duplicate imports keep the semantic digest stable, adds a temporary evidence-checkpoint source and confirms Q&A finds it, verifies Founder's Chat updates founder memory/graph without writing founder tokens into advisor files, verifies the context compiler retrieves advisor and founder evidence separately, verifies fallback skill exact/summary paths under `USE_GRAPHIFY=false`, removes the marker source through Manager chat, and confirms Q&A no longer answers from removed information.
- Advisor brain autosave verified on `http://localhost:3000/` by appending a temporary marker through `/api/advisors/demo-advisor/brain`, confirming `data/advisors/demo-advisor/direction.md` contained it, then restoring the original content.
- LLM Wiki layer UI verified on `http://localhost:3000/`: opened Advisor Editor -> Wiki, confirmed `Raw sources`, `Wiki pages`, `Core nodes`, `Schema`, and `Graph` layer tabs, confirmed the `Library` rail is the file/page browser, and confirmed `/api/advisors/demo-advisor/brain` returns schema content.
- Founder's Chat context E2E verified on `http://localhost:3000/` with a temporary advisor containing unique signal tokens in description, profile, vision, direction, memory, `schema.md`, wiki page, and raw source; Founder's Chat returned the scoped tokens, then the temporary advisor was deleted.
- Wiki-source context E2E verified on `http://localhost:3000/` with a temporary advisor containing tokens in `wiki/focus-principle.md`, `wiki/pricing-stance.md`, `schema.md`, and `Raw Interview Source - Pricing`; Founder's Chat returned each token with the expected layer and file/source location, then the temporary advisor was deleted.
- Chat history verified on `http://localhost:3000/`: `/api/conversations?advisorId=demo-advisor` listed saved conversations, `/api/conversations/BZBV3KRGI5DCJKUa` returned hydrated messages, sidebar rows rendered as `/?conversation=...` links with short last-interacted labels, and loading the conversation URL restored the prior user and Founder's Chat messages.
- API smoke-tested source import/delete for text, website, PDF fallback, and YouTube transcript import.
- Browser checked on `http://localhost:3000/`:
  - sidebar renders a `Settings` gear under navigation and no longer shows the model settings block inline;
  - Settings dialog contains model/thinking/OpenAI key/output controls plus daily check-in frequency;
  - changing daily check-in frequency through the UI updates `/api/settings`, and restoring it returns `settings.checkins.intervalDays` to `2`;
  - Advisor Editor tab rail renders `Advisor LLM`, `Wiki`, and `Manager`;
  - Wiki renders `Raw sources`, `Wiki pages`, `Core nodes`, `Schema`, and `Graph` layers with a coherent `Library` rail;
  - fullscreen desktop layout QA at a zoomed-out 1920x1200 viewport confirmed Advisor Editor tabs and Wiki layers span the remaining editor region with only the expected page padding below;
  - Wiki Graph layer shows Graphify status, fallback skill metadata, and graphify-out artifact availability;
  - console error log is empty after reload and tab interaction.
- Earlier browser checks on `http://localhost:3001/` covered source intake/drop-zone rendering, advisor creation modal behavior, and removal of the redundant “Selected advisor” heading.

## Runtime Notes

- The preview is commonly available on `http://localhost:3000`; if that port is occupied by another app, the E2E can reuse ports 3000-3002 when `/api/advisors` matches this app or start a temporary Next dev server and stop it after cleanup.
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
```

## Known Pitfalls And Follow-Ups

- `data/` is local demo state and should not be treated as production storage.
- Vercel deployment needs durable hosted storage before the app is real beyond a local demo.
- PDF, YouTube, and website extraction are best-effort; keep `needs_review` visible and do not let Founder's Chat fabricate source-specific advice from weak extraction.
- Website text extraction is simple HTML stripping, not a full readability pipeline.
- No auth, multi-user isolation, or organizer dashboard exists in this MVP.
- Add tests later for provider mode selection, settings persistence, source import fallbacks, source deletion, markdown newline rendering, and streaming response behavior.
- `bun run build` can appear idle if a same-checkout Next dev server is already active. In that case, stop the dev server before building or rely on `bun run lint`, `bunx tsc --noEmit --incremental false`, and the targeted E2E while keeping the preview server alive.

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
