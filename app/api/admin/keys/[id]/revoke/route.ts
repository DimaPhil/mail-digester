export const dynamic = "force-dynamic";
import { apiOperation } from "@/lib/api/operation";
import { revokeApiKey } from "@/lib/api/keys";
export const POST = apiOperation("keys-revoke", async (_request, context) => {
  try {
    return Response.json(revokeApiKey(Number((await context.params).id)));
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "API key not found")
      throw error;
    return Response.json({ error: "API key not found" }, { status: 404 });
  }
});
