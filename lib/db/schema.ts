import {
  index,
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
    interestStatus: text("interest_status").notNull().default("unclassified"),
    interestReason: text("interest_reason"),
    interestModel: text("interest_model"),
    interestPromptVersion: integer("interest_prompt_version"),
    interestClassifiedAt: integer("interest_classified_at", {
      mode: "number",
    }),
    aiFeatureStatus: text("ai_feature_status")
      .notNull()
      .default("unclassified"),
    aiFeatureReason: text("ai_feature_reason"),
    aiFeatureModel: text("ai_feature_model"),
    aiFeaturePromptVersion: integer("ai_feature_prompt_version"),
    aiFeatureClassifiedAt: integer("ai_feature_classified_at", {
      mode: "number",
    }),
    resolvedAt: integer("resolved_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    uniqueSourceItem: uniqueIndex("items_email_source_item_idx").on(
      table.emailId,
      table.sourceItemId,
    ),
    interestStatusIdx: index("items_interest_status_idx").on(
      table.interestStatus,
      table.resolvedAt,
      table.interestPromptVersion,
    ),
    aiFeatureStatusIdx: index("items_ai_feature_status_idx").on(
      table.aiFeatureStatus,
      table.resolvedAt,
      table.aiFeaturePromptVersion,
    ),
  }),
);

export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey(),
  interestPrompt: text("interest_prompt"),
  interestPromptVersion: integer("interest_prompt_version")
    .notNull()
    .default(0),
  aiFeaturePrompt: text("ai_feature_prompt"),
  aiFeaturePromptVersion: integer("ai_feature_prompt_version")
    .notNull()
    .default(0),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

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

export const itemInteractions = sqliteTable("item_interactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  emailId: integer("email_id")
    .notNull()
    .references(() => emails.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resolveMode: text("resolve_mode"),
  openedBeforeResolve: integer("opened_before_resolve", {
    mode: "boolean",
  }),
  provider: text("provider").notNull(),
  providerMessageId: text("provider_message_id").notNull(),
  providerThreadId: text("provider_thread_id"),
  sourceFamily: text("source_family").notNull(),
  sourceVariant: text("source_variant").notNull(),
  senderName: text("sender_name").notNull(),
  senderEmail: text("sender_email").notNull(),
  emailSubject: text("email_subject").notNull(),
  emailReceivedAt: integer("email_received_at", { mode: "number" }).notNull(),
  section: text("section").notNull(),
  position: integer("position").notNull(),
  itemKind: text("item_kind").notNull(),
  readTimeText: text("read_time_text"),
  title: text("title").notNull(),
  fullDescription: text("full_description").notNull(),
  trackedUrl: text("tracked_url").notNull(),
  canonicalUrl: text("canonical_url"),
  finalUrl: text("final_url"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
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
  lastSuccessfulSyncStartedAt: integer("last_successful_sync_started_at", {
    mode: "number",
  }),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const aiFeatureBuildState = sqliteTable("ai_feature_build_state", {
  id: integer("id").primaryKey(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  message: text("message").notNull(),
  discoveredItems: integer("discovered_items").notNull().default(0),
  processedItems: integer("processed_items").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  includeResolvedItems: integer("include_resolved_items", { mode: "boolean" })
    .notNull()
    .default(false),
  lastStartedAt: integer("last_started_at", { mode: "number" }),
  lastFinishedAt: integer("last_finished_at", { mode: "number" }),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});
