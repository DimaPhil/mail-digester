#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import {
  readConfig,
  saveConfig,
  logout,
  serverUrl,
  DEFAULT_URL,
} from "./config.mjs";
import { installSkill } from "./skill.mjs";

const contract = JSON.parse(
  fs.readFileSync(
    new URL("../contracts/operations.json", import.meta.url),
    "utf8",
  ),
);
const digest = createHash("sha256")
  .update(JSON.stringify(contract))
  .digest("hex");
const output = (value) =>
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
function help() {
  console.log(
    "Mail Digester — JSON on stdout, errors on stderr\n\nGlobal: --url ORIGIN, --help\nAuth: auth login [--key-stdin], auth logout\nSkill: skill install\n",
  );
  for (const op of contract.operations) {
    const fields = [
      ...Object.keys(op.params?.properties ?? {}),
      ...Object.keys(op.query?.properties ?? {}),
      ...Object.keys(op.body?.properties ?? {}),
    ];
    console.log(
      op.command +
        (fields.length
          ? " " + fields.map((f) => "--" + f + " VALUE").join(" ")
          : "") +
        (op.body ? " [--file JSON_FILE|-]" : "") +
        "\n  " +
        op.summary,
    );
  }
  console.log(
    "\nMAIL_DIGESTER_API_KEY overrides saved credentials. MAIL_DIGESTER_URL overrides the saved URL. Create keys in Admin settings. Use --file for nested JSON; scopes use comma-separated values. Never put keys in command arguments.",
  );
}
async function stdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}
async function promptKey() {
  if (!process.stdin.isTTY)
    throw new Error(
      "Use auth login --key-stdin, or set MAIL_DIGESTER_API_KEY.",
    );
  process.stdout.write("API key: ");
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  try {
    return (
      await rl.question("", { signal: AbortSignal.timeout(120_000) })
    ).trim();
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}
async function call(url, op, key, body, query, params) {
  const target = new URL(
    op.path.replace(/\{(\w+)\}/g, (_match, name) =>
      encodeURIComponent(params[name]),
    ),
    url,
  );
  for (const [name, value] of Object.entries(query))
    target.searchParams.set(name, value);
  const response = await fetch(target, {
    method: op.method,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "x-mail-digester-contract": digest,
      ...(key ? { authorization: "Bearer " + key } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Server returned a non-JSON response (HTTP " + response.status + ").",
    );
  }
  if (!response.ok) {
    const message = JSON.stringify({ status: response.status, ...data });
    throw new Error(key ? message.replaceAll(key, "[redacted]") : message);
  }
  if (response.headers.get("x-mail-digester-contract") !== digest)
    throw new Error(
      "Server/CLI API contracts differ. Update the server or reinstall the CLI from the matching revision before retrying.",
    );
  return data;
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args[0] === "help") {
    help();
    return;
  }
  const definitions = {
    url: { type: "string" },
    file: { type: "string" },
    "key-stdin": { type: "boolean" },
  };
  for (const op of contract.operations)
    for (const key of [
      ...Object.keys(op.params?.properties ?? {}),
      ...Object.keys(op.query?.properties ?? {}),
      ...Object.keys(op.body?.properties ?? {}),
    ])
      definitions[key] = { type: "string" };
  const { values, positionals } = parseArgs({
    args,
    options: definitions,
    allowPositionals: true,
    strict: true,
  });
  const command = positionals.join(" ");
  if (command === "skill install") {
    output(installSkill());
    return;
  }
  if (command === "auth logout") {
    logout();
    output({ loggedOut: true, remoteKeyRevoked: false });
    return;
  }
  const op = contract.operations.find((o) => o.command === command);
  if (!op && command !== "auth login")
    throw new Error("Unknown command. Run mail-digester --help.");
  const config = readConfig();
  const url = serverUrl(
    values.url ?? process.env.MAIL_DIGESTER_URL ?? config.url ?? DEFAULT_URL,
  );
  const savedKey = config.url === url ? config.key : undefined;
  let key = process.env.MAIL_DIGESTER_API_KEY || savedKey;
  if (command === "auth login") {
    key = values["key-stdin"]
      ? await stdin()
      : process.env.MAIL_DIGESTER_API_KEY || (await promptKey());
    if (!key || key.length < 16 || /\s/.test(key))
      throw new Error("Invalid API key.");
  }
  if (command !== "health" && !key)
    throw new Error(
      "Set MAIL_DIGESTER_API_KEY or run mail-digester auth login. Saved keys are bound to their server URL.",
    );
  const active = op ?? contract.operations.find((o) => o.id === "auth");
  const allowed = new Set([
    "url",
    ...Object.keys(active.params?.properties ?? {}),
    ...Object.keys(active.query?.properties ?? {}),
    ...Object.keys(active.body?.properties ?? {}),
    ...(active.body ? ["file"] : []),
    ...(command === "auth login" ? ["key-stdin"] : []),
  ]);
  for (const option of Object.keys(values))
    if (!allowed.has(option))
      throw new Error("Option --" + option + " does not apply to " + command);
  const params = {},
    query = {};
  for (const name of Object.keys(active.params?.properties ?? {})) {
    if (
      !/^\d+$/.test(values[name] ?? "") ||
      !Number.isSafeInteger(Number(values[name])) ||
      Number(values[name]) < 1
    )
      throw new Error("--" + name + " requires a positive integer.");
    params[name] = values[name];
  }
  for (const [name, schema] of Object.entries(active.query?.properties ?? {})) {
    if (values[name] === undefined) continue;
    const value = Number(values[name]);
    if (
      !/^\d+$/.test(values[name]) ||
      !Number.isSafeInteger(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum)
    )
      throw new Error("Invalid --" + name);
    query[name] = values[name];
  }
  let body;
  if (active.body) {
    const fields = Object.entries(active.body.properties ?? {});
    if (values.file) {
      if (fields.some(([name]) => values[name] !== undefined))
        throw new Error("Use --file or body flags, not both.");
      body = JSON.parse(
        values.file === "-"
          ? await stdin()
          : fs.readFileSync(values.file, "utf8"),
      );
    } else {
      body = {};
      for (const [name, schema] of fields)
        if (values[name] !== undefined) {
          body[name] =
            schema.type === "array" && schema.items?.type === "string"
              ? values[name].split(",").map((v) => v.trim())
              : ["object", "array", "number", "integer", "boolean"].includes(
                    schema.type,
                  )
                ? JSON.parse(values[name])
                : values[name];
        }
      for (const name of active.body.required ?? [])
        if (body[name] === undefined)
          throw new Error(
            "Missing --" + name + "; use --file for structured payloads.",
          );
    }
  }
  // Preflight is read-only: incompatible clients fail before sending a mutation.
  if (active.id !== "health")
    await call(
      url,
      contract.operations.find((o) => o.id === "health"),
      undefined,
      undefined,
      {},
      {},
    );
  const result = await call(
    url,
    active,
    active.id === "health" ? undefined : key,
    body,
    query,
    params,
  );
  if (command === "auth login") {
    saveConfig({ url, key, apiKeyId: result.apiKey.id });
    output({ loggedIn: true, url, apiKey: result.apiKey });
  } else output(result);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
