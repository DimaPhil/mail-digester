import { canonicalizeUrl } from "@/lib/content/url";
import { fetchReadableSnapshot } from "@/lib/content/readability";
import {
  getEmailById,
  getItemById,
  getSnapshotByUrlKey,
  getSyncState,
  listInboxEmails,
  markItemResolved,
  markItemUnresolved,
  recordItemInteraction,
  refreshEmailCounts,
  setEmailGmailSyncPending,
  setSyncState,
  updateItemUrls,
  upsertParsedEmail,
  upsertSnapshot,
} from "@/lib/db/repository";
import type { ItemInteractionMetadata } from "@/lib/db/repository";
import { pickDigestSource } from "@/lib/digest";
import { FixtureMailProvider } from "@/lib/mail/providers/fixture";
import { GmailGwsProvider } from "@/lib/mail/providers/gmail-gws";
import type { MailProvider } from "@/lib/mail/types";
import { nowTs } from "@/lib/utils";

let syncPromise: Promise<void> | null = null;

export type InboxServices = {
  mailProvider: MailProvider;
};

export function createInboxServices(
  overrides: Partial<InboxServices> = {},
): InboxServices {
  const useFixtures =
    process.env.MAIL_DIGESTER_USE_FIXTURE_DATA === "1" ||
    process.env.NODE_ENV === "test";

  return {
    mailProvider:
      overrides.mailProvider ??
      (useFixtures ? new FixtureMailProvider() : new GmailGwsProvider()),
  };
}

async function shouldAutoSyncInbox(
  newestStoredMessageId: string | null,
  services: InboxServices,
) {
  try {
    const refs = await services.mailProvider.listUnreadCandidates();
    const latestUnreadRef = refs[0];

    if (!latestUnreadRef) {
      return false;
    }

    if (!newestStoredMessageId) {
      return true;
    }

    return latestUnreadRef.id !== newestStoredMessageId;
  } catch {
    // Keep rendering local data if the provider check is temporarily unavailable.
    return false;
  }
}

export async function getInboxPayload(services = createInboxServices()) {
  const [emails, sync] = await Promise.all([listInboxEmails(), getSyncState()]);
  const newestStoredMessageId = emails[0]?.providerMessageId ?? null;
  const shouldAutoSync = sync.active
    ? false
    : await shouldAutoSyncInbox(newestStoredMessageId, services);

  return {
    emails,
    sync,
    shouldAutoSync,
  };
}

