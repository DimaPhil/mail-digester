import { defaultCollections, validCollection } from "@/lib/navigation";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSqlite } from "@/lib/db";
import { canonicalizeUrl } from "@/lib/content/url";
import { safeExternalUrl } from "@/lib/content/safety";

const id = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9@._:+/-]+$/);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
      "Control characters are not allowed",
    );
const url = z
  .string()
  .max(4096)
  .refine(
    (v) => safeExternalUrl(v) !== null,
    "Only public HTTP(S) URLs without credentials are allowed",
  );
export const ingestSchema = z
  .object({
    source: z
      .object({
        id: id.regex(/^[a-z0-9][a-z0-9_-]*$/, "Use a lowercase source ID"),
        label: text(80).min(1),
      })
      .strict(),
    message: z
      .object({
        id,
        subject: text(500).min(1),
        receivedAt: z.iso.datetime({ offset: true }),
        senderName: text(200).default(""),
        origin: z
          .object({ provider: z.literal("gmail"), messageId: id })
          .strict()
          .optional(),
        senderEmail: z.union([z.email(), z.literal("")]).default(""),
        description: text(2000).default(""),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            id,
            title: text(500).min(1),
            description: text(20_000).default(""),
            url: url.optional(),
            legacyItemId: z.number().int().positive().optional(),
            section: text(100).default("Reading"),
            readTime: text(50).optional(),
            kind: z
              .enum(["editorial", "sponsor", "discussion", "other"])
              .default("editorial"),
            collections: z
              .array(
                z
                  .object({
                    categoryId: id,
                    categoryLabel: text(80).min(1),
                    tabId: id,
                    tabLabel: text(80).min(1),
                  })
                  .strict(),
              )
              .max(10)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const [index, item] of v.items.entries()) {
      if (item.collections.some((c) => !validCollection(c)))
        ctx.addIssue({
          code: "custom",
          message:
            "Collection is not configured; send uncertain topics to review",
          path: ["items", index, "collections"],
        });
      if (!item.collections.length && !defaultCollections(v.source.id).length)
        ctx.addIssue({
          code: "custom",
          message: "This source requires an explicit configured collection",
          path: ["items", index, "collections"],
        });
    }
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate item IDs",
        path: ["items"],
      });
  });
export type IngestInput = z.infer<typeof ingestSchema>;
export class IngestConflict extends Error {}
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

