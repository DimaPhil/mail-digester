export const FILTER_RULE_ACTIONS = ["promote", "deprioritize", "hide"] as const;
export type FilterRuleAction = (typeof FILTER_RULE_ACTIONS)[number];

export const FILTER_RULE_FIELDS = [
  "sourceVariant",
  "section",
  "itemKind",
  "title",
  "fullDescription",
  "keyword",
  "titlePhrase",
  "siteName",
  "canonicalUrl",
] as const;
export type FilterRuleField = (typeof FILTER_RULE_FIELDS)[number];

export const FILTER_RULE_OPERATORS = [
  "equals",
  "contains",
  "startsWith",
  "anyOf",
] as const;
export type FilterRuleOperator = (typeof FILTER_RULE_OPERATORS)[number];

export const FILTER_RULE_CONFIDENCE = ["low", "medium", "high"] as const;
export type FilterRuleConfidence = (typeof FILTER_RULE_CONFIDENCE)[number];

export type FilterRuleCondition = {
  field: FilterRuleField;
  operator: FilterRuleOperator;
  value: string | string[];
};

export type FilterRuleEvidence = {
  interactionCount: number;
  uniqueItemCount: number;
  linkOpens: number;
  resolvesAfterOpen: number;
  directResolves: number;
  unresolves: number;
  exampleTitles: string[];
};

export type FilterRule = {
  id: string;
  name: string;
  enabled: boolean;
  source: "llm" | "manual" | "analytics";
  action: FilterRuleAction;
  confidence: FilterRuleConfidence;
  reversible: boolean;
  rationale: string;
  conditions: FilterRuleCondition[];
  evidence: FilterRuleEvidence;
  createdAt: string;
};

export type FilterRecommendationBundle = {
  summary: string;
  generatedAt: string;
  rules: FilterRule[];
  questionsToAskUser: string[];
};
