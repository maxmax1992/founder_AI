# Graph Report - .  (2026-05-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 9 nodes · 7 edges · 3 communities (2 shown, 1 thin omitted)
- Extraction: 71% EXTRACTED · 29% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e2f1bbb1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]

## God Nodes (most connected - your core abstractions)
1. `Marten Mickos` - 5 edges
2. `Eucalyptus Systems` - 3 edges
3. `MySQL` - 1 edges
4. `HackerOne` - 1 edges
5. `Amazon Web Services (AWS)` - 1 edges
6. `OpenStack` - 1 edges
7. `Founder Operating Principles` - 1 edges
8. `Founder's Harness Challenge` - 1 edges
9. `Marten Mickos Tweets - Part 19` - 0 edges

## Surprising Connections (you probably didn't know these)
- `Founder Operating Principles` --references--> `Marten Mickos`  [INFERRED]
  advisors/marten-mickos/wiki/founder-operating-principles.md → advisors/marten-mickos/wiki/source-index.md
- `Founder's Harness Challenge` --conceptually_related_to--> `Marten Mickos`  [INFERRED]
  advisors/marten-mickos/wiki/founders-harness-challenge.md → advisors/marten-mickos/wiki/source-index.md
- `Marten Mickos` --references--> `Eucalyptus Systems`  [EXTRACTED]
  advisors/marten-mickos/wiki/source-index.md → advisors/marten-mickos/sources/marten-mickos-tweets/chunk-019.md
- `Marten Mickos` --references--> `MySQL`  [EXTRACTED]
  advisors/marten-mickos/wiki/source-index.md → advisors/marten-mickos/sources/marten-mickos-tweets/chunk-019.md
- `Marten Mickos` --references--> `HackerOne`  [EXTRACTED]
  advisors/marten-mickos/wiki/source-index.md → advisors/marten-mickos/wiki/compiled-source-signals.md

## Communities (3 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.4
Nodes (5): Founder Operating Principles, Founder's Harness Challenge, HackerOne, Marten Mickos, MySQL

### Community 1 - "Community 1"
Cohesion: 0.67
Nodes (3): Amazon Web Services (AWS), Eucalyptus Systems, OpenStack

## Knowledge Gaps
- **7 isolated node(s):** `Marten Mickos Tweets - Part 19`, `MySQL`, `HackerOne`, `Amazon Web Services (AWS)`, `OpenStack` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Marten Mickos` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.643) - this node is a cross-community bridge._
- **Why does `Eucalyptus Systems` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.393) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Marten Mickos` (e.g. with `Founder Operating Principles` and `Founder's Harness Challenge`) actually correct?**
  _`Marten Mickos` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Marten Mickos Tweets - Part 19`, `MySQL`, `HackerOne` to the rest of the system?**
  _7 weakly-connected nodes found - possible documentation gaps or missing edges._