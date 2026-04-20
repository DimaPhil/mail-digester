import {
  INTEREST_CLASSIFICATION_CONCURRENCY,
  OPENAI_API_KEY,
  OPENAI_MODEL,
} from "@/lib/config";
import { fetchReadableSnapshot } from "@/lib/content/readability";
import { canonicalizeUrl } from "@/lib/content/url";
import {
  clearItemAiFeatures,
  clearItemInterests,
  getAppConfig,
  getEmailById,
  getItemById,
  getSnapshotByUrlKey,
  getSyncState,
  listInboxEmails,
  listItemInterestInputs,
  listNonInterestingBulkResolveCandidates,
  markItemResolved,
  markItemUnresolved,
  recordItemInteraction,
  refreshEmailCounts,
  setEmailGmailSyncPending,
  setSyncState,
  updateAppConfigAiFeaturePrompt,
  updateAppConfigPrompt,
  updateItemAiFeature,
  updateItemInterest,
  updateItemUrls,
  upsertParsedEmail,
  upsertSnapshot,
  type AppConfigRecord,
  type InboxEmail,
  type ItemInteractionMetadata,
} from "@/lib/db/repository";
import { pickDigestSource } from "@/lib/digest";
import type { ParsedDigestEmail, ParsedDigestItem } from "@/lib/digest/types";
import {
  FixtureAiFeatureClassifier,
  OpenAIAiFeatureClassifier,
  type AiFeatureClassifier,
} from "@/lib/inbox/ai-feature-classifier";
import { normalizeAiFeaturePrompt } from "@/lib/inbox/ai-feature";
import {
  FixtureInterestClassifier,
  OpenAIInterestClassifier,
  type InterestClassifier,
} from "@/lib/inbox/interest-classifier";
import { normalizeInterestPrompt } from "@/lib/inbox/interest";
import { FixtureMailProvider } from "@/lib/mail/providers/fixture";
import { GmailGwsProvider } from "@/lib/mail/providers/gmail-gws";
import type { MailProvider } from "@/lib/mail/types";
import { nowTs } from "@/lib/utils";

let syncPromise: Promise<void> | null = null;

export type InboxServices = {
  mailProvider: MailProvider;
  interestClassifier: InterestClassifier;
  aiFeatureClassifier: AiFeatureClassifier;
};

export type SyncInboxOptions = {
  forceFullResync?: boolean;
  includeResolvedItemsInRecheck?: boolean;
};

export type InboxAppConfig = {
  interestPrompt: string;
  interestPromptVersion: number;
  aiFeaturePrompt: string;
  aiFeaturePromptVersion: number;
  openAiApiKeyConfigured: boolean;
  openAiModel: string;
  interestRefreshPendingCount: number;
  aiFeatureRefreshPendingCount: number;
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
    interestClassifier:
      overrides.interestClassifier ??
      (useFixtures
        ? new FixtureInterestClassifier()
        : new OpenAIInterestClassifier()),
    aiFeatureClassifier:
      overrides.aiFeatureClassifier ??
      (useFixtures
        ? new FixtureAiFeatureClassifier()
        : new OpenAIAiFeatureClassifier()),
  };
}

