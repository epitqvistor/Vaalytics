/** Small builders so the dataset files stay readable. */
import type { CampaignObjective, CampaignReward, QuestItem } from "../types";

type ObjectiveInput = Omit<CampaignObjective, "requires" | "rewards" | "kind"> &
  Partial<Pick<CampaignObjective, "requires" | "rewards" | "kind">>;

export const objective = (o: ObjectiveInput): CampaignObjective => ({ kind: "main", requires: [], rewards: [], ...o });

/**
 * A passive-skill-point reward. In the real log each one is announced as two
 * system lines — "You have received 2 Passive Skill Points." and "You have
 * received 2 Weapon Set Passive Skill Points." — at the moment it is applied.
 */
export const passiveReward = (id: string, objectiveId: string, claim: CampaignReward["claim"], claimCondition: string, provenance: CampaignReward["provenance"]): CampaignReward => ({
  id,
  objective: objectiveId,
  category: "passive",
  label: "+2 Passive Skill Points (+2 Weapon Set Passive Skill Points)",
  amount: 2,
  permanent: true,
  claim,
  claimCondition,
  provenance,
});

export const reward = (r: CampaignReward): CampaignReward => r;
export const item = (i: QuestItem): QuestItem => i;
