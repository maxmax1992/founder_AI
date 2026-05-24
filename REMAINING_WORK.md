# Remaining Work

Audit date: 2026-05-24
Scope: current repository, local demo data, Graphify output, and the Aalto Founder Sprint challenge brief.

## Executive Read

The repo has a strong local-first prototype shell for Founder's harness: chat,
advisor editing, source ingestion, LLM Wiki compilation, Graphify visualization,
fallback context routing, settings, chat history, and daily check-in generation
all exist and currently pass the local verification suite.

The project is not yet challenge-ready because the required Marten advisor is
not actually grounded in Marten's supplied material. The raw documents exist
under `marten/`, but the app-level Marten source registry is empty, the root
LLM Wiki source registry is empty, and the refreshed Graphify graph contains
only one Marten node. For judging, this is the main gap: the shell is credible,
but the required advisor knowledge base is still mostly unindexed.

## Challenge Alignment

| Challenge ask | Current state | Gap / risk | Required next step |
| --- | --- | --- | --- |
| Required: Marten advisor | `marten-mickos` advisor exists; source import, wiki compilation, Graphify graph, and chat context plumbing exist. | Marten has no imported sources in `data/advisors/marten-mickos/sources/_sources.json`; `sources/sources.json` is empty; `graphify-out/graph.json` has only one Marten node. | Import and compile the real Marten corpus, then verify source-grounded answers. |
| Required: Daily check-ins | API routes, cadence setting, fallback/AI generation, todo UI, and done/todo toggling exist. | Check-ins are prompts only. They do not capture founder responses, feed founder memory, or reflect patterns back over time. | Add response capture, private storage, memory/graph update, and pattern reflection. |
| Stretch: Founder profiling | Private founder profile exists; chat sidebar contains a Working Genius-style mock panel. | The Working Genius/profile signal is static UI, not computed from onboarding, chat, or check-ins. | Implement a real profile model or clearly label this as demo-only. |
| Stretch: Organizer signal | No real organizer attention view. | Challenge explicitly warns against making founders feel monitored; any organizer feature needs a privacy boundary. | Add only after private founder value is solid: weekly attention signals with explicit consent and no raw private text. |
| Extensibility | Add-advisor flow, per-advisor brain files, source import, and wiki compile path exist. | There are two source concepts: root `sources/sources.json` and app-local `data/advisors/*/sources/_sources.json`; they are not unified. | Decide which registry is authoritative for the demo and make the other sync or disappear from the critical path. |
| Technical execution | Lint, typecheck, E2E, Graphify refresh, and build pass. | `bun run build` emits a Turbopack NFT warning from the local directory import route. `data/` and `graphify-out/` are gitignored, so a fresh checkout may not have demo-ready state. | Fix deploy packaging risk and add a seed/import runbook or seed script. |

## What Exists Now

- A local-first Next/Bun app with three main surfaces: Founder's Chat, Advisor Editor, and Daily Check-ins.
- Advisor Editor with advisor metadata, `Advisor LLM`, `Wiki`, and `Manager` tabs.
- Wiki workspace with `Raw sources`, `Wiki pages`, `Core nodes`, `Schema`, and `Graph` layers.
- Source import for text, website URL, YouTube transcript, PDF, `.docx`, drag/drop, and local directory import.
- Deterministic LLM Wiki compilation from imported advisor sources into source index, source signals, and operating-principle pages.
- Graphify-first graph viewer using `graphify-out/graph.json`; legacy `graph.md` is filtered out of the visible graph.
- Founder's Chat context builder that separates advisor context from founder-private profile, memory, and graph.
- AI SDK `queryGraphify` tool that traverses `graphify-out/graph.json` for graph/source relationship questions.
- Fallback skill path for `USE_GRAPHIFY=false` or missing Graphify artifacts.
- Settings for provider/model/thinking/verbosity/OpenAI key and check-in cadence.
- Conversation history and hydration by conversation URL.
- Daily check-in API/UI with generated prompts and done/todo toggles.

## Current Verification

Passed during this audit:

```bash
bun run lint
bunx tsc --noEmit --incremental false
python3 tools/graphify_refresh.py
bun run e2e:llm-wiki
bun run build
```

Important details:

- `python3 tools/graphify_refresh.py` rebuilt `graphify-out/graph.json`,
  `GRAPH_REPORT.md`, `graph.html`, and `GRAPH_TREE.html`.
- The refreshed graph has 13 nodes and 6 edges.
- Only 1 refreshed graph node comes from `advisors/marten-mickos`; 11 come from
  `demo-advisor`.
- `python3 tools/wiki_sources.py list` reports `No sources found.`
- `bun run build` passes, but warns that the local directory import route traces
  the whole project through dynamic filesystem access.

