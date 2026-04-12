import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articleSnapshots, emails, items, syncState } from "@/lib/db/schema";
import type { ParsedDigestEmail } from "@/lib/digest/types";
import { nowTs } from "@/lib/utils";

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
  lastError: string | null;
  updatedAt: number;
};

export type SnapshotRecord = typeof articleSnapshots.$inferSelect;

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
      .sort((a, b) => a.position - b.position),
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

export async function markItemResolved(itemId: number) {
  const db = getDb();
  const timestamp = nowTs();

  await db
    .update(items)
    .set({
      resolvedAt: timestamp,
      updatedAt: timestamp,
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
