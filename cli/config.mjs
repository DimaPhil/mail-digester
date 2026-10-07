import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_URL = "https://lilfeel-ai-mf.tail52362f.ts.net:8443";
export function userHome() {
  return process.env.MAIL_DIGESTER_USER_HOME || os.homedir();
}
export function configPath() {
  return path.join(userHome(), ".lilfeel", "mail-digester", "config.json");
}
export function serverUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      "Use an origin URL without credentials, path, query, or fragment.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS; HTTP is allowed only for local development.");
  return url.origin;
}
export function readConfig() {
  const file = configPath();
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("CLI configuration must be a regular file.");
    if ((stat.mode & 0o077) !== 0)
      throw new Error(
        "CLI configuration contains credentials; chmod 600 " + file,
      );
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      value.version !== 1 ||
      typeof value.key !== "string" ||
      typeof value.url !== "string"
    )
      throw new Error(
        "Invalid CLI configuration; run mail-digester auth login again.",
      );
    value.url = serverUrl(value.url);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError)
      throw new Error(
        "Invalid CLI configuration; run mail-digester auth login again.",
      );
    throw error;
  }
}
export function saveConfig(value) {
  const file = configPath(),
    dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, ".config-" + randomUUID());
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, ...value }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function logout() {
  try {
    fs.unlinkSync(configPath());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
