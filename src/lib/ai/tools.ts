import { tool } from "ai";
import { z } from "zod";

import {
  readAdvisorPage,
  readFounderPage,
  searchAdvisorBrain,
  searchBuddyContext,
  searchFounderBrain,
} from "@/lib/store";

export function buddyContextTools(advisorId: string, founderId: string) {
  return {
    searchBuddyContext: tool({
      description:
        "Search across selected advisor context and named founder context, using Graphify when enabled or the fallback graph skill when disabled.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => ({
        results: await searchBuddyContext(advisorId, founderId, query),
      }),
    }),
    searchAdvisorContext: tool({
      description:
        "Search only across the selected advisor context, including profile, vision, direction, wiki pages, fallback skill context when active, and sources.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => ({ results: await searchAdvisorBrain(advisorId, query) }),
    }),
    searchFounderContext: tool({
      description:
        "Graphify-aware search only across the named founder graph, including founder profile, memory, and conversation-derived graph.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => ({ results: await searchFounderBrain(founderId, query) }),
    }),
    readAdvisorPage: tool({
      description:
        "Read one full advisor page by slug. Use slugs returned by searchAdvisorContext or known slugs like profile, vision, direction, memory, and schema.",
      inputSchema: z.object({
        slug: z.string().min(1),
      }),
      execute: async ({ slug }) => {
        const page = await readAdvisorPage(advisorId, slug);
        return page ? { found: true, page } : { found: false, slug };
      },
    }),
    readFounderPage: tool({
      description:
        "Read one full founder page by slug. Use slugs returned by searchFounderContext or known slugs like profile, memory, graph.",
      inputSchema: z.object({
        slug: z.string().min(1),
      }),
      execute: async ({ slug }) => {
        const page = await readFounderPage(founderId, slug);
        return page ? { found: true, page } : { found: false, slug };
      },
    }),
  };
}
