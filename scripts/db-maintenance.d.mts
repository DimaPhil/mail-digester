import type Database from "better-sqlite3";
export function fingerprint(
  db: Database.Database,
  baseline?: Array<{ name: string; columns: string[] }>,
): Array<{ name: string; columns: string[]; count: number; digest: string }>;
export function verifyPreserved(
  baseline: Database.Database,
  candidate: Database.Database,
): Array<{ table: string; preservedRows: number }>;
export function backupDatabase(
  source: string,
  destination: string,
): Promise<Array<{ table: string; preservedRows: number }>>;
