import { tool } from "ai";
import { z } from "zod";

import { getAdvisorBrain, readAdvisorPage, searchAdvisorBrain } from "@/lib/store";

export function advisorTools(advisorId: string) {
  return {
    searchAdvisorWiki: tool({
      description:
        "Search the selected advisor brain across profile, vision, direction, memory, graphify brain, wiki pages, skills, and sources.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => ({ results: await searchAdvisorBrain(advisorId, query) }),
    }),
    readAdvisorPage: tool({
      description:
        "Read one full advisor page by slug. Use slugs returned by searchAdvisorWiki or known slugs like profile, vision, direction, memory, graph.",
      inputSchema: z.object({
        slug: z.string().min(1),
      }),
      execute: async ({ slug }) => {
        const page = await readAdvisorPage(advisorId, slug);
        return page ? { found: true, page } : { found: false, slug };
      },
    }),
    listAdvisorSkills: tool({
      description: "List the selected advisor skills available for coaching behavior.",
      inputSchema: z.object({}),
      execute: async () => {
        const brain = await getAdvisorBrain(advisorId);
        return { skills: brain?.skills ?? [] };
      },
    }),
  };
}