export async function syncInbox(services = createInboxServices()) {
  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = (async () => {
    await setSyncState({
      status: "running",
      phase: "listing",
      message: "Fetching unread TLDR newsletters from Gmail…",
      discoveredEmails: 0,
      processedEmails: 0,
      active: true,
      lastStartedAt: nowTs(),
      lastError: null,
    });

    try {
      const refs = await services.mailProvider.listUnreadCandidates();

      await setSyncState({
        status: "running",
        phase: "fetching",
        message: `Found ${refs.length} unread candidate newsletters. Loading message bodies…`,
        discoveredEmails: refs.length,
        processedEmails: 0,
        active: true,
      });

      for (const [index, ref] of refs.entries()) {
        const message = await services.mailProvider.getMessage(ref.id);
        const source = pickDigestSource(message);

        if (!source) {
          await setSyncState({
            status: "running",
            phase: "parsing",
            message: `Skipping unsupported message ${index + 1} of ${refs.length}.`,
            discoveredEmails: refs.length,
            processedEmails: index + 1,
            active: true,
          });
          continue;
        }

        const parsed = source.parse(message);
        await upsertParsedEmail(parsed);

        await setSyncState({
          status: "running",
          phase: "persisting",
          message: `Parsed ${parsed.sourceVariant} issue ${index + 1} of ${refs.length}.`,
          discoveredEmails: refs.length,
          processedEmails: index + 1,
          active: true,
        });
      }

      const emails = await listInboxEmails();
      const pendingReadSync = emails.filter(
        (email) =>
          email.completionState === "complete" && email.gmailSyncPending,
      );

      if (pendingReadSync.length > 0) {
        await setSyncState({
          status: "running",
          phase: "gmail",
          message: `Retrying Gmail read-state sync for ${pendingReadSync.length} completed email(s)…`,
          discoveredEmails: refs.length,
          processedEmails: refs.length,
          active: true,
        });
      }

      for (const email of pendingReadSync) {
        try {
          await services.mailProvider.markMessageRead(email.providerMessageId);
          await setEmailGmailSyncPending(email.id, false);
        } catch {
          await setEmailGmailSyncPending(email.id, true);
        }
      }

      await setSyncState({
        status: "idle",
        phase: "ready",
        message:
          refs.length === 0
            ? "No unread TLDR newsletters found."
            : `Inbox ready. Processed ${refs.length} unread newsletter(s).`,
        discoveredEmails: refs.length,
        processedEmails: refs.length,
        active: false,
        lastFinishedAt: nowTs(),
      });
    } catch (error) {
      await setSyncState({
        status: "error",
        phase: "failed",
        message: "Sync failed. Review the latest error and retry.",
        active: false,
        lastFinishedAt: nowTs(),
        lastError:
          error instanceof Error ? error.message : "Unknown sync error",
      });
      throw error;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

export async function openItem(itemId: number) {
  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const sourceUrl = item.finalUrl ?? item.canonicalUrl ?? item.trackedUrl;
  const bestKnownUrlKey = canonicalizeUrl(sourceUrl);
  const existing = await getSnapshotByUrlKey(bestKnownUrlKey);

  if (existing?.status === "ready") {
    return {
      snapshot: existing,
      item,
    };
  }

  await upsertSnapshot(bestKnownUrlKey, {
    status: "fetching",
    sourceUrl,
    finalUrl: sourceUrl,
  });

  try {
    const readable = await fetchReadableSnapshot(sourceUrl);
    const snapshot =
      (await getSnapshotByUrlKey(readable.urlKey)) ??
      (await upsertSnapshot(readable.urlKey, {
        status: "ready",
        sourceUrl: readable.sourceUrl,
        finalUrl: readable.finalUrl,
        title: readable.title,
        byline: readable.byline,
        siteName: readable.siteName,
        excerpt: readable.excerpt,
        contentHtml: readable.contentHtml,
        contentText: readable.contentText,
        fetchedAt: nowTs(),
      }));

    await updateItemUrls(itemId, {
      canonicalUrl: readable.urlKey,
      finalUrl: readable.finalUrl,
    });

    return {
      snapshot:
        snapshot ??
        (await upsertSnapshot(readable.urlKey, {
          status: "ready",
          sourceUrl: readable.sourceUrl,
          finalUrl: readable.finalUrl,
          title: readable.title,
          byline: readable.byline,
          siteName: readable.siteName,
          excerpt: readable.excerpt,
          contentHtml: readable.contentHtml,
          contentText: readable.contentText,
          fetchedAt: nowTs(),
        })),
      item: {
        ...item,
        canonicalUrl: readable.urlKey,
        finalUrl: readable.finalUrl,
      },
    };
  } catch (error) {
    const failedSnapshot = await upsertSnapshot(bestKnownUrlKey, {
      status: "failed",
      sourceUrl,
      finalUrl: sourceUrl,
      errorMessage:
        error instanceof Error ? error.message : "Failed to fetch article",
    });

    return {
      snapshot: failedSnapshot ?? null,
      item,
    };
  }
}

export async function recordLinkOpen(
  itemId: number,
  metadata: ItemInteractionMetadata = {},
) {
  await recordItemInteraction(itemId, "link_open", metadata);
  return {
    ok: true,
  };
}

export async function resolveItem(
  itemId: number,
  services = createInboxServices(),
  metadata: ItemInteractionMetadata = {},
) {
  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const result = await markItemResolved(itemId);
  await recordItemInteraction(itemId, "resolve", metadata);

  if (result.complete) {
    const email = await getEmailById(item.emailId);
    if (email) {
      try {
        await services.mailProvider.markMessageRead(email.providerMessageId);
        await setEmailGmailSyncPending(email.id, false);
      } catch {
        await setEmailGmailSyncPending(email.id, true);
      }
      await refreshEmailCounts(email.id);
    }
  }

  return listInboxEmails();
}

export async function unresolveItem(itemId: number) {
  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  await markItemUnresolved(itemId);
  await recordItemInteraction(itemId, "unresolve");
  return listInboxEmails();
}
