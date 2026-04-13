import {
  defaultDbPath,
  loadInteractions,
  parseFlags,
  readNumberFlag,
  readStringFlag,
  writeOutput,
} from "./common.mjs";

function csvEscape(value) {
  if (value == null) {
    return "";
  }

  const text = String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(","),
    ),
  ].join("\n");
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = readStringFlag(flags, "db", defaultDbPath());
  const format = readStringFlag(flags, "format", "jsonl");
  const outputPath = readStringFlag(flags, "out", "");
  const sinceDays = readNumberFlag(flags, "since-days", 0);
  const loaded = loadInteractions({
    dbPath,
    sinceDays: sinceDays > 0 ? sinceDays : undefined,
  });

  if (loaded.warning) {
    process.stderr.write(`${loaded.warning}\n`);
  }

  const rows = loaded.interactions.map((row) => ({
    ...row,
    openedBeforeResolve:
      row.openedBeforeResolve == null ? null : Boolean(row.openedBeforeResolve),
  }));
  const content =
    format === "csv"
      ? toCsv(rows)
      : rows.map((row) => JSON.stringify(row)).join("\n");

  writeOutput({
    content,
    outputPath: outputPath || null,
  });
}

main();
