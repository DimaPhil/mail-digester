export type AiFeatureStatus = "unclassified" | "included" | "excluded";
export type AiFeatureClassification = {
  aiFeatureStatus: AiFeatureStatus;
  aiFeatureReason: string | null;
  aiFeatureModel: string | null;
  aiFeaturePromptVersion: number | null;
  aiFeatureClassifiedAt: number | null;
};
