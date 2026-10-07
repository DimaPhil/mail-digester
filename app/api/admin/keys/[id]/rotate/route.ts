export const dynamic = "force-dynamic";
import { apiOperation } from "@/lib/api/operation";
import { rotateApiKey } from "@/lib/api/keys";
export const POST = apiOperation("keys-rotate", async (_request, context) => {
  try {
    return Response.json(rotateApiKey(Number((await context.params).id)));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Active API key not found"
    )
      throw error;
    return Response.json(
      { error: "Active API key not found" },
      { status: 404 },
    );
  }
});
