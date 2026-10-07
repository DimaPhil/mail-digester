import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-npm-install-"));
const home = path.join(dir, "home");
let prefix = path.join(dir, "prefix");
const env = {
  ...process.env,
  MAIL_DIGESTER_USER_HOME: home,
  npm_config_loglevel: "error",
};
// npm run exports project/prefix settings; a consumer install starts outside that lifecycle.
for (const key of [
  "npm_config_global",
  "npm_config_prefix",
  "npm_config_local_prefix",
  "npm_config_global_prefix",
])
  delete env[key];
const npm = (...args) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    encoding: "utf8",
    env: { ...env, npm_config_prefix: prefix },
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
    "--install-links",
    "--no-audit",
    "--no-fund",
    "--foreground-scripts",
    path.join(dir, packed.filename),
  );
  // Exercise npm's Git preparation path as well as its tarball lifecycle.
  const repo = path.join(dir, "git-source");
  fs.mkdirSync(repo);
  for (const { path: file } of packed.files) {
    const destination = path.join(repo, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
  }
  fs.copyFileSync("package-lock.json", path.join(repo, "package-lock.json"));
  const git = (...args) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args],
      { encoding: "utf8" },
    );
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Install test",
    "-c",
    "user.email=install@example.invalid",
    "commit",
    "-qm",
    "Synthetic package snapshot",
  );
  fs.writeFileSync(
    path.join(home, ".agents/skills/mail-digester/SKILL.md"),
    "older managed skill before Git update",
  );
  prefix = path.join(dir, "git-prefix");
  npm(
    "install",
    "--global",
    "--install-links",
    "--no-audit",
    "--no-fund",
    "--foreground-scripts",
    "git+file://" + repo,
  );
  const config = path.join(home, ".lilfeel/mail-digester/config.json");
  fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 });
  const saved =
    '{"version":1,"key":"synthetic-install-key","url":"https://example.com"}\n';
  fs.writeFileSync(config, saved, { mode: 0o600 });
  fs.writeFileSync(
    path.join(home, ".agents/skills/mail-digester/SKILL.md"),
    "older managed skill before update",
  );
  fs.appendFileSync(
    path.join(repo, "README.md"),
    "\nSynthetic install update fixture.\n",
  );
  git("add", ".");
  git(
    "-c",
    "user.name=Install test",
    "-c",
    "user.email=install@example.invalid",
    "commit",
    "-qm",
    "Synthetic update",
  );
  npm(
    "install",
    "--global",
    "--install-links",
    "--no-audit",
    "--no-fund",
    "--foreground-scripts",
    "git+file://" + repo,
  );
  assert.equal(fs.readFileSync(config, "utf8"), saved);
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
    "Global npm tarball and Git installation: bin, packaged contract, automatic skill, relative Claude symlink, managed update verified in isolated home.",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
