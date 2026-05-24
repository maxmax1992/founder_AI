import { loadGraphFallbackSkill } from "@/lib/graph-fallback-skill";
import { getGraphifyRuntimeStatus } from "@/lib/graphify-config";

export const runtime = "nodejs";

export async function GET() {
  const [graphify, fallbackSkill] = await Promise.all([
    getGraphifyRuntimeStatus(),
    loadGraphFallbackSkill(),
  ]);

  return Response.json({
    graphify,
    fallbackSkill: fallbackSkill
      ? {
          name: fallbackSkill.name,
          summary: fallbackSkill.summary,
          relativePath: fallbackSkill.relativePath,
          references: fallbackSkill.references.map((reference) => ({
            slug: reference.slug,
            title: reference.title,
            relativePath: reference.relativePath,
          })),
        }
      : null,
  });
}
