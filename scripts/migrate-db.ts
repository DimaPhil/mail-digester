import path from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase } from "../lib/db/index";
async function main() {
  // Native dynamic import retains the maintenance helper's ESM CLI guard.
  const { verifyPreserved } = await import("./db-maintenance.mjs");
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (
    !baselinePath ||
    !candidatePath ||
    path.resolve(baselinePath) === path.resolve(candidatePath)
  )
    throw new Error(
      "Usage: node --import tsx scripts/migrate-db.ts VERIFIED_BACKUP COPY_TO_MIGRATE",
    );
  const baseline = new Database(baselinePath, {
    readonly: true,
    fileMustExist: true,
  });
  const candidate = new Database(candidatePath, { fileMustExist: true });
  try {
    verifyPreserved(baseline, candidate);
    migrateDatabase(candidate);
    console.log(JSON.stringify(verifyPreserved(baseline, candidate)));
  } finally {
    baseline.close();
    candidate.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
