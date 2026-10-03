export const dynamic = "force-dynamic";
import { recordDescriptionExpand } from "@/lib/inbox/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const raw = (await context.params).id,
    id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1)
    return Response.json({ error: "Invalid item ID" }, { status: 400 });
  try {
    void request;
    const result = await recordDescriptionExpand(id);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "Item not found or invalid request" },
      { status: 404 },
    );
  }
}
