import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { providerMessageFromFixture } from "@/lib/digest/tldr";
import { FixtureMailProvider } from "@/lib/mail/providers/fixture";

type ServiceModule = typeof import("@/lib/inbox/service");
type RepositoryModule = typeof import("@/lib/db/repository");

async function loadModules() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-digester-"));
  process.env.MAIL_DIGESTER_DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.MAIL_DIGESTER_USE_FIXTURE_DATA = "1";
  process.env.MAIL_DIGESTER_TEST_ARTICLE_BASE_URL = "http://fixtures.test";
  delete (globalThis as { __mailDigesterDb?: unknown }).__mailDigesterDb;
  vi.resetModules();

  const service = (await import("@/lib/inbox/service")) as ServiceModule;
  const repository = (await import("@/lib/db/repository")) as RepositoryModule;

  return {
    tmpDir,
    service,
    repository,
  };
}

describe("Inbox service", () => {
  afterEach(() => {
    delete process.env.MAIL_DIGESTER_DB_PATH;
    delete process.env.MAIL_DIGESTER_USE_FIXTURE_DATA;
    delete process.env.MAIL_DIGESTER_TEST_ARTICLE_BASE_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("syncs unread fixture mail into the local inbox", async () => {
    const { service } = await loadModules();

    await service.syncInbox();
    const payload = await service.getInboxPayload();

    expect(payload.sync.status).toBe("idle");
    expect(payload.sync.lastSuccessfulSyncStartedAt).not.toBeNull();
    expect(payload.emails).toHaveLength(2);
    expect(payload.emails[0].items.length).toBeGreaterThan(0);
    expect(payload.shouldAutoSync).toBe(false);
  });

  it("skips startup auto-sync when there are no unread messages after the last successful sync", async () => {
    const { service, repository } = await loadModules();

    await service.syncInbox();
    await repository.setSyncState({
      status: "idle",
      phase: "ready",
      message: "Old sync metadata",
      active: false,
      lastFinishedAt: Date.parse("2026-04-11T00:00:00Z"),
      lastSuccessfulSyncStartedAt: Date.parse("2026-04-11T00:00:00Z"),
    });

    const payload = await service.getInboxPayload();
    expect(payload.shouldAutoSync).toBe(false);
  });

  it("requests startup auto-sync when Gmail has unread mail after the last successful sync", async () => {
    const { service, repository } = await loadModules();

    await service.syncInbox();
    const lastSuccessfulSyncStartedAt = Date.parse("2026-04-09T12:00:00Z");
    await repository.setSyncState({
      status: "idle",
      phase: "ready",
      message: "Ready",
      active: false,
      lastSuccessfulSyncStartedAt,
    });

    const payload = await service.getInboxPayload({
      mailProvider: {
        listUnreadCandidates: async (options) => {
          expect(options?.afterTs).toBe(lastSuccessfulSyncStartedAt);
          return [{ id: "fixture-new-001" }];
        },
        getMessage: async () => {
          throw new Error("Not used in startup freshness checks");
        },
        markMessageRead: async () => undefined,
      },
    });

    expect(payload.shouldAutoSync).toBe(true);
  });

  it("keeps startup rendering local when unread freshness checks are empty or unavailable", async () => {
    const { service } = await loadModules();

    const noUnreadPayload = await service.getInboxPayload({
      mailProvider: {
        listUnreadCandidates: async () => [],
        getMessage: async () => {
          throw new Error("Not used in startup freshness checks");
        },
        markMessageRead: async () => undefined,
      },
    });
    expect(noUnreadPayload.shouldAutoSync).toBe(false);

    const providerDownPayload = await service.getInboxPayload({
      mailProvider: {
        listUnreadCandidates: async () => {
          throw new Error("provider down");
        },
        getMessage: async () => {
          throw new Error("Not used in startup freshness checks");
        },
        markMessageRead: async () => undefined,
      },
    });
    expect(providerDownPayload.shouldAutoSync).toBe(false);
  });

  it("clears nullable sync metadata after a successful state transition", async () => {
    const { repository } = await loadModules();

    await repository.setSyncState({
      status: "error",
      phase: "failed",
      message: "Failed sync",
      lastError: "old failure",
      lastStartedAt: Date.parse("2026-01-01T00:00:00Z"),
      lastFinishedAt: Date.parse("2026-01-01T00:01:00Z"),
      lastSuccessfulSyncStartedAt: Date.parse("2026-01-01T00:00:00Z"),
    });

    await repository.setSyncState({
      status: "idle",
      phase: "ready",
      message: "Recovered",
      lastError: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSuccessfulSyncStartedAt: null,
    });

    const sync = await repository.getSyncState();
    expect(sync.lastError).toBeNull();
    expect(sync.lastStartedAt).toBeNull();
    expect(sync.lastFinishedAt).toBeNull();
    expect(sync.lastSuccessfulSyncStartedAt).toBeNull();
  });

  it("only syncs unread messages newer than the last successful sync unless forced", async () => {
    const { service, repository } = await loadModules();
    const lastSuccessfulSyncStartedAt = Date.parse("2026-04-10T00:00:00Z");
    const listUnreadCandidates = vi
      .fn()
      .mockResolvedValueOnce([{ id: "incremental-1" }])
      .mockResolvedValueOnce([{ id: "incremental-1" }, { id: "full-1" }]);
    const getMessage = vi.fn(async (messageId: string) =>
      providerMessageFromFixture({
        id: messageId,
        from: "TLDR <dan@tldrnewsletter.com>",
        subject: `Issue ${messageId}`,
        receivedAt: Date.parse("2026-04-11T08:00:00Z"),
        htmlBody: `
          <html><body>
            <p>HEADLINES</p>
            <div>
              <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2F${messageId}/1/token">${messageId} article (2 minute read)</a>
              <span>Summary text that is long enough to keep this item eligible for parsing in the sync flow.</span>
            </div>
          </body></html>
        `,
      }),
    );

    await repository.setSyncState({
      status: "idle",
      phase: "ready",
      message: "Ready",
      active: false,
      lastSuccessfulSyncStartedAt,
    });

    await service.syncInbox({
      mailProvider: {
        listUnreadCandidates,
        getMessage,
        markMessageRead: async () => undefined,
      },
    });

    expect(listUnreadCandidates).toHaveBeenNthCalledWith(1, {
      afterTs: lastSuccessfulSyncStartedAt,
    });

    await service.syncInbox(
      {
        mailProvider: {
          listUnreadCandidates,
          getMessage,
          markMessageRead: async () => undefined,
        },
      },
      {
        forceFullResync: true,
      },
    );

    expect(listUnreadCandidates).toHaveBeenNthCalledWith(2, {
      afterTs: null,
    });
  });

  it("opens an item, extracts article content, and reuses the cached snapshot", async () => {
    const { service } = await loadModules();

    await service.syncInbox();
    const payload = await service.getInboxPayload();
    const item = payload.emails[0].items[0];

    const opened = await service.openItem(item.id);
    expect(opened.snapshot?.status).toBe("ready");
    expect(opened.snapshot?.contentHtml).toContain("packaging shift");

    const reopened = await service.openItem(item.id);
    expect(reopened.snapshot?.status).toBe("ready");
    expect(reopened.snapshot?.urlKey).toBe(opened.snapshot?.urlKey);
  });

  it("records description expands, direct resolves, and link-open-first resolves", async () => {
    const { service, repository } = await loadModules();

    await service.syncInbox();
    const payload = await service.getInboxPayload();
    const firstEmail = payload.emails.find(
      (email) => email.providerMessageId === "fixture-ai-001",
    )!;
    const directItem = firstEmail.items[0];
    const openedItem = firstEmail.items[1];
    const expandedItem = firstEmail.items[2];

    await service.recordDescriptionExpand(expandedItem.id, {
      summaryLength: expandedItem.summary.length,
    });
    await service.resolveItem(directItem.id, undefined, {
      layout: "desktop",
    });
    await service.recordLinkOpen(openedItem.id, {
      href:
        openedItem.finalUrl ?? openedItem.canonicalUrl ?? openedItem.trackedUrl,
      layout: "mobile",
      viewportWidth: 390,
    });
    await service.resolveItem(openedItem.id, undefined, {
      clientOpenedBeforeResolve: true,
      layout: "mobile",
    });

    const interactions = await repository.listItemInteractions();
    const directResolve = interactions.find(
      (interaction) =>
        interaction.itemId === directItem.id &&
        interaction.action === "resolve",
    );
    const openedResolve = interactions.find(
      (interaction) =>
        interaction.itemId === openedItem.id &&
        interaction.action === "resolve",
    );
    const linkOpen = interactions.find(
      (interaction) =>
        interaction.itemId === openedItem.id &&
        interaction.action === "link_open",
    );
    const descriptionExpand = interactions.find(
      (interaction) =>
        interaction.itemId === expandedItem.id &&
        interaction.action === "description_expand",
    );

    expect(descriptionExpand).toMatchObject({
      sourceVariant: "TLDR AI",
      title: expandedItem.title,
      fullDescription: expandedItem.summary,
    });
    expect(descriptionExpand?.metadataJson).toContain('"summaryLength"');
    expect(directResolve).toMatchObject({
      sourceVariant: "TLDR AI",
      title: directItem.title,
      fullDescription: directItem.summary,
      resolveMode: "direct",
      openedBeforeResolve: false,
    });
    expect(openedResolve).toMatchObject({
      sourceVariant: "TLDR AI",
      title: openedItem.title,
      fullDescription: openedItem.summary,
      resolveMode: "after_open",
      openedBeforeResolve: true,
    });
    expect(linkOpen?.metadataJson).toContain('"layout":"mobile"');
    expect(linkOpen?.metadataJson).toContain('"viewportWidth":390');
  });

  it("marks Gmail read after the final item resolves and can undo resolution", async () => {
    const { service } = await loadModules();

    await service.syncInbox();
    const payload = await service.getInboxPayload();
    const firstEmail = payload.emails.find(
      (email) => email.providerMessageId === "fixture-ai-001",
    );
    const markMessageRead = vi.fn(async () => undefined);

    for (const item of firstEmail!.items) {
      await service.resolveItem(item.id, {
        mailProvider: {
          listUnreadCandidates: async () => [],
          getMessage: async () => {
            throw new Error("Not used in resolve flow");
          },
          markMessageRead,
        },
      });
    }

    const afterResolve = await service.getInboxPayload();
    const resolvedEmail = afterResolve.emails.find(
      (email) => email.id === firstEmail!.id,
    );
    expect(markMessageRead).toHaveBeenCalledTimes(1);
    expect(resolvedEmail?.completionState).toBe("complete");
    expect(resolvedEmail?.gmailSyncPending).toBe(false);

    await service.unresolveItem(firstEmail!.items[0].id);
    const afterUndo = await service.getInboxPayload();
    const restoredEmail = afterUndo.emails.find(
      (email) => email.id === firstEmail!.id,
    );
    expect(restoredEmail?.completionState).toBe("active");
    expect(
      restoredEmail?.items.some(
        (item) =>
          item.id === firstEmail!.items[0].id && item.resolvedAt == null,
      ),
    ).toBe(true);
  });

  it("flags Gmail retry pending when the read-state mutation fails", async () => {
    const { service } = await loadModules();
    await service.syncInbox();

    const payload = await service.getInboxPayload();
    const firstEmail = payload.emails.find(
      (email) => email.providerMessageId === "fixture-main-001",
    );

    for (const item of firstEmail!.items) {
      await service.resolveItem(item.id, {
        mailProvider: {
          listUnreadCandidates: async () => [],
          getMessage: async () => {
            throw new Error("Not used in resolve flow");
          },
          markMessageRead: async () => {
            throw new Error("gmail down");
          },
        },
      });
    }

    const afterResolve = await service.getInboxPayload();
    expect(
      afterResolve.emails.find((email) => email.id === firstEmail!.id)
        ?.gmailSyncPending,
    ).toBe(true);
  });

  it("stores a failed snapshot when article fetching fails", async () => {
    const { service } = await loadModules();
    await service.syncInbox({
      mailProvider: {
        listUnreadCandidates: async () => [{ id: "broken-1" }],
        getMessage: async () =>
          providerMessageFromFixture({
            id: "broken-1",
            from: "TLDR <dan@tldrnewsletter.com>",
            subject: "Broken reader",
            htmlBody: `
              <html><body>
                <p>HEADLINES</p>
                <div>
                  <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fbroken-reader%3Futm_source%3Dtldr/1/token">Broken reader item (2 minute read)</a>
                  <span>Summary text that is long enough to keep this item eligible for parsing in the sync flow.</span>
                </div>
              </body></html>
            `,
          }),
        markMessageRead: async () => undefined,
      },
    });
    const payload = await service.getInboxPayload();
    const brokenItem = payload.emails.find(
      (email) => email.subject === "Broken reader",
    )!.items[0];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );

    const opened = await service.openItem(brokenItem.id);
    expect(opened.snapshot?.status).toBe("failed");
    expect(opened.snapshot?.errorMessage).toMatch(/500/);
  });

  it("skips unsupported messages and records sync failures", async () => {
    const { service } = await loadModules();

    await service.syncInbox({
      mailProvider: {
        listUnreadCandidates: async () => [{ id: "unsupported-1" }],
        getMessage: async () =>
          providerMessageFromFixture({
            id: "unsupported-1",
            from: "Other <newsletter@example.com>",
            subject: "Other issue",
            htmlBody:
              '<html><body><a href="https://example.com/story">External story</a></body></html>',
          }),
        markMessageRead: async () => undefined,
      },
    });

    const afterUnsupported = await service.getInboxPayload();
    expect(afterUnsupported.emails).toHaveLength(0);
    expect(afterUnsupported.sync.processedEmails).toBe(1);

    await expect(
      service.syncInbox({
        mailProvider: {
          listUnreadCandidates: async () => {
            throw new Error("boom");
          },
          getMessage: async () => {
            throw new Error("unused");
          },
          markMessageRead: async () => undefined,
        },
      }),
    ).rejects.toThrow(/boom/);

    const afterFailure = await service.getInboxPayload();
    expect(afterFailure.sync.status).toBe("error");
    expect(afterFailure.sync.lastError).toContain("boom");
  });

  it("throws clearly for missing item operations", async () => {
    const { service } = await loadModules();

    await expect(service.openItem(999_999)).rejects.toThrow(/Item not found/i);
    await expect(service.unresolveItem(999_999)).rejects.toThrow(
      /Item not found/i,
    );
  });
});