function decorateInboxEmails(emails: InboxEmail[], appConfig: AppConfigRecord) {
  const hasInterestPrompt =
    normalizeInterestPrompt(appConfig.interestPrompt) != null;
  const hasAiFeaturePrompt =
    normalizeAiFeaturePrompt(appConfig.aiFeaturePrompt) != null;
  let interestRefreshPendingCount = 0;
  let aiFeatureRefreshPendingCount = 0;

  const decoratedEmails = emails.map((email) => ({
    ...email,
    items: email.items.map((item) => {
      const interestNeedsRefresh =
        hasInterestPrompt &&
        item.interestPromptVersion !== appConfig.interestPromptVersion;
      const aiFeatureNeedsRefresh =
        hasAiFeaturePrompt &&
        item.aiFeaturePromptVersion !== appConfig.aiFeaturePromptVersion;

      if (interestNeedsRefresh) {
        interestRefreshPendingCount += 1;
      }

      if (aiFeatureNeedsRefresh) {
        aiFeatureRefreshPendingCount += 1;
      }

      return {
        ...item,
        interestStatus:
          !hasInterestPrompt || interestNeedsRefresh
            ? ("unclassified" as const)
            : item.interestStatus,
        interestReason:
          !hasInterestPrompt || interestNeedsRefresh
            ? null
            : item.interestReason,
        interestModel:
          !hasInterestPrompt || interestNeedsRefresh
            ? null
            : item.interestModel,
        interestClassifiedAt:
          !hasInterestPrompt || interestNeedsRefresh
            ? null
            : item.interestClassifiedAt,
        interestNeedsRefresh,
        aiFeatureStatus:
          !hasAiFeaturePrompt || aiFeatureNeedsRefresh
            ? ("unclassified" as const)
            : item.aiFeatureStatus,
        aiFeatureReason:
          !hasAiFeaturePrompt || aiFeatureNeedsRefresh
            ? null
            : item.aiFeatureReason,
        aiFeatureModel:
          !hasAiFeaturePrompt || aiFeatureNeedsRefresh
            ? null
            : item.aiFeatureModel,
        aiFeatureClassifiedAt:
          !hasAiFeaturePrompt || aiFeatureNeedsRefresh
            ? null
            : item.aiFeatureClassifiedAt,
        aiFeatureNeedsRefresh,
      };
    }),
  }));

  return {
    emails: decoratedEmails,
    interestRefreshPendingCount,
    aiFeatureRefreshPendingCount,
  };
}

function toInboxAppConfig(
  appConfig: AppConfigRecord,
  interestRefreshPendingCount: number,
  aiFeatureRefreshPendingCount: number,
): InboxAppConfig {
  return {
    interestPrompt: appConfig.interestPrompt ?? "",
    interestPromptVersion: appConfig.interestPromptVersion,
    aiFeaturePrompt: appConfig.aiFeaturePrompt ?? "",
    aiFeaturePromptVersion: appConfig.aiFeaturePromptVersion,
    openAiApiKeyConfigured: Boolean(OPENAI_API_KEY),
    openAiModel: OPENAI_MODEL,
    interestRefreshPendingCount,
    aiFeatureRefreshPendingCount,
  };
}

async function listVisibleInboxEmails() {
  const [emails, appConfig] = await Promise.all([
    listInboxEmails(),
    getAppConfig(),
  ]);
  return decorateInboxEmails(emails, appConfig).emails;
}

async function shouldAutoSyncInbox(
  lastSuccessfulSyncStartedAt: number | null,
  services: InboxServices,
) {
  try {
    const refs = await services.mailProvider.listUnreadCandidates({
      afterTs: lastSuccessfulSyncStartedAt,
    });
    return refs.length > 0;
  } catch {
    return false;
  }
}

function resolveInboxServices(overrides: Partial<InboxServices> = {}) {
  return createInboxServices(overrides);
}

async function mapWithConcurrency<T, TResult>(
  inputs: T[],
  concurrency: number,
  mapper: (input: T, index: number) => Promise<TResult>,
) {
  if (inputs.length === 0) {
    return [] satisfies TResult[];
  }

  const results = new Array<TResult>(inputs.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, inputs.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= inputs.length) {
          return;
        }

        results[currentIndex] = await mapper(
          inputs[currentIndex],
          currentIndex,
        );
      }
    }),
  );

  return results;
}

