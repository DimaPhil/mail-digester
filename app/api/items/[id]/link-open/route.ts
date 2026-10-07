export const dynamic = "force-dynamic";
import { recordLinkOpen } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";
export const POST = apiOperation(
  "item-link-open",
  async (_request, context) => {
    const id = Number((await context.params).id);
    const actor = context.key ? "agent" : "human";
    try {
      const result = await recordLinkOpen(id, {}, actor);
      return Response.json(result);
    } catch {
      return Response.json(
        { error: "Item not found or invalid request" },
        { status: 404 },
      );
    }
  },
);
