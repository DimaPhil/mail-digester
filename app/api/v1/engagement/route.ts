export const dynamic = "force-dynamic";
import { apiOperation } from "@/lib/api/operation";
import { getSqlite } from "@/lib/db";
export const GET = apiOperation("engagement", (_request, context) => {
  const after = context.query.after as number,
    limit = context.query.limit as number;
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
});
