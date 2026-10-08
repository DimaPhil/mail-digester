export const dynamic = "force-dynamic";
import { unresolveItem } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";
export const POST = apiOperation(
  "item-unresolve",
  async (_request, context) => {
    const id = Number((await context.params).id);
    const actor = context.key ? "agent" : "human";
    try {
      return Response.json(
        await unresolveItem(id, actor, context.query.compact === 1),
      );
    } catch {
      return Response.json(
        { error: "Item not found or invalid request" },
        { status: 404 },
      );
    }
  },
);
