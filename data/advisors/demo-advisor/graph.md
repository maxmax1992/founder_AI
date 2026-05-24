# Graphify Brain

Advisor: Demo Advisor
Refreshed: 2026-05-23T08:23:23.351Z

## Role In The LLM Wiki

Graphify Brain is the machine-readable map for this advisor. It is the place to inspect the shape of the advisor corpus before turning it into founder-facing wiki pages, skills, and coaching responses.

- Sources are the raw evidence layer.
- Graphify Brain is the map of entities and relationships.
- Advisor Wiki is the curated human-readable synthesis.
- Buddy Chat should cite the wiki/skills when possible and admit gaps when this graph is thin.

## Corpus Snapshot

- Sources: 0 total, 0 ready, 0 need review.
- Wiki pages: 2.
- Advisor skills: 1.
- Source registry command: `python3 tools/wiki_sources.py list`.
- Project graph refresh command: `graphify sources/active --update --wiki --obsidian --obsidian-dir wiki`.

## Source Nodes

- No advisor sources captured yet.

## Wiki Nodes

- [wiki:focus-principle] Focus Principle: # Focus Principle Ask what decision this concern is trying to avoid.
- [wiki:sprint-buddy-challenge] Sprint Buddy Challenge: # Sprint Buddy Challenge Sprint Buddy is an AI companion for Founder Sprint participants. It should feel like a private coach in the founder pocket, not a survey tool or organizer...

## Skill Nodes

- [skill:hard-question-then-next-action] Hard Question, Then Next Action: # Hard Question, Then Next Action When a founder brings a vague concern, ask one precise question that reveals the avoided truth, then propose one concrete action for the next 24 ...

## Core Relationships

- profile -> grounds -> advisor responses
- vision -> sets_outcome -> advisor responses
- direction -> constrains_style -> advisor responses
- founder-memory -> personalizes -> advisor responses
- graphify-brain -> maps -> advisor wiki and source corpus
- wiki:focus-principle -> informs -> buddy-chat
- wiki:sprint-buddy-challenge -> informs -> buddy-chat
- skill:hard-question-then-next-action -> shapes -> response-behavior

## Curation Rules

- Treat `needs_review` sources as weak evidence until a human checks the extracted text.
- Use graph nodes to decide what wiki pages or skills are missing.
- Flag contradictions in wiki pages instead of overwriting them silently.
- Refresh this page after source imports, wiki edits, or agentic editor updates.