async function classifyParsedEmail(
  parsed: ParsedDigestEmail,
  appConfig: AppConfigRecord,
  services: InboxServices,
) {
  const prompt = normalizeInterestPrompt(appConfig.interestPrompt);
  if (!prompt) {
    return parsed;
  }

  const classifiedItems = await mapWithConcurrency(
    parsed.items,
    INTEREST_CLASSIFICATION_CONCURRENCY,
    async (item) => {
      const classification = await services.interestClassifier.classifyLink(
        {
          itemId: 0,
          emailId: 0,
          emailReceivedAt: parsed.receivedAt,
          sourceVariant: parsed.sourceVariant,
          emailSubject: parsed.subject,
          senderName: parsed.senderName,
          senderEmail: parsed.senderEmail,
          section: item.section,
          position: item.position,
          title: item.title,
          summary: item.summary,
          readTimeText: item.readTimeText,
          itemKind: item.itemKind,
          trackedUrl: item.trackedUrl,
          canonicalUrl: item.canonicalUrl,
          finalUrl: item.finalUrl,
        },
        appConfig,
        {
          model: OPENAI_MODEL,
        },
      );

      return {
        ...item,
        interest: classification,
      };
    },
  );

  return {
    ...parsed,
    items: classifiedItems,
  };
}

async function buildAiFeatureListForStoredItems(
  appConfig: AppConfigRecord,
  services: InboxServices,
  options: {
    includeResolvedItems: boolean;
  },
) {
  const prompt = normalizeAiFeaturePrompt(appConfig.aiFeaturePrompt);
  const storedInputs = await listItemInterestInputs({
    includeResolved: options.includeResolvedItems,
  });

  if (!prompt) {
    await clearItemAiFeatures();
    return;
  }

  await mapWithConcurrency(
    storedInputs,
    INTEREST_CLASSIFICATION_CONCURRENCY,
    async (input) => {
      const classification = await services.aiFeatureClassifier.classifyLink(
        input,
        appConfig,
        {
          model: OPENAI_MODEL,
        },
      );
      await updateItemAiFeature(input.itemId, classification);
    },
  );
}

async function syncCompletedEmailReadState(
  emailId: number,
  services: InboxServices,
) {
  const email = await getEmailById(emailId);
  if (!email || email.completionState !== "complete") {
    return;
  }

  try {
    await services.mailProvider.markMessageRead(email.providerMessageId);
    await setEmailGmailSyncPending(email.id, false);
  } catch {
    await setEmailGmailSyncPending(email.id, true);
  }

  await refreshEmailCounts(email.id);
}

export async function getInboxPayload(services: Partial<InboxServices> = {}) {
  const resolvedServices = resolveInboxServices(services);
  const [rawEmails, sync, appConfig] = await Promise.all([
    listInboxEmails(),
    getSyncState(),
    getAppConfig(),
  ]);
  const decorated = decorateInboxEmails(rawEmails, appConfig);
  const shouldAutoSync = sync.active
    ? false
    : await shouldAutoSyncInbox(
        sync.lastSuccessfulSyncStartedAt,
        resolvedServices,
      );

  return {
    emails: decorated.emails,
    sync,
    shouldAutoSync,
    appConfig: toInboxAppConfig(
      appConfig,
      decorated.interestRefreshPendingCount,
      decorated.aiFeatureRefreshPendingCount,
    ),
  };
}

export async function updateInterestPrompt(prompt: string | null | undefined) {
  const normalizedPrompt = normalizeInterestPrompt(prompt);
  if (normalizedPrompt && !OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be configured before saving an interest prompt.",
    );
  }

  await updateAppConfigPrompt(normalizedPrompt);
  return getInboxPayload();
}

export async function updateAiFeaturePrompt(prompt: string | null | undefined) {
  const normalizedPrompt = normalizeAiFeaturePrompt(prompt);
  if (normalizedPrompt && !OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be configured before saving an AI feature prompt.",
    );
  }

  await updateAppConfigAiFeaturePrompt(normalizedPrompt);
  return getInboxPayload();
}

