import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  appConfig,
  articleSnapshots,
  emails,
  itemInteractions,
  items,
  syncState,
} from "@/lib/db/schema";
import type { ParsedDigestEmail } from "@/lib/digest/types";
import {
  normalizeInterestPrompt,
  type ItemInterestClassification,
  type ItemInterestStatus,
  UNCLASSIFIED_ITEM_INTEREST,
} from "@/lib/inbox/interest";
import { nowTs } from "@/lib/utils";

export type ItemInteractionAction =
  | "description_expand"
  | "link_open"
  | "resolve"
  | "unresolve";

export type ItemInteractionMetadata = Record<
  string,
  boolean | number | string | null | undefined
>;

export type InboxEmailItem = {
  id: number;
  emailId: number;
  section: string;
  position: number;
  title: string;
  summary: string;
  readTimeText: string | null;
  itemKind: string;
  trackedUrl: string;
  canonicalUrl: string | null;
  finalUrl: string | null;
  interestStatus: ItemInterestStatus;
  interestReason: string | null;
  interestModel: string | null;
  interestPromptVersion: number | null;
  interestClassifiedAt: number | null;
  interestNeedsRefresh: boolean;
  resolvedAt: number | null;
};

export type InboxEmail = {
  id: number;
  provider: string;
  providerMessageId: string;
  providerThreadId: string | null;
  sourceFamily: string;
  sourceVariant: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  completionState: string;
  gmailSyncPending: boolean;
  totalItems: number;
  resolvedItems: number;
  createdAt: number;
  updatedAt: number;
  items: InboxEmailItem[];
};

export type SyncStateRecord = {
  status: string;
  phase: string;
  message: string;
  discoveredEmails: number;
  processedEmails: number;
  active: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastSuccessfulSyncStartedAt: number | null;
  lastError: string | null;
  updatedAt: number;
};

export type AppConfigRecord = typeof appConfig.$inferSelect;
export type SnapshotRecord = typeof articleSnapshots.$inferSelect;
export type ItemInteractionRecord = typeof itemInteractions.$inferSelect;

export type ItemInterestInputRecord = {
  itemId: number;
  emailId: number;
  emailReceivedAt: number;
  sourceVariant: string;
  emailSubject: string;
  senderName: string;
  senderEmail: string;
  section: string;
  position: number;
  title: string;
  summary: string;
  readTimeText: string | null;
  itemKind: string;
  trackedUrl: string;
  canonicalUrl: string | null;
  finalUrl: string | null;
};

export async function setSyncState(
  input: Partial<SyncStateRecord> &
    Pick<SyncStateRecord, "status" | "phase" | "message">,
) {
  const db = getDb();
  const current = await getSyncState();
  const nextUpdatedAt = nowTs();

  await db
    .update(syncState)
    .set({
      status: input.status,
      phase: input.phase,
      message: input.message,
      discoveredEmails: input.discoveredEmails ?? current.discoveredEmails,
      processedEmails: input.processedEmails ?? current.processedEmails,
      active: input.active ?? current.active,
      lastStartedAt:
        input.lastStartedAt === undefined
          ? current.lastStartedAt
          : input.lastStartedAt,
      lastFinishedAt:
        input.lastFinishedAt === undefined
          ? current.lastFinishedAt
          : input.lastFinishedAt,
      lastSuccessfulSyncStartedAt:
        input.lastSuccessfulSyncStartedAt === undefined
          ? current.lastSuccessfulSyncStartedAt
          : input.lastSuccessfulSyncStartedAt,
      lastError:
        input.lastError === undefined ? current.lastError : input.lastError,
      updatedAt: nextUpdatedAt,
    })
    .where(eq(syncState.id, 1));
}

export async function getSyncState(): Promise<SyncStateRecord> {
  const db = getDb();
  const state = await db.query.syncState.findFirst({
    where: eq(syncState.id, 1),
  });

  if (!state) {
    throw new Error("Sync state row was not initialized.");
  }

  return state;
}

export async function getAppConfig(): Promise<AppConfigRecord> {
  const db = getDb();
  const config = await db.query.appConfig.findFirst({
    where: eq(appConfig.id, 1),
  });

  if (!config) {
    throw new Error("App config row was not initialized.");
  }

  return config;
}