## P0 Before Demo

1. Index the real Marten corpus.

   The supplied corpus exists in `marten/`:

   - `Aalto Founder Sprint Book List.doc`
   - `Great Quotes Sept 2009.doc`
   - `Marten Mickos Articles on LinkedIn.docx`
   - `Marten Mickos Online Resources.docx`
   - `Marten Mickos Quora Answers.docx`
   - `Marten Mickos Social Media Postings.docx`
   - `Marten Mickos Tweets.doc`

   Current import supports `.docx`, PDF, text, markdown, websites, and YouTube,
   but not legacy `.doc`. Convert the `.doc` files or add `.doc` extraction.
   Success criteria: Marten advisor has imported sources, source metadata is not
   empty, and Graphify shows multiple Marten source/wiki nodes.

2. Compile a real Marten wiki.

   After importing, run the source compile flow so Marten has durable pages for
   frameworks, repeated principles, quotes/stories, source index, weak extraction
   notes, and contradictions. The app should stop warning that the advisor wiki
   is thin for ordinary founder questions.

3. Verify Marten answers against the challenge.

   Run a small source-grounded answer suite against `marten-mickos`:

   - "I need to have a hard conversation with my co-founder tomorrow."
   - "Should I keep building or talk to customers first?"
   - "A VC disagreed with our framing. What should I do next?"
   - "What would Marten say about deciding fast under uncertainty?"

   Pass condition: answers use Marten/source/wiki evidence, name the real issue,
   ask one hard question, and end with one concrete next action. If source
   evidence is missing, the answer must say so instead of inventing.

4. Make daily check-ins a real private loop.

   Add response capture, not just task toggling. Each check-in should let the
   founder type or skip a reflection, store it as founder-private data, update
   founder memory/graph, and later reflect patterns back. This is core to the
   challenge's "open daily without being asked" criterion.

5. Make the demo state reproducible.

   `data/` and `graphify-out/` are intentionally gitignored. That is fine for
   local experimentation but risky for a hackathon handoff. Add one of:

   - a seed script that imports the Marten corpus and refreshes Graphify;
   - a documented demo setup command sequence;
   - a committed safe sample corpus plus generated demo seed, if allowed.

6. Fix source workflow inconsistency.

   `tools/wiki_sources.py graphify-command` prints:

   ```bash
   python3 -m graphify extract sources/active --out .
   ```

   `Makefile` still runs:

   ```bash
   graphify sources/active --update --wiki --obsidian --obsidian-dir wiki
   ```

   Pick the current supported command and update the other path. Also decide
   whether root `sources/sources.json` should drive the app, mirror app-local
   advisor sources, or be removed from the demo-critical workflow.

7. Address the build warning if deployment matters.

   `bun run build` succeeds but Turbopack warns that the local directory import
   route traces the whole project. This likely comes from resolving arbitrary
   `dirPath` values. Restrict it to a known import root, development-only mode,
   or add an explicit ignore/static scope before deploying.

## P1 After Core Works

- Replace the static Working Genius mock with real founder profiling.
- Add a founder onboarding/profile flow that is useful before any chat history
  exists.
- Turn "What Founder's Chat noticed" into computed private patterns from chat
  and check-ins.
- Add an organizer signal only with explicit privacy copy and aggregate/attention
  indicators, not raw founder notes.
- Add auth and user separation before using this beyond a local demo.
- Add hosted durable storage before Vercel or multi-user use.
- Add tests for provider selection, settings persistence, source import failure
  modes, source deletion, markdown rendering, and streaming errors.
- Add `.doc` import support or a repeatable conversion step for the current
  Marten files.
- Compare the current React implementation against `Sprint Buddy v4.html` only
  after the required advisor/check-in functionality is credible.

## Acceptance Checklist

- Marten source registry is non-empty and includes all usable provided material.
- `.doc` material is either imported after conversion or explicitly marked as
  pending with a reason.
- Marten wiki contains source-indexed principles and not just the challenge
  summary.
- Graphify report shows Marten source/wiki nodes beyond `profile.md`.
- Founder's Chat can answer the required demo questions from Marten evidence.
- Daily check-ins capture private responses and feed founder memory/patterns.
- A fresh checkout can be made demo-ready through one documented command path.
- Build, lint, typecheck, Graphify refresh, and E2E pass after the Marten import.

## Recommended Order

1. Convert/import Marten corpus.
2. Compile Marten wiki and refresh Graphify.
3. Run source-grounded Marten chat QA and patch prompt/retrieval gaps.
4. Add check-in response capture and founder memory updates.
5. Add demo seeding/setup docs.
6. Clean up source workflow and build warning.
7. Implement founder profiling and organizer signal only if time remains.
