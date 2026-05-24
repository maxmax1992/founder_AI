import { type GraphFallbackSkill, loadGraphFallbackSkill } from "@/lib/graph-fallback-skill";
import { getGraphifyRuntimeStatus, hasUsableGraphifyArtifacts } from "@/lib/graphify-config";
import {
  getAdvisor,
  getAdvisorBrain,
  getDefaultFounder,
  getFounder,
  getFounderBrain,
  listSources,
  searchAdvisorBrain,
  searchFounderBrain,
} from "@/lib/store";
import type {
  Advisor,
  AdvisorBrain,
  AdvisorSource,
  Founder,
  FounderBrain,
  SearchHit,
} from "@/lib/types";

export interface BuddyAnswerContext {
  advisor: Advisor;
  advisorBrain: AdvisorBrain;
  advisorSources: AdvisorSource[];
  founder: Founder;
  founderBrain: FounderBrain;
  advisorHits: SearchHit[];
  founderHits: SearchHit[];
  graphifyEnabled: boolean;
  graphFallbackSkill: GraphFallbackSkill | null;
}

export async function buildBuddyAnswerContext(
  advisorId: string,
  founderId: string | undefined,
  query: string,
): Promise<BuddyAnswerContext | null> {
  const advisor = await getAdvisor(advisorId);
  const advisorBrain = await getAdvisorBrain(advisorId);
  if (!advisor || !advisorBrain) return null;

  const fallbackFounder = await getDefaultFounder();
  const founder = (await getFounder(founderId || fallbackFounder.id)) ?? fallbackFounder;
  const founderBrain = await getFounderBrain(founder.id);
  if (!founderBrain) return null;

  const graphifyStatus = await getGraphifyRuntimeStatus();
  const graphifyEnabled = hasUsableGraphifyArtifacts(graphifyStatus);
  const [advisorSources, advisorHits, founderHits, graphFallbackSkill] = await Promise.all([
    listSources(advisor.id),
    searchAdvisorBrain(advisor.id, query),
    searchFounderBrain(founder.id, query),
    graphifyEnabled ? Promise.resolve(null) : loadGraphFallbackSkill(),
  ]);

  return {
    advisor,
    advisorBrain,
    advisorSources,
    founder,
    founderBrain,
    advisorHits,
    founderHits,
    graphifyEnabled,
    graphFallbackSkill,
  };
}
