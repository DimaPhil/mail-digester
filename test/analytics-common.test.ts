import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  FILTER_RULE_ACTIONS,
  FILTER_RULE_CONFIDENCE,
  FILTER_RULE_FIELDS,
  FILTER_RULE_OPERATORS,
} from "@/lib/filtering/contracts";

type AnalyticsInteraction = {
  action: string;
  resolveMode: string | null;
  title: string;
  fullDescription: string;
  snapshotStatus: string | null;
  snapshotTitle: string | null;
  snapshotByline: string | null;
  snapshotSiteName: string | null;
  snapshotExcerpt: string | null;
  snapshotContentText: string | null;
};

type LoadInteractions = (input: { dbPath: string; sinceDays?: number }) => {
  interactions: AnalyticsInteraction[];
  warning: string | null;
};

async function getLoadInteractions(): Promise<LoadInteractions> {
  // @ts-expect-error Analytics scripts intentionally stay in .mjs for direct Node execution.
  const analyticsModule = (await import("../analytics/common.mjs")) as {
    loadInteractions: LoadInteractions;
  };

  return analyticsModule.loadInteractions;
}

function createAnalyticsDb() {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "mail-digester-analytics-"),
  );
  const dbPath = path.join(tempDir, "mail-digester.sqlite");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE item_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      email_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      resolve_mode TEXT,
      opened_before_resolve INTEGER,
      provider TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      provider_thread_id TEXT,
      source_family TEXT NOT NULL,
      source_variant TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      email_subject TEXT NOT NULL,
      email_received_at INTEGER NOT NULL,
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      item_kind TEXT NOT NULL,
      read_time_text TEXT,
      title TEXT NOT NULL,
      full_description TEXT NOT NULL,
      tracked_url TEXT NOT NULL,
      canonical_url TEXT,
      final_url TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE article_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_key TEXT NOT NULL UNIQUE,
      source_url TEXT NOT NULL,
      final_url TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      byline TEXT,
      site_name TEXT,
      excerpt TEXT,
      content_html TEXT,
      content_text TEXT,
      error_message TEXT,
      fetched_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);

  return {
    db,
    dbPath,
    cleanup() {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("analytics interaction loading", () => {
  it("keeps title and newsletter description for direct resolves", async () => {
    const fixture = createAnalyticsDb();
    const loadInteractions = await getLoadInteractions();

    try {
      fixture.db
        .prepare(
          `
            INSERT INTO item_interactions (
              item_id, email_id, action, resolve_mode, opened_before_resolve,
              provider, provider_message_id, provider_thread_id, source_family,
              source_variant, sender_name, sender_email, email_subject,
              email_received_at, section, position, item_kind, read_time_text,
              title, full_description, tracked_url, canonical_url, final_url,
              metadata_json, created_at
            ) VALUES (
              1, 11, 'resolve', 'direct', 0,
              'gmail', 'provider-msg-1', 'thread-1', 'TLDR', 'TLDR AI',
              'TLDR AI', 'dan@tldrnewsletter.com', 'Issue 1',
              1700000000000, 'Headlines & Launches', 1, 'editorial', '4 minute read',
              'Nvidia Profits Soar', 'Quarterly earnings summary from the newsletter body.',
              'https://tracking.example/item', 'https://example.com/nvidia', NULL,
              '{"layout":"mobile"}', 1700000001000
            )
          `,
        )
        .run();

      const loaded = loadInteractions({ dbPath: fixture.dbPath });
      expect(loaded.warning).toBeNull();
      expect(loaded.interactions).toHaveLength(1);
      expect(loaded.interactions[0]).toMatchObject({
        action: "resolve",
        resolveMode: "direct",
        title: "Nvidia Profits Soar",
        fullDescription: "Quarterly earnings summary from the newsletter body.",
        snapshotStatus: null,
        snapshotContentText: null,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("joins cached article snapshots into analytics exports when available", async () => {
    const fixture = createAnalyticsDb();
    const loadInteractions = await getLoadInteractions();

    try {
      fixture.db
        .prepare(
          `
            INSERT INTO article_snapshots (
              url_key, source_url, final_url, status, title, byline, site_name,
              excerpt, content_html, content_text, error_message, fetched_at, updated_at
            ) VALUES (
              'https://example.com/apple-chip',
              'https://example.com/apple-chip',
              'https://example.com/apple-chip',
              'ready',
              'Testing shows Apple N1 Wi-Fi chip improves on older Broadcom chips in every way',
              'Jane Reporter',
              'Example Tech',
              'Benchmark summary.',
              '<p>Benchmark summary.</p>',
              'Benchmark summary. The article text is available for downstream analysis.',
              NULL,
              1700000002000,
              1700000002000
            )
          `,
        )
        .run();

      fixture.db
        .prepare(
          `
            INSERT INTO item_interactions (
              item_id, email_id, action, resolve_mode, opened_before_resolve,
              provider, provider_message_id, provider_thread_id, source_family,
              source_variant, sender_name, sender_email, email_subject,
              email_received_at, section, position, item_kind, read_time_text,
              title, full_description, tracked_url, canonical_url, final_url,
              metadata_json, created_at
            ) VALUES (
              2, 12, 'resolve', 'after_open', 1,
              'gmail', 'provider-msg-2', 'thread-2', 'TLDR', 'TLDR',
              'TLDR', 'dan@tldrnewsletter.com', 'Issue 2',
              1700000003000, 'Big Tech & Startups', 2, 'editorial', '4 minute read',
              'Apple N1 Wi-Fi chip improves on Broadcom',
              'Newsletter summary for the Apple chip article.',
              'https://tracking.example/apple-chip',
              'https://example.com/apple-chip',
              'https://example.com/apple-chip',
              '{"layout":"desktop"}', 1700000004000
            )
          `,
        )
        .run();

      const loaded = loadInteractions({ dbPath: fixture.dbPath });
      expect(loaded.interactions).toHaveLength(1);
      expect(loaded.interactions[0]).toMatchObject({
        title: "Apple N1 Wi-Fi chip improves on Broadcom",
        fullDescription: "Newsletter summary for the Apple chip article.",
        snapshotStatus: "ready",
        snapshotTitle:
          "Testing shows Apple N1 Wi-Fi chip improves on older Broadcom chips in every way",
        snapshotByline: "Jane Reporter",
        snapshotSiteName: "Example Tech",
        snapshotExcerpt: "Benchmark summary.",
      });
      expect(loaded.interactions[0].snapshotContentText).toContain(
        "downstream analysis",
      );
    } finally {
      fixture.cleanup();
    }
  });
});

describe("filter recommendation contract", () => {
  it("exports the supported rule enums for future app-side filtering", () => {
    expect(FILTER_RULE_ACTIONS).toEqual(["promote", "deprioritize", "hide"]);
    expect(FILTER_RULE_FIELDS).toContain("fullDescription");
    expect(FILTER_RULE_FIELDS).toContain("siteName");
    expect(FILTER_RULE_OPERATORS).toEqual([
      "equals",
      "contains",
      "startsWith",
      "anyOf",
    ]);
    expect(FILTER_RULE_CONFIDENCE).toEqual(["low", "medium", "high"]);
  });
});