export async function updateAppConfigPrompt(
  prompt: string | null | undefined,
): Promise<AppConfigRecord> {
  const db = getDb();
  const current = await getAppConfig();
  const nextPrompt = normalizeInterestPrompt(prompt);
  const nextVersion =
    nextPrompt === current.interestPrompt
      ? current.interestPromptVersion
      : current.interestPromptVersion + 1;

  await db
    .update(appConfig)
    .set({
      interestPrompt: nextPrompt,
      interestPromptVersion: nextVersion,
      updatedAt: nowTs(),
    })
    .where(eq(appConfig.id, 1));

  return getAppConfig();
}

export async function upsertParsedEmail(parsed: ParsedDigestEmail) {
  const db = getDb();
  const timestamp = nowTs();

  await db
    .insert(emails)
    .values({
      provider: "gmail",
      providerMessageId: parsed.providerMessageId,
      providerThreadId: parsed.providerThreadId,
      sourceFamily: parsed.sourceFamily,
      sourceVariant: parsed.sourceVariant,
      senderName: parsed.senderName,
      senderEmail: parsed.senderEmail,
      subject: parsed.subject,
      snippet: parsed.snippet,
      receivedAt: parsed.receivedAt,
      completionState: "active",
      gmailSyncPending: false,
      totalItems: parsed.items.length,
      resolvedItems: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [emails.provider, emails.providerMessageId],
      set: {
        providerThreadId: parsed.providerThreadId,
        sourceFamily: parsed.sourceFamily,
        sourceVariant: parsed.sourceVariant,
        senderName: parsed.senderName,
        senderEmail: parsed.senderEmail,
        subject: parsed.subject,
        snippet: parsed.snippet,
        receivedAt: parsed.receivedAt,
        totalItems: parsed.items.length,
        updatedAt: timestamp,
      },
    });

  const email = await db.query.emails.findFirst({
    where: and(
      eq(emails.provider, "gmail"),
      eq(emails.providerMessageId, parsed.providerMessageId),
    ),
  });

  if (!email) {
    throw new Error("Email upsert failed.");
  }

  for (const item of parsed.items) {
    const interest = item.interest ?? UNCLASSIFIED_ITEM_INTEREST;
    await db
      .insert(items)
      .values({
        emailId: email.id,
        sourceItemId: item.sourceItemId,
        section: item.section,
        position: item.position,
        title: item.title,
        summary: item.summary,
        readTimeText: item.readTimeText,
        itemKind: item.itemKind,
        trackedUrl: item.trackedUrl,
        canonicalUrl: item.canonicalUrl,
        finalUrl: item.finalUrl,
        interestStatus: interest.interestStatus,
        interestReason: interest.interestReason,
        interestModel: interest.interestModel,
        interestPromptVersion: interest.interestPromptVersion,
        interestClassifiedAt: interest.interestClassifiedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [items.emailId, items.sourceItemId],
        set: {
          section: item.section,
          position: item.position,
          title: item.title,
          summary: item.summary,
          readTimeText: item.readTimeText,
          itemKind: item.itemKind,
          trackedUrl: item.trackedUrl,
          canonicalUrl: item.canonicalUrl,
          finalUrl: item.finalUrl,
          interestStatus: interest.interestStatus,
          interestReason: interest.interestReason,
          interestModel: interest.interestModel,
          interestPromptVersion: interest.interestPromptVersion,
          interestClassifiedAt: interest.interestClassifiedAt,
          updatedAt: timestamp,
        },
      });
  }

  await refreshEmailCounts(email.id);
  return email.id;
}

export async function refreshEmailCounts(emailId: number) {
  const db = getDb();
  const allItems = await db.query.items.findMany({
    where: eq(items.emailId, emailId),
  });
  const totalItems = allItems.length;
  const resolvedItems = allItems.filter(
    (item) => item.resolvedAt != null,
  ).length;

  await db
    .update(emails)
    .set({
      totalItems,
      resolvedItems,
      completionState:
        totalItems > 0 && totalItems === resolvedItems ? "complete" : "active",
      updatedAt: nowTs(),
    })
    .where(eq(emails.id, emailId));

  return {
    totalItems,
    resolvedItems,
    complete: totalItems > 0 && totalItems === resolvedItems,
  };
}

