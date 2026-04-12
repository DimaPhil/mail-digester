import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const emails = sqliteTable(
  "emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id"),
    sourceFamily: text("source_family").notNull(),
    sourceVariant: text("source_variant").notNull(),
    senderName: text("sender_name").notNull(),
    senderEmail: text("sender_email").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    receivedAt: integer("received_at", { mode: "number" }).notNull(),
    completionState: text("completion_state").notNull().default("active"),
    gmailSyncPending: integer("gmail_sync_pending", { mode: "boolean" })
      .notNull()
      .default(false),
    totalItems: integer("total_items").notNull().default(0),
    resolvedItems: integer("resolved_items").notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    uniqueProviderMessage: uniqueIndex("emails_provider_message_idx").on(
      table.provider,
      table.providerMessageId,
    ),
  }),
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    emailId: integer("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id").notNull(),
    section: text("section").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    readTimeText: text("read_time_text"),
    itemKind: text("item_kind").notNull(),
    trackedUrl: text("tracked_url").notNull(),
    canonicalUrl: text("canonical_url"),
    finalUrl: text("final_url"),
    resolvedAt: integer("resolved_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    uniqueSourceItem: uniqueIndex("items_email_source_item_idx").on(
      table.emailId,
      table.sourceItemId,
    ),
  }),
);

export const articleSnapshots = sqliteTable("article_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  urlKey: text("url_key").notNull().unique(),
  sourceUrl: text("source_url").notNull(),
  finalUrl: text("final_url").notNull(),
  status: text("status").notNull(),
  title: text("title"),
  byline: text("byline"),
  siteName: text("site_name"),
  excerpt: text("excerpt"),
  contentHtml: text("content_html"),
  contentText: text("content_text"),
  errorMessage: text("error_message"),
  fetchedAt: integer("fetched_at", { mode: "number" }),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  message: text("message").notNull(),
  discoveredEmails: integer("discovered_emails").notNull().default(0),
  processedEmails: integer("processed_emails").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  lastStartedAt: integer("last_started_at", { mode: "number" }),
  lastFinishedAt: integer("last_finished_at", { mode: "number" }),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});
