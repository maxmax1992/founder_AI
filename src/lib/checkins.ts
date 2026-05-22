import { generateObject } from "ai";
import { z } from "zod";

import { getCodexModelSettings, hasModelCredentials } from "@/lib/ai/provider";
import type { Advisor, AdvisorBrain, CheckinItem } from "@/lib/types";

const checkinSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        prompt: z.string().min(1).max(260),
      }),
    )
    .min(2)
    .max(3),
});

export async function generateCheckinDrafts(advisor: Advisor, brain: AdvisorBrain) {
  if (hasModelCredentials()) {
    try {
      const result = await generateObject({
        ...getCodexModelSettings(),
        schema: checkinSchema,
        prompt: `Create 2-3 uncomfortable but useful founder check-ins for today.

Advisor: ${advisor.name}
Vision:
${brain.vision}

Direction:
${brain.direction}

Founder memory:
${brain.memory}

Return concise todo-style items. Each prompt should make the founder reflect or act.`,
      });
      return result.object.items;
    } catch (err) {
      console.error("[checkins] AI generation failed, using fallback", err);
    }
  }

  return fallbackCheckins();
}

function fallbackCheckins(): Array<Pick<CheckinItem, "title" | "prompt">> {
  return [
    {
      title: "Avoided conversation",
      prompt:
        "What conversation are you avoiding, and what is the smallest honest opening sentence?",
    },
    {
      title: "Signal or noise",
      prompt:
        "What founder worry repeated today? Mark whether it is a real signal, noise, or unknown.",
    },
    {
      title: "Next hard action",
      prompt: "Choose one action you can take within 24 hours that would reduce ambiguity.",
    },
  ];
}
