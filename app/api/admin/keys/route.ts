export const dynamic = "force-dynamic";
import { apiOperation } from "@/lib/api/operation";
import { createApiKey, listApiKeys } from "@/lib/api/keys";
import type { ApiKeyScope } from "@/lib/api/key-scopes";
export const GET = apiOperation("keys-list", () =>
  Response.json({ keys: listApiKeys() }),
);
export const POST = apiOperation("keys-create", (_request, context) => {
  const body = context.body as { name: string; scopes: ApiKeyScope[] };
  return Response.json(createApiKey(body.name, body.scopes), { status: 201 });
});
