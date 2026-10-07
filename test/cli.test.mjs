import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import { installSkill } from "../cli/skill.mjs";
import { serverUrl } from "../cli/config.mjs";

const exec = promisify(execFile);
describe("CLI safety and skill installation", () => {
  it("rejects added, removed, misregistered, and indirect REST handlers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-contract-"));
    try {
      fs.cpSync("app/api", path.join(dir, "app/api"), { recursive: true });
      fs.mkdirSync(path.join(dir, "contracts"));
      fs.copyFileSync(
        "contracts/operations.json",
        path.join(dir, "contracts/operations.json"),
      );
      const checker = path.resolve("scripts/check-api-cli.mjs");
      const run = () => exec(process.execPath, [checker], { cwd: dir });
      expect((await run()).stdout).toContain("15 active operations");
      const newRoute = path.join(dir, "app/api/forgotten/route.js");
      fs.mkdirSync(path.dirname(newRoute));
      fs.writeFileSync(
        newRoute,
        "export function DELETE() { return Response.json({}); }",
      );
      await expect(run()).rejects.toMatchObject({
        stderr: expect.stringContaining("REST/CLI drift"),
      });
      fs.unlinkSync(newRoute);
      const inbox = path.join(dir, "app/api/inbox/route.ts");
      const original = fs.readFileSync(inbox, "utf8");
      fs.writeFileSync(
        inbox,
        original.replace('apiOperation("inbox"', 'apiOperation("health"'),
      );
      await expect(run()).rejects.toMatchObject({
        stderr: expect.stringContaining("REST/CLI drift"),
      });
      fs.writeFileSync(inbox, 'export { GET } from "other";');
      await expect(run()).rejects.toMatchObject({
        stderr: expect.stringContaining("Export API handlers directly"),
      });
      fs.unlinkSync(inbox);
      await expect(run()).rejects.toMatchObject({
        stderr: expect.stringContaining("no REST route"),
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("updates only its managed skill and preserves conflicting files", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mail-skill-"));
    try {
      const installed = installSkill(home);
      expect(fs.readlinkSync(installed.adapter)).toBe(
        "../../.agents/skills/mail-digester",
      );
      const skill = path.join(installed.canonical, "SKILL.md");
      const original = fs.readFileSync(skill, "utf8");
      fs.writeFileSync(skill, "managed older version");
      installSkill(home);
      expect(fs.readFileSync(skill, "utf8")).toBe(original);
      fs.unlinkSync(installed.adapter);
      fs.mkdirSync(installed.adapter);
      expect(() => installSkill(home)).toThrow(/Claude skill preserved/);
      fs.rmSync(installed.adapter, { recursive: true });
      fs.unlinkSync(path.join(installed.canonical, ".mail-digester-managed"));
      fs.writeFileSync(skill, "unmanaged user skill");
      expect(() => installSkill(home)).toThrow(/unmanaged skill preserved/);
      expect(fs.readFileSync(skill, "utf8")).toBe("unmanaged user skill");
      expect(fs.existsSync(installed.adapter)).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
  it("limits origins and fails before a write when contracts drift or credentials are unsafe", async () => {
    expect(serverUrl("https://example.com/")).toBe("https://example.com");
    expect(serverUrl("http://127.0.0.1:4001")).toBe("http://127.0.0.1:4001");
    for (const value of [
      "http://remote.example",
      "https://user:pass@example.com",
      "https://example.com/path",
      "https://example.com/?key=secret",
      "https://example.com/#hash",
    ])
      expect(() => serverUrl(value)).toThrow();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mail-cli-"));
    const requests = [];
    const server = http.createServer((request, response) => {
      requests.push(request.url);
      response.setHeader("content-type", "application/json");
      response.setHeader("x-mail-digester-contract", "old-version");
      response.end('{"ok":true}');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const env = {
      ...process.env,
      MAIL_DIGESTER_USER_HOME: home,
      MAIL_DIGESTER_API_KEY: "synthetic-test-key-long",
      MAIL_DIGESTER_URL: "http://127.0.0.1:" + server.address().port,
    };
    const run = (...args) =>
      exec(process.execPath, ["cli/mail-digester.mjs", ...args], { env });
    try {
      await expect(run("item", "resolve", "--id", "1")).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("contracts differ"),
      });
      expect(requests).toEqual(["/api/health"]);
      await expect(run("item", "resolve", "--id", "NaN")).rejects.toMatchObject(
        { stderr: expect.stringContaining("positive integer") },
      );
      await expect(run("engagement", "--limit", "501")).rejects.toMatchObject({
        stderr: expect.stringContaining("Invalid --limit"),
      });
      await expect(run("inbox", "--signal", "clear")).rejects.toMatchObject({
        stderr: expect.stringContaining("does not apply"),
      });
      await expect(
        run("ingest", "--file", "-", "--source", "x"),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("not both") });
      await expect(run("ingest")).rejects.toMatchObject({
        stderr: expect.stringContaining("Missing --source"),
      });
      await expect(run("unknown")).rejects.toMatchObject({
        stderr: expect.stringContaining("Unknown command"),
      });
      env.MAIL_DIGESTER_API_KEY = "";
      await expect(run("inbox")).rejects.toMatchObject({
        stderr: expect.stringContaining("auth login"),
      });
      const file = path.join(home, ".lilfeel/mail-digester/config.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          key: "synthetic-test-key-long",
          url: "https://other.example",
        }),
        { mode: 0o600 },
      );
      await expect(run("inbox")).rejects.toMatchObject({
        stderr: expect.stringContaining("bound to their server URL"),
      });
      fs.chmodSync(file, 0o644);
      await expect(run("inbox")).rejects.toMatchObject({
        stderr: expect.stringContaining("chmod 600"),
      });
      fs.chmodSync(file, 0o600);
      fs.writeFileSync(file, "{}");
      await expect(run("inbox")).rejects.toMatchObject({
        stderr: expect.stringContaining("Invalid CLI configuration"),
      });
      fs.unlinkSync(file);
      fs.symlinkSync(path.join(home, "target"), file);
      await expect(run("inbox")).rejects.toMatchObject({
        stderr: expect.stringContaining("regular file"),
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
