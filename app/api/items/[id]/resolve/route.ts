export const dynamic = "force-dynamic";
import { resolveItem } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";
export const POST = apiOperation("item-resolve", async (_request, context) => {
  const id = Number((await context.params).id);
  const actor = context.key ? "agent" : "human";
  try {
    const result = await resolveItem(id, {}, actor);
    return Response.json({ emails: result });
  } catch {
    return Response.json(
      { error: "Item not found or invalid request" },
      { status: 404 },
    );
  }
});
