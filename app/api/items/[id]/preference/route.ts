export const dynamic = "force-dynamic";
import { setPreference } from "@/lib/inbox/service";
import { apiOperation } from "@/lib/api/operation";
export const POST = apiOperation(
  "item-preference",
  async (_request, context) => {
    const id = Number((await context.params).id);
    const body = context.body as {
      signal: "interested" | "less_like_this" | "clear";
    };
    try {
      return Response.json(
        await setPreference(id, body.signal, context.key ? "agent" : "human"),
      );
    } catch {
      return Response.json(
        { error: "Item not found or invalid request" },
        { status: 400 },
      );
    }
  },
);
