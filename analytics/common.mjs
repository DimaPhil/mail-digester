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
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
      )
      .get("table", "item_interactions");

    if (table?.name !== "item_interactions") {
      return {
        interactions: [],
        warning: "item_interactions table does not exist yet.",
      };
    }

    const since =
      sinceDays && sinceDays > 0
        ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
        : null;

    return {
      interactions: db
        .prepare(
          `
            SELECT
              id,
              item_id AS itemId,
              email_id AS emailId,
              action,
              resolve_mode AS resolveMode,
              opened_before_resolve AS openedBeforeResolve,
              provider,
              provider_message_id AS providerMessageId,
              provider_thread_id AS providerThreadId,
              source_family AS sourceFamily,
              source_variant AS sourceVariant,
              sender_name AS senderName,
              sender_email AS senderEmail,
              email_subject AS emailSubject,
              email_received_at AS emailReceivedAt,
              section,
              position,
              item_kind AS itemKind,
              read_time_text AS readTimeText,
              title,
              full_description AS fullDescription,
              tracked_url AS trackedUrl,
              canonical_url AS canonicalUrl,
              final_url AS finalUrl,
              metadata_json AS metadataJson,
              created_at AS createdAt
            FROM item_interactions
            WHERE (? IS NULL OR created_at >= ?)
            ORDER BY created_at ASC, id ASC
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
