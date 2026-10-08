import { z } from "zod";
import { ingestSchema } from "@/lib/api/ingest";
import { API_KEY_SCOPES, DEFAULT_KEY_SCOPES } from "@/lib/api/key-scopes";

export const preferenceSchema = z
  .object({ signal: z.enum(["interested", "less_like_this", "clear"]) })
  .strict();
export const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z
      .array(z.enum(API_KEY_SCOPES))
      .min(1)
      .max(API_KEY_SCOPES.length)
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate scopes",
      )
      .default(DEFAULT_KEY_SCOPES),
  })
  .strict();
const emptyBody = z.object({}).strict().default({});
const resolveBody = z
  .object({ signal: z.enum(["interested", "less_like_this"]).optional() })
  .strict()
  .default({});
const itemId = z.object({
  id: z
    .string()
    .regex(/^\d+$/)
    .refine(
      (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0,
      "Expected a positive integer ID",
    ),
});
const engagementQuery = z
  .object({
    after: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
const itemStateQuery = z
  .object({ compact: z.coerce.number().int().min(0).max(1).default(0) })
  .strict();

type Operation = {
  id: string;
  command: string;
  method: "GET" | "POST";
  path: string;
  summary: string;
  scope?: (typeof API_KEY_SCOPES)[number];
  browser?: boolean;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};
const itemActions = [
  ["open", "Open inline details"],
  ["link-open", "Record an outbound click"],
  ["description-expand", "Record expanded description"],
  ["resolve", "Mark an item Done"],
  ["unresolve", "Restore an item to To read"],
] as const;
export const API_OPERATIONS: Operation[] = [
  {
    id: "health",
    command: "health",
    method: "GET",
    path: "/api/health",
    summary: "Check service health",
    browser: true,
  },
  {
    id: "inbox",
    command: "inbox",
    method: "GET",
    path: "/api/inbox",
    summary: "Read the complete library",
    scope: "inbox",
    browser: true,
  },
  {
    id: "ingest",
    command: "ingest",
    method: "POST",
    path: "/api/v1/ingest",
    summary: "Import one email and its items",
    scope: "ingest",
    body: ingestSchema,
  },
  {
    id: "engagement",
    command: "engagement",
    method: "GET",
    path: "/api/v1/engagement",
    summary: "Read engagement events by cursor",
    scope: "feedback",
    query: engagementQuery,
  },
  {
    id: "auth",
    command: "auth status",
    method: "GET",
    path: "/api/v1/auth",
    summary: "Validate the current API key",
  },
  ...itemActions.map(([action, summary]) => ({
    id: `item-${action}`,
    command: `item ${action}`,
    method: "POST" as const,
    path: `/api/items/{id}/${action}`,
    summary,
    scope: "items" as const,
    browser: true,
    params: itemId,
    body: action === "resolve" ? resolveBody : emptyBody,
    ...(["resolve", "unresolve"].includes(action)
      ? { query: itemStateQuery }
      : {}),
  })),
  {
    id: "item-preference",
    command: "item preference",
    method: "POST",
    path: "/api/items/{id}/preference",
    summary: "Set or clear an explicit preference",
    scope: "items",
    browser: true,
    params: itemId,
    body: preferenceSchema,
  },
  {
    id: "keys-list",
    command: "keys list",
    method: "GET",
    path: "/api/admin/keys",
    summary: "List API key metadata",
    scope: "admin",
    browser: true,
  },
  {
    id: "keys-create",
    command: "keys create",
    method: "POST",
    path: "/api/admin/keys",
    summary: "Create a key; secret returned once",
    scope: "admin",
    browser: true,
    body: createKeySchema,
  },
  {
    id: "keys-revoke",
    command: "keys revoke",
    method: "POST",
    path: "/api/admin/keys/{id}/revoke",
    summary: "Revoke an API key",
    scope: "admin",
    browser: true,
    params: itemId,
    body: emptyBody,
  },
  {
    id: "keys-rotate",
    command: "keys rotate",
    method: "POST",
    path: "/api/admin/keys/{id}/rotate",
    summary: "Replace a key and revoke the old one atomically",
    scope: "admin",
    browser: true,
    params: itemId,
    body: emptyBody,
  },
];
export const RETIRED_ROUTES = [
  { path: "/api/sync", methods: ["GET", "POST", "PATCH"] },
  { path: "/api/config", methods: ["GET", "POST", "PATCH"] },
  { path: "/api/ai-feature-list", methods: ["GET", "POST", "PATCH"] },
  {
    path: "/api/items/resolve-not-interesting",
    methods: ["GET", "POST", "PATCH"],
  },
];
export function portableContract() {
  return {
    version: 1,
    scopes: API_KEY_SCOPES,
    defaultScopes: DEFAULT_KEY_SCOPES,
    operations: API_OPERATIONS.map(({ body, query, params, ...operation }) => ({
      ...operation,
      ...(body
        ? {
            body: z.toJSONSchema(body, { io: "input", unrepresentable: "any" }),
          }
        : {}),
      ...(query
        ? {
            query: z.toJSONSchema(query, {
              io: "output",
              unrepresentable: "any",
            }),
          }
        : {}),
      ...(params
        ? {
            params: z.toJSONSchema(params, {
              io: "input",
              unrepresentable: "any",
            }),
          }
        : {}),
    })),
    retired: RETIRED_ROUTES,
  };
}
