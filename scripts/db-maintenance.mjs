import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
export function fingerprint(db, baseline) {
  const tables =
    baseline ??
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => ({
        name,
        columns: db
          .prepare(`PRAGMA table_info(${quote(name)})`)
          .all()
          .map((c) => c.name),
      }));
  return tables.map(({ name, columns }) => {
    const rows = db
      .prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(name)}`)
      .safeIntegers(true)
      .all()
      .map((r) =>
        JSON.stringify(r, (_key, value) =>
          typeof value === "bigint"
            ? { sqliteInteger: value.toString() }
            : value,
        ),
      )
      .sort();
    return {
      name,
      columns,
      count: rows.length,
      digest: crypto
        .createHash("sha256")
        .update(JSON.stringify(rows))
        .digest("hex"),
    };
  });
}
export function verifyPreserved(baselineDb, candidateDb) {
  if (candidateDb.pragma("integrity_check", { simple: true }) !== "ok")
    throw new Error("Database integrity check failed");
  const baseline = fingerprint(baselineDb),
    after = fingerprint(candidateDb, baseline);
  if (JSON.stringify(baseline) !== JSON.stringify(after))
    throw new Error("Existing table values or row counts differ");
  return baseline.map((t) => ({ table: t.name, preservedRows: t.count }));
}
export async function backupDatabase(source, destination) {
  if (path.resolve(source) === path.resolve(destination))
    throw new Error("Backup must have a separate path");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(destination, "wx", 0o600);
  fs.closeSync(fd);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Source database integrity check failed");
    await db.backup(destination);
    fs.chmodSync(destination, 0o600);
    const restored = new Database(destination, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      return verifyPreserved(db, restored);
    } finally {
      restored.close();
    }
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname)
) {
  const [command, source, destination] = process.argv.slice(2);
  if (!source || !destination || !["backup", "verify"].includes(command))
    throw new Error(
      "Usage: node scripts/db-maintenance.mjs backup SOURCE DESTINATION | verify BASELINE CANDIDATE",
    );
  if (command === "backup")
    console.log(JSON.stringify(await backupDatabase(source, destination)));
  else {
    const baseline = new Database(source, {
        readonly: true,
        fileMustExist: true,
      }),
      candidate = new Database(destination, {
        readonly: true,
        fileMustExist: true,
      });
    try {
      console.log(JSON.stringify(verifyPreserved(baseline, candidate)));
    } finally {
      baseline.close();
      candidate.close();
    }
  }
}
