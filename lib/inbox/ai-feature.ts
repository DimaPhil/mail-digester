export const AI_FEATURE_STATUSES = [
  "unclassified",
  "included",
  "excluded",
] as const;

export type AiFeatureStatus = (typeof AI_FEATURE_STATUSES)[number];

export type AiFeatureClassification = {
  aiFeatureStatus: AiFeatureStatus;
  aiFeatureReason: string | null;
  aiFeatureModel: string | null;
  aiFeaturePromptVersion: number | null;
  aiFeatureClassifiedAt: number | null;
};

export const UNCLASSIFIED_AI_FEATURE: AiFeatureClassification = {
  aiFeatureStatus: "unclassified",
  aiFeatureReason: null,
  aiFeatureModel: null,
  aiFeaturePromptVersion: null,
  aiFeatureClassifiedAt: null,
};

export function normalizeAiFeaturePrompt(prompt: string | null | undefined) {
  const normalized = prompt?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function aiFeatureStatusFromBoolean(included: boolean): AiFeatureStatus {
  return included ? "included" : "excluded";
}