export function ingest(input: IngestInput) {
  const db = getSqlite();
  return db
    .transaction(() => {
      const source = db
        .prepare("SELECT label FROM ingestion_sources WHERE source_id = ?")
        .get(input.source.id) as { label: string } | undefined;
      if (source && source.label !== input.source.label)
        throw new IngestConflict(
          "Source label differs; keep the original label",
        );
      db.prepare("INSERT OR IGNORE INTO ingestion_sources VALUES (?, ?)").run(
        input.source.id,
        input.source.label,
      );
      const metadataHash = hash(input.message);
      const existing = db
        .prepare(
          "SELECT email_id, metadata_hash FROM ingestion_messages WHERE source_id = ? AND message_id = ?",
        )
        .get(input.source.id, input.message.id) as
        | { email_id: number; metadata_hash: string }
        | undefined;
      if (existing && existing.metadata_hash !== metadataHash)
        throw new IngestConflict(
          "Message metadata differs from the stored message",
        );
      let emailId = existing?.email_id;
      const timestamp = Date.now();
      if (!emailId && input.message.origin) {
        const origin = input.message.origin;
        const legacy = db
          .prepare(
            "SELECT id FROM emails WHERE provider = ? AND provider_message_id = ?",
          )
          .get(origin.provider, origin.messageId) as { id: number } | undefined;
        if (legacy) {
          emailId = legacy.id;
          const mapping = db
            .prepare(
              "SELECT source_id, message_id FROM ingestion_messages WHERE email_id = ?",
            )
            .get(emailId);
          if (mapping)
            throw new IngestConflict(
              "Legacy message is already mapped to another ingestion identity",
            );
          db.prepare("INSERT INTO ingestion_messages VALUES (?, ?, ?, ?)").run(
            input.source.id,
            input.message.id,
            emailId,
            metadataHash,
          );
        }
      }
      if (!emailId) {
        // Dedicated provider namespace cannot collide with preserved Gmail IDs.
        const row = db
          .prepare(
            `INSERT INTO emails (provider, provider_message_id, source_family, source_variant, sender_name, sender_email, subject, snippet, received_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `api:${input.source.id}`,
            input.message.id,
            input.source.id,
            input.source.label,
            input.message.senderName,
            input.message.senderEmail,
            input.message.subject,
            input.message.description,
            Date.parse(input.message.receivedAt),
            timestamp,
            timestamp,
          );
        emailId = Number(row.lastInsertRowid);
        db.prepare("INSERT INTO ingestion_messages VALUES (?, ?, ?, ?)").run(
          input.source.id,
          input.message.id,
          emailId,
          metadataHash,
        );
      }
      let created = 0;
      const result = input.items.map((item) => {
        const contentHash = hash(item);
        const old = db
          .prepare(
            "SELECT internal_item_id, content_hash FROM ingestion_items WHERE source_id = ? AND message_id = ? AND item_id = ?",
          )
          .get(input.source.id, input.message.id, item.id) as
          | { internal_item_id: number; content_hash: string }
          | undefined;
        if (old) {
          if (old.content_hash !== contentHash)
            throw new IngestConflict(
              "Item content differs from the stored item",
            );
          return {
            id: item.id,
            internalId: old.internal_item_id,
            created: false,
          };
        }
        if (item.legacyItemId) {
          const legacy = db
            .prepare(
              "SELECT id, tracked_url, canonical_url, final_url FROM items WHERE id = ? AND email_id = ?",
            )
            .get(item.legacyItemId, emailId) as
            | {
                id: number;
                tracked_url: string;
                canonical_url: string | null;
                final_url: string | null;
              }
            | undefined;
          if (
            !legacy ||
            (item.url &&
              ![
                legacy.tracked_url,
                legacy.canonical_url,
                legacy.final_url,
              ].some(
                (u) =>
                  u &&
                  safeExternalUrl(u) &&
                  canonicalizeUrl(u) === canonicalizeUrl(item.url!),
              ))
          )
            throw new IngestConflict(
              "Legacy item does not belong to this message or URL differs",
            );
          db.prepare("INSERT INTO ingestion_items VALUES (?, ?, ?, ?, ?)").run(
            input.source.id,
            input.message.id,
            item.id,
            legacy.id,
            contentHash,
          );
          // Preserve all legacy content and state; only attach ingestion identity/navigation.
          for (const nav of item.collections)
            db.prepare(
              "INSERT OR IGNORE INTO item_navigation VALUES (?, ?, ?, ?, ?)",
            ).run(
              legacy.id,
              nav.categoryId,
              nav.categoryLabel,
              nav.tabId,
              nav.tabLabel,
            );
          return { id: item.id, internalId: legacy.id, created: false };
        }
        const legacyMessage = db
          .prepare("SELECT provider FROM emails WHERE id = ?")
          .get(emailId) as { provider: string };
        if (legacyMessage.provider === "gmail")
          throw new IngestConflict(
            "Existing Gmail messages require explicit legacyItemId for every appearance",
          );
        const position = (
          db
            .prepare(
              "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM items WHERE email_id = ?",
            )
            .get(emailId) as { position: number }
        ).position;
        const row = db
          .prepare(
            `INSERT INTO items (email_id, source_item_id, section, position, title, summary, read_time_text, item_kind, tracked_url, canonical_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            emailId,
            item.id,
            item.section,
            position,
            item.title,
            item.description,
            item.readTime ?? null,
            item.kind,
            item.url ?? "",
            item.url ? canonicalizeUrl(item.url) : null,
            timestamp,
            timestamp,
          );
        const internalId = Number(row.lastInsertRowid);
        db.prepare("INSERT INTO ingestion_items VALUES (?, ?, ?, ?, ?)").run(
          input.source.id,
          input.message.id,
          item.id,
          internalId,
          contentHash,
        );
        for (const nav of item.collections)
          db.prepare(
            "INSERT OR IGNORE INTO item_navigation VALUES (?, ?, ?, ?, ?)",
          ).run(
            internalId,
            nav.categoryId,
            nav.categoryLabel,
            nav.tabId,
            nav.tabLabel,
          );
        created++;
        return { id: item.id, internalId, created: true };
      });
      if (created)
        db.prepare(
          `UPDATE emails SET total_items = (SELECT COUNT(*) FROM items WHERE email_id = ?), completion_state = 'active', updated_at = ? WHERE id = ?`,
        ).run(emailId, timestamp, emailId);
      return {
        messageId: input.message.id,
        internalEmailId: emailId,
        createdItems: created,
        items: result,
      };
    })
    .immediate();
}
