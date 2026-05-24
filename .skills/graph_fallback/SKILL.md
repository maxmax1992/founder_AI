---
name: graph_fallback
description: Mandatory fallback context audit for Founder’s Chat when Graphify is disabled.
---

# Graph Fallback Skill

Use this skill when `USE_GRAPHIFY=false` or Graphify output is unavailable. It is the mandatory context-audit entrypoint for Founder’s Chat before answering founder questions.

## Summary

Graph Fallback is a concise routing skill. It tells the agent which local context files matter, how to inspect them, and how to keep advisor context separate from founder-private context when the Graphify knowledge graph is not active.

## Mandatory Procedure

1. Read this `SKILL.md` first.
2. Decide which referenced context files are relevant to the user’s question.
3. Read only those relevant references and backing markdown files.
4. Answer from grounded advisor, wiki, source, founder, or conversation context.
5. If the available context does not support the answer, say what is missing.
6. Include a concise audit note in normal answers: `Fallback skill consulted: graph_fallback; references used: ...`.

## References

- `references/context-map.md`: how advisor, founder, wiki, and source files map into answer context.
- `references/source-handling.md`: how to treat raw sources, weak extraction, and source-backed claims.
- `references/answer-policy.md`: how Founder’s Chat should shape answers when using fallback context.

## Exact Print Rule

If the founder asks to print all contents of this skill, return the exact contents of this `SKILL.md` file and nothing else.