export async function listInboxEmails() {
  const db = getDb();
  const emailRows = await db.query.emails.findMany({
    orderBy: [desc(emails.receivedAt)],
  });

  if (!emailRows.length) {
    return [] satisfies InboxEmail[];
  }

  const itemRows = await db.query.items.findMany({
    where: inArray(
      items.emailId,
      emailRows.map((email) => email.id),
    ),
    orderBy: [asc(items.position)],
  });

  return emailRows.map((email) => ({
    ...email,
    items: itemRows
      .filter((item) => item.emailId === email.id)
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        ...item,
        interestStatus: item.interestStatus as ItemInterestStatus,
        interestNeedsRefresh: false,
      })),
  }));
}

export async function getItemById(itemId: number) {
  const db = getDb();
  return db.query.items.findFirst({
    where: eq(items.id, itemId),
  });
}

export async function getEmailById(emailId: number) {
  const db = getDb();
  return db.query.emails.findFirst({
    where: eq(emails.id, emailId),
  });
}

export async function listItemInterestInputs() {
  const db = getDb();
  return db
    .select({
      itemId: items.id,
      emailId: items.emailId,
      emailReceivedAt: emails.receivedAt,
      sourceVariant: emails.sourceVariant,
      emailSubject: emails.subject,
      senderName: emails.senderName,
      senderEmail: emails.senderEmail,
      section: items.section,
      position: items.position,
      title: items.title,
      summary: items.summary,
      readTimeText: items.readTimeText,
      itemKind: items.itemKind,
      trackedUrl: items.trackedUrl,
      canonicalUrl: items.canonicalUrl,
      finalUrl: items.finalUrl,
    })
    .from(items)
    .innerJoin(emails, eq(items.emailId, emails.id))
    .orderBy(desc(emails.receivedAt), asc(items.position));
}

export async function listNonInterestingBulkResolveCandidates(input: {
  promptVersion: number;
  receivedBeforeTs: number;
}) {
  const db = getDb();
  return db
    .select({
      itemId: items.id,
      emailId: items.emailId,
    })
    .from(items)
    .innerJoin(emails, eq(items.emailId, emails.id))
    .where(
      and(
        eq(items.interestStatus, "not_interesting"),
        eq(items.interestPromptVersion, input.promptVersion),
        isNull(items.resolvedAt),
        lt(emails.receivedAt, input.receivedBeforeTs),
      ),
    );
}

export async function updateItemInterest(
  itemId: number,
  classification: ItemInterestClassification,
) {
  const db = getDb();
  await db
    .update(items)
    .set({
      interestStatus: classification.interestStatus,
      interestReason: classification.interestReason,
      interestModel: classification.interestModel,
      interestPromptVersion: classification.interestPromptVersion,
      interestClassifiedAt: classification.interestClassifiedAt,
      updatedAt: nowTs(),
    })
    .where(eq(items.id, itemId));
}

export async function clearItemInterests() {
  const db = getDb();
  await db.update(items).set({
    interestStatus: UNCLASSIFIED_ITEM_INTEREST.interestStatus,
    interestReason: UNCLASSIFIED_ITEM_INTEREST.interestReason,
    interestModel: UNCLASSIFIED_ITEM_INTEREST.interestModel,
    interestPromptVersion: UNCLASSIFIED_ITEM_INTEREST.interestPromptVersion,
    interestClassifiedAt: UNCLASSIFIED_ITEM_INTEREST.interestClassifiedAt,
    updatedAt: nowTs(),
  });
}

