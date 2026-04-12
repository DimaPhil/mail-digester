export const dynamic = "force-dynamic";

import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { DB_PATH, GWS_BINARY } from "@/lib/config";
import { getSyncState } from "@/lib/db/repository";

const execFileAsync = promisify(execFile);

async function checkGwsReadiness() {
  if (process.env.MAIL_DIGESTER_USE_FIXTURE_DATA === "1") {
    return {
      required: false,
      binaryAvailable: true,
      configAvailable: true,
      version: "fixture-mode",
    };
  }

  let binaryAvailable = false;
  let version: string | null = null;
  try {
    const { stdout, stderr } = await execFileAsync(GWS_BINARY, ["--version"], {
      env: process.env,
      timeout: 5_000,
    });
    binaryAvailable = true;
    version = `${stdout}${stderr}`.trim() || "unknown";
  } catch {
    binaryAvailable = false;
  }

  const credentialsFile = process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE;
  const configPath = credentialsFile
    ? credentialsFile
    : path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
        "gws",
      );

  let configAvailable = false;
  try {
    await fs.access(configPath);
    configAvailable = true;
  } catch {
    configAvailable = false;
  }

  return {
    required: true,
    binaryAvailable,
    configAvailable,
    version,
    configPath,
  };
}

export async function GET() {
  const dbDirectory = path.dirname(DB_PATH);
  let dbWritable = false;

  try {
    await fs.mkdir(dbDirectory, { recursive: true });
    await fs.access(dbDirectory, fsConstants.R_OK | fsConstants.W_OK);
    dbWritable = true;
  } catch {
    dbWritable = false;
  }

  let syncStateAvailable = false;
  try {
    await getSyncState();
    syncStateAvailable = true;
  } catch {
    syncStateAvailable = false;
  }

  const gws = await checkGwsReadiness();
  const healthy =
    dbWritable &&
    syncStateAvailable &&
    (!gws.required || (gws.binaryAvailable && gws.configAvailable));

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      app: "mail-digester",
      port: Number(process.env.PORT ?? "4001"),
      checks: {
        database: {
          writableDirectory: dbWritable,
          path: DB_PATH,
          syncStateAvailable,
        },
        gws,
      },
    },
    {
      status: healthy ? 200 : 503,
    },
  );
}
