import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-reader-e2e-"));
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.PLAYWRIGHT_PORT ?? "4101",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MAIL_DIGESTER_DB_PATH: path.join(dir, "synthetic.sqlite"),
      MAIL_DIGESTER_READER_USERNAME: "synthetic",
      MAIL_DIGESTER_READER_PASSWORD: "synthetic-reader-test-only",
      MAIL_DIGESTER_INGEST_TOKEN: "synthetic-ingest-test-only",
      MAIL_DIGESTER_FEEDBACK_TOKEN: "synthetic-feedback-test-only",
      MAIL_DIGESTER_ALLOWED_SOURCES: "tldr,tldr-ai,research,systems,markets",
    },
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