export async function recordItemInteraction(
  itemId: number,
  action: ItemInteractionAction,
  metadata: ItemInteractionMetadata = {},
) {
  const db = getDb();
  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const email = await getEmailById(item.emailId);
  if (!email) {
    throw new Error("Email not found.");
  }

  const existingOpens =
    action === "resolve"
      ? await db.query.itemInteractions.findMany({
          where: and(
            eq(itemInteractions.itemId, itemId),
            eq(itemInteractions.action, "link_open"),
          ),
          limit: 1,
        })
      : [];
  const clientOpenedBeforeResolve = metadata.clientOpenedBeforeResolve === true;
  const openedBeforeResolve =
    action === "resolve"
      ? existingOpens.length > 0 || clientOpenedBeforeResolve
      : null;
  const metadataJson =
    Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;

  await db.insert(itemInteractions).values({
    itemId,
    emailId: email.id,
    action,
    resolveMode:
      action === "resolve"
        ? openedBeforeResolve
          ? "after_open"
          : "direct"
        : null,
    openedBeforeResolve,
    provider: email.provider,
    providerMessageId: email.providerMessageId,
    providerThreadId: email.providerThreadId,
    sourceFamily: email.sourceFamily,
    sourceVariant: email.sourceVariant,
    senderName: email.senderName,
    senderEmail: email.senderEmail,
    emailSubject: email.subject,
    emailReceivedAt: email.receivedAt,
    section: item.section,
    position: item.position,
    itemKind: item.itemKind,
    readTimeText: item.readTimeText,
    title: item.title,
    fullDescription: item.summary,
    trackedUrl: item.trackedUrl,
    canonicalUrl: item.canonicalUrl,
    finalUrl: item.finalUrl,
    metadataJson,
    createdAt: nowTs(),
  });
}

export async function listItemInteractions() {
  const db = getDb();
  return db.query.itemInteractions.findMany({
    orderBy: [asc(itemInteractions.createdAt)],
  });
}

export async function markItemResolved(itemId: number, resolvedAt = nowTs()) {
  const db = getDb();

  await db
    .update(items)
    .set({
      resolvedAt,
      updatedAt: resolvedAt,
    })
    .where(eq(items.id, itemId));

  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found after resolve.");
  }

  return refreshEmailCounts(item.emailId);
}

export async function markItemUnresolved(itemId: number) {
  const db = getDb();
  const timestamp = nowTs();

  await db
    .update(items)
    .set({
      resolvedAt: null,
      updatedAt: timestamp,
    })
    .where(eq(items.id, itemId));

  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found after unresolve.");
  }

  await db
    .update(emails)
    .set({
      gmailSyncPending: false,
      updatedAt: timestamp,
    })
    .where(eq(emails.id, item.emailId));

  return refreshEmailCounts(item.emailId);
}

export async function setEmailGmailSyncPending(
  emailId: number,
  pending: boolean,
) {
  const db = getDb();
  await db
    .update(emails)
    .set({
      gmailSyncPending: pending,
      updatedAt: nowTs(),
    })
    .where(eq(emails.id, emailId));
}

export async function getSnapshotByUrlKey(urlKey: string) {
  const db = getDb();
  return db.query.articleSnapshots.findFirst({
    where: eq(articleSnapshots.urlKey, urlKey),
  });
}

export async function upsertSnapshot(
  urlKey: string,
  input: Partial<SnapshotRecord> &
    Pick<SnapshotRecord, "status" | "sourceUrl" | "finalUrl">,
) {
  const db = getDb();
  const timestamp = nowTs();

  await db
    .insert(articleSnapshots)
    .values({
      urlKey,
      status: input.status,
      sourceUrl: input.sourceUrl,
      finalUrl: input.finalUrl,
      title: input.title ?? null,
      byline: input.byline ?? null,
      siteName: input.siteName ?? null,
      excerpt: input.excerpt ?? null,
      contentHtml: input.contentHtml ?? null,
      contentText: input.contentText ?? null,
      errorMessage: input.errorMessage ?? null,
      fetchedAt: input.fetchedAt ?? null,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: articleSnapshots.urlKey,
      set: {
        status: input.status,
        sourceUrl: input.sourceUrl,
        finalUrl: input.finalUrl,
        title: input.title ?? null,
        byline: input.byline ?? null,
        siteName: input.siteName ?? null,
        excerpt: input.excerpt ?? null,
        contentHtml: input.contentHtml ?? null,
        contentText: input.contentText ?? null,
        errorMessage: input.errorMessage ?? null,
        fetchedAt: input.fetchedAt ?? null,
        updatedAt: timestamp,
      },
    });

  return getSnapshotByUrlKey(urlKey);
}

export async function updateItemUrls(
  itemId: number,
  input: {
    canonicalUrl: string | null;
    finalUrl: string | null;
  },
) {
  const db = getDb();
  await db
    .update(items)
    .set({
      canonicalUrl: input.canonicalUrl,
      finalUrl: input.finalUrl,
      updatedAt: nowTs(),
    })
    .where(eq(items.id, itemId));
}
