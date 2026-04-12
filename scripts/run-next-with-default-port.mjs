import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const DEFAULT_PORT = "4001";
const mode = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!mode || !["dev", "start"].includes(mode)) {
  console.error(
    "Usage: node ./scripts/run-next-with-default-port.mjs <dev|start>",
  );
  process.exit(1);
}

function readArgValue(name) {
  const index = extraArgs.indexOf(name);
  return index >= 0 ? extraArgs[index + 1] : undefined;
}

const port = readArgValue("--port") || process.env.PORT || DEFAULT_PORT;
const hostname = readArgValue("--hostname") || process.env.HOSTNAME;
const standaloneServer = ".next/standalone/server.js";
const command =
  mode === "start" && existsSync(standaloneServer) ? "node" : "next";
const args =
  command === "node"
    ? [standaloneServer]
    : [mode, "--port", port, ...extraArgs];

if (command === "node") {
  mkdirSync(".next/standalone/.next", { recursive: true });

  if (existsSync(".next/static")) {
    rmSync(".next/standalone/.next/static", {
      force: true,
      recursive: true,
    });
    cpSync(".next/static", ".next/standalone/.next/static", {
      recursive: true,
    });
  }

  if (existsSync("public")) {
    rmSync(".next/standalone/public", {
      force: true,
      recursive: true,
    });
    cpSync("public", ".next/standalone/public", {
      recursive: true,
    });
  }
}

const child = spawn(command, args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PORT: port,
    ...(hostname ? { HOSTNAME: hostname } : {}),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
