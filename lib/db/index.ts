import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DB_PATH } from "@/lib/config";
import * as schema from "@/lib/db/schema";
import { nowTs } from "@/lib/utils";

declare global {
  var __mailDigesterDb:
    | {
        sqlite: Database.Database;
        orm: ReturnType<typeof drizzle<typeof schema>>;
        initialized: boolean;
      }
    | undefined;
}

function createDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const orm = drizzle(sqlite, { schema });

  return {
    sqlite,
    orm,
    initialized: false,
  };
}

function getInstance() {
  if (!globalThis.__mailDigesterDb) {
    globalThis.__mailDigesterDb = createDatabase();
  }

  return globalThis.__mailDigesterDb;
}

function initializeSchema() {
  const instance = getInstance();
  if (instance.initialized) {
    return;
  }

  instance.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      provider_thread_id TEXT,
      source_family TEXT NOT NULL,
      source_variant TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      completion_state TEXT NOT NULL DEFAULT 'active',
      gmail_sync_pending INTEGER NOT NULL DEFAULT 0,
      total_items INTEGER NOT NULL DEFAULT 0,
      resolved_items INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS emails_provider_message_idx
    ON emails(provider, provider_message_id);

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      source_item_id TEXT NOT NULL,
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      read_time_text TEXT,
      item_kind TEXT NOT NULL,
      tracked_url TEXT NOT NULL,
      canonical_url TEXT,
      final_url TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS items_email_source_item_idx
    ON items(email_id, source_item_id);

    CREATE TABLE IF NOT EXISTS article_snapshots (
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

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      message TEXT NOT NULL,
      discovered_emails INTEGER NOT NULL DEFAULT 0,
      processed_emails INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0,
      last_started_at INTEGER,
      last_finished_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  instance.sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO sync_state (
        id, status, phase, message, discovered_emails, processed_emails, active, updated_at
      ) VALUES (
        1, 'idle', 'ready', 'Ready to sync unread TLDR mail.', 0, 0, 0, ?
      )
    `,
    )
    .run(nowTs());

  instance.initialized = true;
}

export function getDb() {
  initializeSchema();
  return getInstance().orm;
}

export function getSqlite() {
  initializeSchema();
  return getInstance().sqlite;
}