export async function syncInbox(
  services: Partial<InboxServices> = {},
  options: SyncInboxOptions = {},
) {
  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = (async () => {
    const resolvedServices = resolveInboxServices(services);
    const syncStartedAt = nowTs();
    const [currentSyncState, appConfig] = await Promise.all([
      getSyncState(),
      getAppConfig(),
    ]);
    const forceFullResync = options.forceFullResync === true;
    const includeResolvedItemsInRecheck =
      forceFullResync && options.includeResolvedItemsInRecheck === true;
    const incrementalCutoff = forceFullResync
      ? null
      : currentSyncState.lastSuccessfulSyncStartedAt;

    await setSyncState({
      status: "running",
      phase: "listing",
      message:
        incrementalCutoff == null
          ? forceFullResync
            ? "Running full inbox reclassification and unread newsletter sync…"
            : "Fetching unread TLDR newsletters from Gmail…"
          : "Fetching unread TLDR newsletters added since the last successful sync…",
      discoveredEmails: 0,
      processedEmails: 0,
      active: true,
      lastStartedAt: syncStartedAt,
      lastError: null,
    });

    try {
      if (forceFullResync) {
        const storedInputs = await listItemInterestInputs({
          includeResolved: includeResolvedItemsInRecheck,
        });
        if (storedInputs.length > 0) {
          await setSyncState({
            status: "running",
            phase: "classifying",
            message: `Reclassifying ${storedInputs.length} ${includeResolvedItemsInRecheck ? "stored" : "unresolved"} link${storedInputs.length === 1 ? "" : "s"} with the current prompt…`,
            discoveredEmails: storedInputs.length,
            processedEmails: 0,
            active: true,
          });

          const prompt = normalizeInterestPrompt(appConfig.interestPrompt);
          if (!prompt) {
            await clearItemInterests();
          } else {
            let processedCount = 0;
            let progressUpdate = Promise.resolve();

            await mapWithConcurrency(
              storedInputs,
              INTEREST_CLASSIFICATION_CONCURRENCY,
              async (input) => {
                const classification =
                  await resolvedServices.interestClassifier.classifyLink(
                    input,
                    appConfig,
                    {
                      model: OPENAI_MODEL,
                    },
                  );
                await updateItemInterest(input.itemId, classification);

                processedCount += 1;
                const nextProcessedCount = processedCount;
                progressUpdate = progressUpdate.then(() =>
                  setSyncState({
                    status: "running",
                    phase: "classifying",
                    message: `Reclassified link ${nextProcessedCount} of ${storedInputs.length}.`,
                    discoveredEmails: storedInputs.length,
                    processedEmails: nextProcessedCount,
                    active: true,
                  }),
                );
                await progressUpdate;
              },
            );

            await progressUpdate;
          }

          if (!prompt) {
            await setSyncState({
              status: "running",
              phase: "classifying",
              message:
                "Cleared stored interest classifications because no prompt is configured.",
              discoveredEmails: storedInputs.length,
              processedEmails: storedInputs.length,
              active: true,
            });
          }
        } else if (!normalizeInterestPrompt(appConfig.interestPrompt)) {
          await clearItemInterests();
        }
      }

      const refs = await resolvedServices.mailProvider.listUnreadCandidates({
        afterTs: incrementalCutoff,
      });

      await setSyncState({
        status: "running",
        phase: "fetching",
        message:
          refs.length === 0
            ? incrementalCutoff == null
              ? "No unread candidate newsletters found."
              : "No new unread candidate newsletters found since the last successful sync."
            : `Found ${refs.length} unread candidate newsletter${refs.length === 1 ? "" : "s"}. Loading message bodies…`,
        discoveredEmails: refs.length,
        processedEmails: 0,
        active: true,
      });

      for (const [index, ref] of refs.entries()) {
        const message = await resolvedServices.mailProvider.getMessage(ref.id);
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

        const parsed = await classifyParsedEmail(
          source.parse(message),
          appConfig,
          resolvedServices,
        );
        await upsertParsedEmail(parsed, {
          preserveResolvedItemInterests: !includeResolvedItemsInRecheck,
        });

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
        await syncCompletedEmailReadState(email.id, resolvedServices);
      }

      await setSyncState({
        status: "idle",
        phase: "ready",
        message:
          refs.length === 0
            ? incrementalCutoff == null
              ? "No unread TLDR newsletters found."
              : "Inbox ready. No new unread TLDR newsletters needed syncing."
            : `Inbox ready. Processed ${refs.length} unread newsletter(s).`,
        discoveredEmails: refs.length,
        processedEmails: refs.length,
        active: false,
        lastFinishedAt: nowTs(),
        lastSuccessfulSyncStartedAt: syncStartedAt,
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

export async function buildAiFeatureList(
  services: Partial<InboxServices> = {},
  options: {
    includeResolvedItems?: boolean;
  } = {},
) {
  const resolvedServices = resolveInboxServices(services);
  const appConfig = await getAppConfig();
  const prompt = normalizeAiFeaturePrompt(appConfig.aiFeaturePrompt);

  if (!prompt) {
    throw new Error("Set an AI feature prompt before building the list.");
  }

  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be configured before building the AI feature list.",
    );
  }

  await buildAiFeatureListForStoredItems(appConfig, resolvedServices, {
    includeResolvedItems: options.includeResolvedItems === true,
  });

  return getInboxPayload(resolvedServices);
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

export async function recordDescriptionExpand(
  itemId: number,
  metadata: ItemInteractionMetadata = {},
) {
  await recordItemInteraction(itemId, "description_expand", metadata);
  return {
    ok: true,
  };
}

export async function resolveItem(
  itemId: number,
  services: Partial<InboxServices> = {},
  metadata: ItemInteractionMetadata = {},
) {
  const resolvedServices = resolveInboxServices(services);
  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const result = await markItemResolved(itemId);
  await recordItemInteraction(itemId, "resolve", metadata);

  if (result.complete) {
    await syncCompletedEmailReadState(item.emailId, resolvedServices);
  }

  return listVisibleInboxEmails();
}

export async function resolveNonInterestingItems(
  keepRecentDays: number,
  services: Partial<InboxServices> = {},
  metadata: ItemInteractionMetadata = {},
) {
  const resolvedServices = resolveInboxServices(services);
  if (!Number.isFinite(keepRecentDays) || keepRecentDays < 0) {
    throw new Error("Keep recent days must be a non-negative number.");
  }

  const appConfig = await getAppConfig();
  const prompt = normalizeInterestPrompt(appConfig.interestPrompt);
  if (!prompt) {
    throw new Error("Set an interest prompt before bulk resolving links.");
  }

  const receivedBeforeTs = nowTs() - Math.floor(keepRecentDays) * 86_400_000;
  const candidates = await listNonInterestingBulkResolveCandidates({
    promptVersion: appConfig.interestPromptVersion,
    receivedBeforeTs,
  });

  let resolvedCount = 0;

  for (const candidate of candidates) {
    const item = await getItemById(candidate.itemId);
    if (!item || item.resolvedAt != null) {
      continue;
    }

    const result = await markItemResolved(candidate.itemId);
    await recordItemInteraction(candidate.itemId, "resolve", {
      ...metadata,
      bulkResolveMode: "not_interesting",
      keepRecentDays: Math.floor(keepRecentDays),
    });
    resolvedCount += 1;

    if (result.complete) {
      await syncCompletedEmailReadState(candidate.emailId, resolvedServices);
    }
  }

  return {
    emails: await listVisibleInboxEmails(),
    resolvedCount,
  };
}

export async function unresolveItem(itemId: number) {
  const item = await getItemById(itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  await markItemUnresolved(itemId);
  await recordItemInteraction(itemId, "unresolve");
  return listVisibleInboxEmails();
}
