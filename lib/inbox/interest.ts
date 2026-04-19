export const ITEM_INTEREST_STATUSES = [
  "unclassified",
  "interesting",
  "not_interesting",
] as const;

export type ItemInterestStatus = (typeof ITEM_INTEREST_STATUSES)[number];

export type ItemInterestClassification = {
  interestStatus: ItemInterestStatus;
  interestReason: string | null;
  interestModel: string | null;
  interestPromptVersion: number | null;
  interestClassifiedAt: number | null;
};

export const UNCLASSIFIED_ITEM_INTEREST: ItemInterestClassification = {
  interestStatus: "unclassified",
  interestReason: null,
  interestModel: null,
  interestPromptVersion: null,
  interestClassifiedAt: null,
};

export function normalizeInterestPrompt(prompt: string | null | undefined) {
  const normalized = prompt?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function itemInterestStatusFromBoolean(
  interesting: boolean,
): ItemInterestStatus {
  return interesting ? "interesting" : "not_interesting";
}
