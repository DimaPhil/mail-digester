import { asc, desc } from "drizzle-orm";
import { getDb, getSqlite } from "@/lib/db";
import { emails, items } from "@/lib/db/schema";
import { nowTs } from "@/lib/utils";
export type ItemInteractionAction =
  | "reader_open"
  | "preference"
  | "description_expand"
  | "link_open"
  | "resolve"
  | "unresolve";
export type ItemInteractionMetadata = Record<
  string,
  boolean | number | string | null | undefined
>;
export type InboxEmailItem = typeof items.$inferSelect;
export type InboxEmail = typeof emails.$inferSelect & {
  items: InboxEmailItem[];
};
export async function listInboxEmails() {
  const db = getDb();
  const emailRows = await db.query.emails.findMany({
    orderBy: [desc(emails.receivedAt)],
  });

  if (!emailRows.length) {
    return [] satisfies InboxEmail[];
  }

  const itemRows = await db.query.items.findMany({
    orderBy: [asc(items.position)],
  });

  const itemsByEmail = Map.groupBy(itemRows, (item) => item.emailId);
  return emailRows.map((email) => ({
    ...email,
    items: itemsByEmail.get(email.id) ?? [],
  }));
}

export function recordItemInteraction(
  itemId: number,
  action: ItemInteractionAction,
  metadata: ItemInteractionMetadata = {},
) {
  const db = getSqlite();
  const row = db
    .prepare(
      `SELECT i.*, e.provider, e.provider_message_id, e.provider_thread_id, e.source_family, e.source_variant, e.sender_name, e.sender_email, e.subject, e.received_at FROM items i JOIN emails e ON e.id = i.email_id WHERE i.id = ?`,
    )
    .get(itemId) as Record<string, string | number | null> | undefined;
  if (!row) throw new Error("Item not found");
  const opened =
    action === "resolve"
      ? Boolean(
          db
            .prepare(
              "SELECT 1 FROM item_interactions WHERE item_id = ? AND action = 'link_open' LIMIT 1",
            )
            .get(itemId),
        )
      : null;
  const columns = [
    "item_id",
    "email_id",
    "action",
    "actor",
    "resolve_mode",
    "opened_before_resolve",
    "provider",
    "provider_message_id",
    "provider_thread_id",
    "source_family",
    "source_variant",
    "sender_name",
    "sender_email",
    "email_subject",
    "email_received_at",
    "section",
    "position",
    "item_kind",
    "read_time_text",
    "title",
    "full_description",
    "tracked_url",
    "canonical_url",
    "final_url",
    "metadata_json",
    "created_at",
  ];
  const values = [
    itemId,
    row.email_id,
    action,
    "human",
    action === "resolve" ? (opened ? "after_open" : "direct") : null,
    opened == null ? null : Number(opened),
    row.provider,
    row.provider_message_id,
    row.provider_thread_id,
    row.source_family,
    row.source_variant,
    row.sender_name,
    row.sender_email,
    row.subject,
    row.received_at,
    row.section,
    row.position,
    row.item_kind,
    row.read_time_text,
    row.title,
    row.summary,
    row.tracked_url,
    row.canonical_url,
    row.final_url,
    Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    nowTs(),
  ];
  db.prepare(
    `INSERT INTO item_interactions (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(...values);
}
