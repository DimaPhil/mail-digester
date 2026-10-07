import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-npm-install-"));
const home = path.join(dir, "home"),
  prefix = path.join(dir, "prefix");
const env = { ...process.env, MAIL_DIGESTER_USER_HOME: home };
const npm = (...args) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    encoding: "utf8",
    env,
  });
try {
  const [packed] = JSON.parse(
    npm("pack", "--json", "--ignore-scripts", "--pack-destination", dir),
  );
  assert(
    packed.files.some((file) => file.path === "skills/mail-digester/SKILL.md"),
  );
  assert(
    packed.files.some((file) => file.path === "contracts/operations.json"),
  );
  assert(!packed.files.some((file) => file.path.startsWith("data/")));
  npm(
    "install",
    "--global",
    "--prefix",
    prefix,
    "--no-audit",
    "--no-fund",
    "--foreground-scripts",
    path.join(dir, packed.filename),
  );
  const bin = path.join(prefix, "bin", "mail-digester");
  assert(
    execFileSync(bin, ["--help"], { encoding: "utf8", env }).includes(
      "keys rotate",
    ),
  );
  const canonical = path.join(home, ".agents/skills/mail-digester");
  const adapter = path.join(home, ".claude/skills/mail-digester");
  assert.equal(
    fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8"),
    fs.readFileSync("skills/mail-digester/SKILL.md", "utf8"),
  );
  assert.equal(fs.readlinkSync(adapter), "../../.agents/skills/mail-digester");
  fs.writeFileSync(path.join(canonical, "SKILL.md"), "older managed skill");
  execFileSync(bin, ["skill", "install"], { encoding: "utf8", env });
  assert(
    fs
      .readFileSync(path.join(canonical, "SKILL.md"), "utf8")
      .startsWith("---\nname: mail-digester"),
  );
  console.log(
    "Global npm installation: bin, packaged contract, automatic skill, relative Claude symlink, managed update verified in isolated home.",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
