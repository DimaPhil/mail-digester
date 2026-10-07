export const API_KEY_SCOPES = [
  "inbox",
  "items",
  "ingest",
  "feedback",
  "admin",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const DEFAULT_KEY_SCOPES: ApiKeyScope[] = [
  "inbox",
  "items",
  "ingest",
  "feedback",
];
