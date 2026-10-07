import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userHome } from "./config.mjs";

const marker = "mail-digester npm managed skill\n";
function stat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function installSkill(home = userHome()) {
  const canonical = path.join(home, ".agents", "skills", "mail-digester");
  const adapter = path.join(home, ".claude", "skills", "mail-digester");
  const owned = path.join(canonical, ".mail-digester-managed");
  const current = stat(canonical);
  if (
    current &&
    (!current.isDirectory() ||
      current.isSymbolicLink() ||
      !fs.existsSync(owned) ||
      fs.readFileSync(owned, "utf8") !== marker)
  )
    throw new Error(
      "Existing unmanaged skill preserved: " +
        canonical +
        ". Rename it before running mail-digester skill install.",
    );
  const link = stat(adapter);
  if (
    link &&
    (!link.isSymbolicLink() ||
      path.resolve(path.dirname(adapter), fs.readlinkSync(adapter)) !==
        canonical)
  )
    throw new Error(
      "Existing Claude skill preserved: " +
        adapter +
        ". Resolve it before running mail-digester skill install.",
    );
  const source = fileURLToPath(
    new URL("../skills/mail-digester/SKILL.md", import.meta.url),
  );
  fs.mkdirSync(canonical, { recursive: true });
  fs.writeFileSync(path.join(canonical, "SKILL.md"), fs.readFileSync(source));
  fs.writeFileSync(owned, marker);
  fs.mkdirSync(path.dirname(adapter), { recursive: true });
  if (!link)
    fs.symlinkSync(
      path.relative(path.dirname(adapter), canonical),
      adapter,
      "dir",
    );
  return { canonical, adapter };
}
if (
  process.env.npm_lifecycle_event === "postinstall" &&
  process.env.npm_config_global === "true"
) {
  try {
    console.log(
      "Installed Mail Digester agent skill:",
      installSkill().canonical,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
