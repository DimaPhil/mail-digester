import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function parseFlags(argv) {
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue != null) {
      flags[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return flags;
}

export function readStringFlag(flags, name, fallback) {
  const value = flags[name];
  return typeof value === "string" ? value : fallback;
}

export function readNumberFlag(flags, name, fallback) {
  const value = flags[name];
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function defaultDbPath() {
  return (
    process.env.MAIL_DIGESTER_DB_PATH ??
    path.join(process.cwd(), "data", "mail-digester.sqlite")
  );
}

export function loadInteractions({ dbPath, sinceDays }) {
  if (!fs.existsSync(dbPath)) {
    return {
      interactions: [],
      warning: `SQLite DB not found at ${dbPath}`,
    };
  }

  const db = new Database(dbPath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const interactionTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
      )
      .get("table", "item_interactions");

    if (interactionTable?.name !== "item_interactions") {
      return {
        interactions: [],
        warning: "item_interactions table does not exist yet.",
      };
    }

    const snapshotsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
      )
      .get("table", "article_snapshots");
    const canJoinSnapshots = snapshotsTable?.name === "article_snapshots";

    const since =
      sinceDays && sinceDays > 0
        ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
        : null;

    const fromClause = canJoinSnapshots
      ? `
          FROM item_interactions interactions
          LEFT JOIN article_snapshots snapshots
            ON snapshots.url_key = COALESCE(
              NULLIF(interactions.canonical_url, ''),
              NULLIF(interactions.final_url, ''),
              interactions.tracked_url
            )
        `
      : `
          FROM item_interactions interactions
        `;
    const snapshotSelect = canJoinSnapshots
      ? `
              snapshots.status AS snapshotStatus,
              snapshots.source_url AS snapshotSourceUrl,
              snapshots.final_url AS snapshotFinalUrl,
              snapshots.title AS snapshotTitle,
              snapshots.byline AS snapshotByline,
              snapshots.site_name AS snapshotSiteName,
              snapshots.excerpt AS snapshotExcerpt,
              snapshots.content_text AS snapshotContentText,
              snapshots.error_message AS snapshotErrorMessage,
              snapshots.fetched_at AS snapshotFetchedAt
        `
      : `
              NULL AS snapshotStatus,
              NULL AS snapshotSourceUrl,
              NULL AS snapshotFinalUrl,
              NULL AS snapshotTitle,
              NULL AS snapshotByline,
              NULL AS snapshotSiteName,
              NULL AS snapshotExcerpt,
              NULL AS snapshotContentText,
              NULL AS snapshotErrorMessage,
              NULL AS snapshotFetchedAt
        `;

    return {
      interactions: db
        .prepare(
          `
            SELECT
              interactions.id AS id,
              interactions.item_id AS itemId,
              interactions.email_id AS emailId,
              interactions.action AS action,
              interactions.resolve_mode AS resolveMode,
              interactions.opened_before_resolve AS openedBeforeResolve,
              interactions.provider AS provider,
              interactions.provider_message_id AS providerMessageId,
              interactions.provider_thread_id AS providerThreadId,
              interactions.source_family AS sourceFamily,
              interactions.source_variant AS sourceVariant,
              interactions.sender_name AS senderName,
              interactions.sender_email AS senderEmail,
              interactions.email_subject AS emailSubject,
              interactions.email_received_at AS emailReceivedAt,
              interactions.section AS section,
              interactions.position AS position,
              interactions.item_kind AS itemKind,
              interactions.read_time_text AS readTimeText,
              interactions.title AS title,
              interactions.full_description AS fullDescription,
              interactions.tracked_url AS trackedUrl,
              interactions.canonical_url AS canonicalUrl,
              interactions.final_url AS finalUrl,
              interactions.metadata_json AS metadataJson,
              interactions.created_at AS createdAt,
            ${snapshotSelect}
            ${fromClause}
            WHERE (? IS NULL OR interactions.created_at >= ?)
            ORDER BY interactions.created_at ASC, interactions.id ASC
          `,
        )
        .all(since, since),
      warning: null,
    };
  } finally {
    db.close();
  }
}

export function writeOutput({ content, outputPath }) {
  if (!outputPath) {
    process.stdout.write(content);
    if (!content.endsWith("\n")) {
      process.stdout.write("\n");
    }
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });
  fs.writeFileSync(outputPath, content);
}
