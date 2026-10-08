import { defaultCollections } from "@/lib/navigation";
import navigationConfig from "@/config/navigation.json";
import { getSqlite } from "@/lib/db";
import {
  listInboxEmails,
  recordItemInteraction,
  type ItemInteractionMetadata,
} from "@/lib/db/repository";
import { safeExternalUrl } from "@/lib/content/safety";
function readingState(
  interestStatus: string,
  resolvedAt: number | null,
  preference: string | null,
) {
  const classification =
    interestStatus === "interesting" || interestStatus === "not_interesting"
      ? interestStatus
      : "unclassified";
  return {
    readingState:
      resolvedAt == null && classification === "interesting"
        ? ("to_read" as const)
        : ("archived" as const),
    interestCategory:
      resolvedAt != null && preference === "interested"
        ? "interesting"
        : resolvedAt != null && preference === "less_like_this"
          ? "not_interesting"
          : classification,
  };
}
function getItemState(itemId: number) {
  const row = getSqlite()
    .prepare(
      `SELECT i.id, i.interest_status AS interestStatus, i.resolved_at AS resolvedAt, p.signal AS preference FROM items i LEFT JOIN reader_preferences p ON p.item_id = i.id WHERE i.id = ?`,
    )
    .get(itemId) as
    | {
        id: number;
        interestStatus: string;
        resolvedAt: number | null;
        preference: string | null;
      }
    | undefined;
  if (!row) throw new Error("Item not found");
  return {
    id: row.id,
    resolvedAt: row.resolvedAt,
    preference: row.preference,
    ...readingState(row.interestStatus, row.resolvedAt, row.preference),
  };
}
export async function getInboxPayload() {
  const emails = await listInboxEmails(),
    db = getSqlite();
  const preferences = db
    .prepare("SELECT item_id, signal FROM reader_preferences")
    .all() as Array<{ item_id: number; signal: string }>;
  const navigation = db
    .prepare("SELECT * FROM item_navigation")
    .all() as Array<{
    item_id: number;
    category_id: string;
    category_label: string;
    tab_id: string;
    tab_label: string;
  }>;
  const preferencesByItem = new Map(
    preferences.map((p) => [p.item_id, p.signal]),
  );
  const navigationByItem = Map.groupBy(navigation, (n) => n.item_id);
  return {
    navigation: navigationConfig,
    emails: emails.map((email) => ({
      id: email.id,
      subject: email.subject,
      sourceVariant: email.sourceVariant,
      receivedAt: email.receivedAt,
      items: email.items.map((item) => {
        const interestStatus =
          item.interestStatus === "interesting" ||
          item.interestStatus === "not_interesting"
            ? item.interestStatus
            : "unclassified";
        const preference = preferencesByItem.get(item.id) ?? null;
        return {
          id: item.id,
          title: item.title,
          summary: item.summary,
          section: item.section,
          readTimeText: item.readTimeText,
          itemKind: item.itemKind,
          resolvedAt: item.resolvedAt,
          interestStatus,
          interestReason: item.interestReason,
          ...readingState(interestStatus, item.resolvedAt, preference),
          safeUrl: safeExternalUrl(
            item.finalUrl ?? item.canonicalUrl ?? item.trackedUrl,
          ),
          preference,
          collections: (() => {
            const stored = (navigationByItem.get(item.id) ?? []).map((n) => ({
              categoryId: n.category_id,
              categoryLabel: n.category_label,
              tabId: n.tab_id,
              tabLabel: n.tab_label,
            }));
            const defaults = defaultCollections(
              email.provider === "gmail" && /^tldr$/i.test(email.sourceFamily)
                ? "tldr"
                : email.sourceFamily,
            );
            if (
              /^tldr(?:-ai)?$/i.test(email.sourceFamily) &&
              !stored.some((c) => c.categoryId === "ai" && c.tabId === "tldr")
            )
              return [...defaults, ...stored];
            return stored.length
              ? stored
              : defaults.length
                ? defaults
                : [
                    {
                      categoryId: "unassigned",
                      categoryLabel: "Unsorted",
                      tabId: "all",
                      tabLabel: "All reading",
                    },
                  ];
          })(),
        };
      }),
    })),
  };
}
export async function recordLinkOpen(
  itemId: number,
  metadata: ItemInteractionMetadata = {},
  actor: "human" | "agent" = "human",
) {
  recordItemInteraction(itemId, "link_open", metadata, actor);
  return { ok: true };
}
export async function recordDescriptionExpand(
  itemId: number,
  metadata: ItemInteractionMetadata = {},
  actor: "human" | "agent" = "human",
) {
  recordItemInteraction(itemId, "description_expand", metadata, actor);
  return { ok: true };
}
export async function openItem(
  itemId: number,
  actor: "human" | "agent" = "human",
) {
  recordItemInteraction(itemId, "reader_open", {}, actor);
  return { ok: true };
}
function transition(
  itemId: number,
  resolved: boolean,
  metadata: ItemInteractionMetadata = {},
  actor: "human" | "agent" = "human",
) {
  const db = getSqlite();
  db.transaction(() => {
    const row = db
      .prepare("SELECT email_id, resolved_at FROM items WHERE id = ?")
      .get(itemId) as
      | { email_id: number; resolved_at: number | null }
      | undefined;
    if (!row) throw new Error("Item not found");
    if ((row.resolved_at != null) === resolved) return;
    const now = Date.now();
    db.prepare(
      "UPDATE items SET resolved_at = ?, updated_at = ? WHERE id = ?",
    ).run(resolved ? now : null, now, itemId);
    recordItemInteraction(
      itemId,
      resolved ? "resolve" : "unresolve",
      metadata,
      actor,
    );
    db.prepare(
      `UPDATE emails SET resolved_items = (SELECT COUNT(*) FROM items WHERE email_id = ? AND resolved_at IS NOT NULL), completion_state = CASE WHEN NOT EXISTS (SELECT 1 FROM items WHERE email_id = ? AND resolved_at IS NULL) THEN 'complete' ELSE 'active' END, updated_at = ? WHERE id = ?`,
    ).run(row.email_id, row.email_id, now, row.email_id);
  }).immediate();
}
export async function resolveItem(
  itemId: number,
  metadata: ItemInteractionMetadata = {},
  actor: "human" | "agent" = "human",
  compact = false,
) {
  transition(itemId, true, metadata, actor);
  return compact
    ? { item: getItemState(itemId) }
    : { emails: (await getInboxPayload()).emails };
}
export async function unresolveItem(
  itemId: number,
  actor: "human" | "agent" = "human",
  compact = false,
) {
  transition(itemId, false, {}, actor);
  return compact
    ? { item: getItemState(itemId) }
    : { emails: (await getInboxPayload()).emails };
}
export async function setPreference(
  itemId: number,
  signal: "interested" | "less_like_this" | "clear",
  actor: "human" | "agent" = "human",
) {
  const db = getSqlite();
  db.transaction(() => {
    const current = db
      .prepare("SELECT signal FROM reader_preferences WHERE item_id = ?")
      .get(itemId) as { signal: string } | undefined;
    if (current?.signal === signal) return;
    recordItemInteraction(itemId, "preference", { signal }, actor);
    db.prepare(
      "INSERT INTO reader_preferences VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET signal = excluded.signal, updated_at = excluded.updated_at",
    ).run(itemId, signal, Date.now());
  }).immediate();
  return { ok: true, item: getItemState(itemId) };
}
