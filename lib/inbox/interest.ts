export type ItemInterestStatus =
  | "unclassified"
  | "interesting"
  | "not_interesting";
export type ItemInterestClassification = {
  interestStatus: ItemInterestStatus;
  interestReason: string | null;
  interestModel: string | null;
  interestPromptVersion: number | null;
  interestClassifiedAt: number | null;
};
