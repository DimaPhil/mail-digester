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

test("supports sorting emails newest-first while keeping oldest-first as the default", async ({
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

  const defaultOlderBox = await olderEmail.boundingBox();
  const defaultNewerBox = await newerEmail.boundingBox();

  expect(defaultOlderBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    defaultNewerBox?.y ?? Number.POSITIVE_INFINITY,
  );

  await page.getByRole("button", { name: /Newest first/i }).click();

  const sortedOlderBox = await olderEmail.boundingBox();
  const sortedNewerBox = await newerEmail.boundingBox();

  expect(sortedNewerBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    sortedOlderBox?.y ?? Number.POSITIVE_INFINITY,
  );
});

test("supports a flat link view without requiring email selection", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Flat links/i }).click();

  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(/One continuous queue of unresolved links/i),
  ).toBeVisible();
});

test("saves an interest prompt and filters flat links by classification", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .getByPlaceholder(/Describe what kinds of links are interesting to you/i)
    .fill("openai");
  await page.getByRole("button", { name: /Save prompt/i }).click();
  await expect(page.getByText(/Interest prompt saved/i)).toBeVisible();
  await expect(page.getByText(/need recheck/i)).toBeVisible();

  await page.getByLabel(/Force full resync/i).click();
  await page
    .getByRole("button", { name: /Resync and recheck unresolved links/i })
    .click();
  await expect(
    page.getByRole("button", {
      name: /Resync and recheck unresolved links/i,
    }),
  ).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /Flat links/i }).click();
  await page
    .getByRole("button", { name: /^Interesting$/i })
    .first()
    .click();

  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Amazon escalates the infrastructure race \(5 minute read\)/i,
    }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /^Not interesting$/i })
    .first()
    .click();
  await expect(
    page.getByRole("link", {
      name: /Amazon escalates the infrastructure race \(5 minute read\)/i,
    }),
  ).toBeVisible();
});

test("builds a separate AI feature list and can include resolved links", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .getByPlaceholder(
      /Describe which AI product capabilities should make it into the separate watchlist/i,
    )
    .fill("openai claude anthropic roadmap panels");
  await page.getByRole("button", { name: /Save AI list prompt/i }).click();
  await expect(page.getByText(/AI feature prompt saved/i)).toBeVisible();

  await page.getByRole("button", { name: /Build AI feature list/i }).click();
  await expect(
    page.getByRole("button", { name: /AI list/i }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Claude adds role-aware control panels \(4 minute read\)/i,
    }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Email view/i })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: /OpenAI roadmap .* Claude control panels .* new eval tooling/i,
    })
    .click();
  await page
    .getByRole("checkbox", {
      name: /Resolve OpenAI sharpens its enterprise roadmap/i,
    })
    .click();

  await page
    .getByRole("button", { name: /AI list/i })
    .first()
    .click();
  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toHaveCount(0);

  await page
    .getByLabel(/Include resolved links/i)
    .last()
    .click();
  await page.getByRole("button", { name: /Build AI feature list/i }).click();
  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /Undo/i }).click();
  await expect(
    page.getByRole("link", {
      name: /OpenAI sharpens its enterprise roadmap \(3 minute read\)/i,
    }),
  ).toBeVisible();
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

test("keeps a resolved item hidden during a stale inbox refresh", async ({
  page,
}) => {
  await page.goto("/");

  const initialInbox = await page.evaluate(async () => {
    const response = await fetch("/api/inbox");
    return response.json();
  });

  let staleInboxServed = false;
  await page.route("**/api/inbox", async (route) => {
    if (staleInboxServed) {
      await route.continue();
      return;
    }

    staleInboxServed = true;
    await route.fulfill({
      body: JSON.stringify(initialInbox),
      contentType: "application/json",
      status: 200,
    });
  });

  await page
    .getByRole("button", {
      name: /Compute race .* NASA systems .* programming hunches/i,
    })
    .click();

  await page
    .getByRole("checkbox", {
      name: /Resolve Amazon escalates the infrastructure race/i,
    })
    .click();

  await expect(
    page.getByText(/Resolved “Amazon escalates the infrastructure race/i),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Amazon escalates the infrastructure race \(5 minute read\)/i,
    }),
  ).toHaveCount(0);

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

test("returns mobile users to the email list after fully resolving an email", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const emailButton = page.getByRole("button", {
    name: /OpenAI roadmap .* Claude control panels .* new eval tooling/i,
  });
  await expect(emailButton).toBeVisible({ timeout: 20_000 });
  await emailButton.click();

  await page
    .getByRole("checkbox", {
      name: /Resolve OpenAI sharpens its enterprise roadmap/i,
    })
    .click();
  await expect(
    page.getByRole("button", { name: /Dismiss notification/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Dismiss notification/i }).click();
  await expect(
    page.getByRole("button", { name: /Dismiss notification/i }),
  ).toHaveCount(0);

  for (const label of [
    /Resolve Claude adds role-aware control panels/i,
    /Resolve A practical guide to evaluation loops/i,
  ]) {
    await page.getByRole("checkbox", { name: label }).click();
  }

  await expect(
    page.getByRole("button", { name: /Back to emails/i }),
  ).toHaveCount(0);
  await expect(emailButton).toBeVisible();
});
