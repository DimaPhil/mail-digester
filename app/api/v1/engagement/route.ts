export const dynamic = "force-dynamic";
import { authorizeBearer } from "@/lib/api/security";
import { getSqlite } from "@/lib/db";
export async function GET(request: Request) {
  const denied = authorizeBearer(request, "FEEDBACK");
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const after = Number(query.get("after") ?? 0),
    limit = Number(query.get("limit") ?? 100);
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    return Response.json({ error: "Invalid cursor or limit" }, { status: 400 });
  const rows = getSqlite()
    .prepare(
      `SELECT x.*, m.source_id AS api_source_id, m.message_id AS api_message_id, ii.item_id AS api_item_id FROM item_interactions x LEFT JOIN ingestion_messages m ON m.email_id = x.email_id LEFT JOIN ingestion_items ii ON ii.internal_item_id = x.item_id WHERE x.id > ? ORDER BY x.id LIMIT ?`,
    )
    .all(after, limit + 1) as Array<Record<string, unknown> & { id: number }>;
  const events = rows.slice(0, limit);
  return Response.json(
    {
      events,
      nextCursor: events.at(-1)?.id ?? after,
      hasMore: rows.length > limit,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
