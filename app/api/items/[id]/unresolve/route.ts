export const dynamic = "force-dynamic";
import { unresolveItem } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";
export const POST = apiOperation(
  "item-unresolve",
  async (_request, context) => {
    const id = Number((await context.params).id);
    const actor = context.key ? "agent" : "human";
    try {
      const result = await unresolveItem(id, actor);
      return Response.json({ emails: result });
    } catch {
      return Response.json(
        { error: "Item not found or invalid request" },
        { status: 404 },
      );
    }
  },
);
