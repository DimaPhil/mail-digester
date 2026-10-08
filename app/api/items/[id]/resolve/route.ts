export const dynamic = "force-dynamic";
import { resolveItem } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";
export const POST = apiOperation("item-resolve", async (_request, context) => {
  const id = Number((await context.params).id);
  const actor = context.key ? "agent" : "human";
  try {
    return Response.json(
      await resolveItem(id, {}, actor, context.query.compact === 1),
    );
  } catch {
    return Response.json(
      { error: "Item not found or invalid request" },
      { status: 404 },
    );
  }
});
