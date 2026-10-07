import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import contract from "../contracts/operations.json";

test("CLI executes every active REST operation, persists login, and records agent actions", async ({
  request,
  baseURL,
}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mail-cli-e2e-"));
  const seen = new Set<string>();
  let key = "";
  const run = (command: string, args: string[] = [], input?: string) => {
    if (contract.operations.some((op) => op.command === command))
      seen.add(command);
    return JSON.parse(
      execFileSync(
        process.execPath,
        ["cli/mail-digester.mjs", ...command.split(" "), ...args],
        {
          encoding: "utf8",
          input,
          env: {
            ...process.env,
            MAIL_DIGESTER_API_KEY: key,
            MAIL_DIGESTER_URL: baseURL,
            MAIL_DIGESTER_USER_HOME: home,
          },
        },
      ),
    );
  };
  try {
    expect(run("health").status).toBe("ok");
    const bootstrap = await request.post("/api/admin/keys", {
      data: { name: "Synthetic CLI admin", scopes: contract.scopes },
    });
    expect(bootstrap.status()).toBe(201);
    key = (await bootstrap.json()).key;
    const loggedIn = run("auth login");
    expect(loggedIn.loggedIn).toBe(true);
    expect(JSON.stringify(loggedIn)).not.toContain(key);
    const file = path.join(home, ".lilfeel/mail-digester/config.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    key = "";
    expect(run("auth status").apiKey.name).toBe("Synthetic CLI admin");
    const payload = {
      source: { id: "research", label: "Research Notes" },
      message: {
        id: "synthetic-cli-issue",
        subject: "CLI integration fixture",
        receivedAt: "2026-10-06T08:00:00Z",
      },
      items: [
        {
          id: "cli-story",
          title: "CLI integration story",
          kind: "sponsor",
          url: "https://example.com/cli",
          collections: [
            {
              categoryId: "ai",
              categoryLabel: "AI",
              tabId: "research",
              tabLabel: "News & Research",
            },
          ],
        },
      ],
    };
    const imported = run("ingest", ["--file", "-"], JSON.stringify(payload));
    expect(imported.createdItems).toBe(1);
    expect(
      run("ingest", [
        "--source",
        JSON.stringify(payload.source),
        "--message",
        JSON.stringify(payload.message),
        "--items",
        JSON.stringify(payload.items),
      ]).createdItems,
    ).toBe(0);
    const id = String(imported.items[0].internalId);
    expect(
      run("inbox").emails.some(
        (email: { subject: string }) =>
          email.subject === payload.message.subject,
      ),
    ).toBe(true);
    for (const command of [
      "item open",
      "item description-expand",
      "item link-open",
      "item resolve",
      "item unresolve",
    ])
      run(command, ["--id", id]);
    run("item preference", ["--id", id, "--signal", "interested"]);
    const events = run("engagement", ["--limit", "500"]).events.filter(
      (event: { item_id: number }) => event.item_id === Number(id),
    );
    expect(events).toHaveLength(6);
    expect(
      events.every((event: { actor: string }) => event.actor === "agent"),
    ).toBe(true);
    const created = run("keys create", ["--name", "Synthetic child"]);
    expect(created.apiKey.scopes).toEqual(contract.defaultScopes);
    key = created.key;
    expect(run("auth status").apiKey.id).toBe(created.apiKey.id);
    key = "";
    expect(
      run("keys list").keys.some(
        (k: { id: number; lastUsedAt: number | null }) => k.lastUsedAt !== null,
      ),
    ).toBe(true);
    const rotated = run("keys rotate", ["--id", String(created.apiKey.id)]);
    expect(rotated.apiKey.rotatedFrom).toBe(created.apiKey.id);
    run("keys revoke", ["--id", String(rotated.apiKey.id)]);
    const revoked = await request.get("/api/v1/auth", {
      headers: { authorization: "Bearer " + rotated.key },
    });
    expect(revoked.status()).toBe(401);
    expect([...seen].sort()).toEqual(
      contract.operations.map((op) => op.command).sort(),
    );
    expect(run("auth logout")).toEqual({
      loggedOut: true,
      remoteKeyRevoked: false,
    });
    expect(fs.existsSync(file)).toBe(false);
    key = (
      await (
        await request.post("/api/admin/keys", {
          data: { name: "Synthetic stdin login" },
        })
      ).json()
    ).key;
    const stdinKey = key;
    key = "";
    expect(run("auth login", ["--key-stdin"], stdinKey + "\n").loggedIn).toBe(
      true,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Admin creates, shows once, tracks usage, rotates and revokes keys on desktop/mobile", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Admin settings/ }).click();
  await expect(
    page.getByRole("heading", { name: "API keys", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "admin", exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("Key name").fill("Synthetic reading agent");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const secret = page.getByLabel("API key secret");
  await expect(secret).toHaveValue(/^mdk_/);
  const oldKey = await secret.inputValue();
  const active = page.getByRole("region", {
    name: "Key Synthetic reading agent",
  });
  await expect(active).toContainText("Never");
  const used = await request.get("/api/v1/auth", {
    headers: { authorization: "Bearer " + oldKey },
  });
  expect(used.status()).toBe(200);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(secret).toHaveCount(0);
  await expect(active).not.toContainText("Never");
  await page.screenshot({ path: "qa/admin-desktop.png", fullPage: true });
  await active.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(secret).toHaveValue(/^mdk_/);
  const newKey = await secret.inputValue();
  expect(newKey).not.toBe(oldKey);
  expect(
    (
      await request.get("/api/v1/auth", {
        headers: { authorization: "Bearer " + oldKey },
      })
    ).status(),
  ).toBe(401);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const replacement = active.filter({
    has: page.getByRole("button", { name: "Revoke", exact: true }),
  });
  await replacement
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(
    active.getByRole("button", { name: "Revoke", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await request.get("/api/v1/auth", {
        headers: { authorization: "Bearer " + newKey },
      })
    ).status(),
  ).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "qa/admin-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await request.post("/api/admin/keys", {
        headers: { origin: "https://attacker.example" },
        data: { name: "CSRF" },
      })
    ).status(),
  ).toBe(403);
});
