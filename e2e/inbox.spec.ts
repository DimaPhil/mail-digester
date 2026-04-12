import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("shows emails on the left and opens the selected email detail", async ({
  page,
}) => {
  await page.goto("/");
  const olderEmail = page.getByRole("button", {
    name: /Compute race .* NASA systems .* programming hunches/i,
  });
  const newerEmail = page.getByRole("button", {
    name: /OpenAI roadmap .* Claude control panels .* new eval tooling/i,
  });

  await expect(olderEmail).toBeVisible({ timeout: 20_000 });
  await expect(newerEmail).toBeVisible({ timeout: 20_000 });

  const olderBox = await olderEmail.boundingBox();
  const newerBox = await newerEmail.boundingBox();

  expect(olderBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    newerBox?.y ?? Number.POSITIVE_INFINITY,
  );

  await expect(olderEmail).toBeVisible({ timeout: 20_000 });

  await newerEmail.click();

  await expect(
    page.locator("header").getByRole("heading", {
      name: /OpenAI roadmap .* Claude control panels .* new eval tooling/i,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Show full description/i }),
  ).toBeVisible();
  await expect(page.getByText(/broader launch/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Show full description/i }).click();
  await expect(page.getByText(/broader launch/i)).toBeVisible();
  await expect(page.getByText(/Open link/i).first()).toBeVisible();
});

test("opens email detail as a mobile master-detail view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const emailButton = page.getByRole("button", {
    name: /OpenAI roadmap .* Claude control panels .* new eval tooling/i,
  });

  await expect(emailButton).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: /Back to emails/i }),
  ).toHaveCount(0);

  await emailButton.click();

  await expect(
    page.getByRole("button", { name: /Back to emails/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Show full description/i }).click();
  await expect(page.getByText(/broader launch/i)).toBeVisible();
  await expect(emailButton).toHaveCount(0);

  await page.getByRole("button", { name: /Back to emails/i }).click();

  await expect(emailButton).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Back to emails/i }),
  ).toHaveCount(0);
});

test("resolves an item and supports undo", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("button", {
      name: /Compute race .* NASA systems .* programming hunches/i,
    }),
  ).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole("button", {
      name: /Compute race .* NASA systems .* programming hunches/i,
    })
    .click();

  const detailPanel = page.locator("section").filter({
    has: page.getByText(/TOP STORIES/i),
  });

  await expect(
    page.getByRole("link", {
      name: /Amazon escalates the infrastructure race \(5 minute read\)/i,
    }),
  ).toBeVisible();

  const resolveControl = detailPanel.getByRole("checkbox", {
    name: /Resolve Amazon escalates the infrastructure race/i,
  });

  await resolveControl.click();
  await expect(
    page.getByText(/Resolved “Amazon escalates the infrastructure race/i),
  ).toBeVisible();

  await page.getByRole("button", { name: /Undo/i }).click();
  await expect(
    page.getByRole("link", {
      name: /Amazon escalates the infrastructure race \(5 minute read\)/i,
    }),
  ).toBeVisible();
});

test("moves a fully resolved email into the completed section", async ({
  page,
}) => {
  await page.goto("/");

  const emailButton = page.getByRole("button", {
    name: /Compute race .* NASA systems .* programming hunches/i,
  });
  await expect(emailButton).toBeVisible({ timeout: 20_000 });
  await emailButton.click();

  for (const label of [
    /Resolve Amazon escalates the infrastructure race/i,
    /Resolve The full-stack developer platform to build real-time AI humans/i,
    /Resolve What are your programming "hunches" you haven't yet investigated/i,
  ]) {
    await page.getByRole("checkbox", { name: label }).click();
    await expect(page.getByRole("button", { name: /Undo/i })).toBeVisible();
  }

  const leftPanel = page.locator("section").filter({
    has: page.getByText(/^Emails$/),
  });
  const activeQueue = leftPanel.locator("section").filter({
    has: page.getByText(/Active queue/i),
  });
  const completedQueue = leftPanel.locator("section").filter({
    has: page.getByText(/Completed emails/i),
  });

  await expect(
    activeQueue.getByRole("button", { name: /Compute race/i }),
  ).toHaveCount(0);
  await expect(
    completedQueue.getByRole("button", {
      name: /Compute race .* NASA systems .* programming hunches/i,
    }),
  ).toBeVisible();
});
