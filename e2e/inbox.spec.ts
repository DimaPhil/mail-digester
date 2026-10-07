import { test, expect } from "@playwright/test";
const ingestHeaders = { authorization: "Bearer synthetic-ingest-test-only" };
const collection = (
  categoryId: string,
  categoryLabel: string,
  tabId: string,
  tabLabel: string,
) => [{ categoryId, categoryLabel, tabId, tabLabel }];
const fixtures = [
  {
    source: { id: "tldr", label: "TLDR" },
    message: {
      id: "synthetic-tldr",
      subject: "Today's perspective",
      receivedAt: "2026-10-03T08:00:00Z",
    },
    items: [
      {
        id: "story-1",
        title: "The next chapter of intelligent software",
        description:
          "A new generation of tools is changing how teams build, test, and ship. This thoughtful overview looks beyond the headlines to the practices that make these systems useful in everyday work.",
        url: "https://example.com/software",
        section: "Ideas & perspectives",
        readTime: "4 min read",
        collections: collection("ai", "AI", "tldr", "TLDR"),
      },
      {
        id: "synthetic-sponsor",
        title: "Synthetic sponsored resource",
        description: "A synthetic sponsor preserved for testing.",
        url: "https://example.com/sponsor",
        kind: "sponsor",
        collections: collection("ai", "AI", "tldr", "TLDR"),
      },
      {
        id: "story-2",
        title: "Designing a calmer relationship with technology",
        description:
          "Small changes to our digital spaces can make room for deeper thought. A practical guide to choosing the signals that matter, and giving everything else a little less attention.",
        url: "https://example.com/design",
        section: "Deep dives",
        readTime: "6 min read",
        collections: collection("ai", "AI", "tldr", "TLDR"),
      },
    ],
  },
  {
    source: { id: "tldr-ai", label: "TLDR AI" },
    message: {
      id: "synthetic-ai",
      subject: "Models and methods",
      receivedAt: "2026-10-02T08:00:00Z",
    },
    items: [
      {
        id: "story-3",
        title: "What reliable AI looks like in practice",
        description:
          "The interesting work begins after the demo. Researchers share a measured approach to evaluations, feedback loops, and the details that help useful tools earn our trust.",
        url: "https://example.com/ai",
        section: "Research & applications",
        readTime: "5 min read",
        collections: collection("ai", "AI", "tldr", "TLDR"),
      },
    ],
  },
  {
    source: { id: "research", label: "Research Notes" },
    message: {
      id: "synthetic-research",
      subject: "New research",
      receivedAt: "2026-10-01T08:00:00Z",
    },
    items: [
      {
        id: "paper",
        title: "A field guide to learning systems",
        description:
          "How learning systems improve over time: a practical look at evaluation, iteration, and the research behind reliable feedback.\n\nPlain text <script>window.compromised=true</script> stays plain text.",
        section: "Papers",
        collections: collection("ai", "AI", "research", "News & Research"),
      },
    ],
  },
  {
    source: { id: "systems", label: "Engineering Weekly" },
    message: {
      id: "synthetic-systems",
      subject: "Systems notes",
      receivedAt: "2026-10-01T08:00:00Z",
    },
    items: [
      {
        id: "systems",
        title: "A practical guide to distributed systems",
        description:
          "Good foundations make complicated systems easier to reason about.",
        url: "https://example.com/systems",
        collections: [
          ...collection(
            "engineering",
            "Engineering",
            "systems-code",
            "Systems & Code",
          ),
          ...collection("ai", "AI", "agents-tools", "Agents & Tools"),
        ],
      },
    ],
  },
  {
    source: { id: "markets", label: "Market Letter" },
    message: {
      id: "synthetic-markets",
      subject: "Market briefing",
      receivedAt: "2026-10-01T08:00:00Z",
    },
    items: [
      {
        id: "narrative",
        title: "Signals from the macro landscape",
        description:
          "Interest rates, inflation, and market sentiment in one concise briefing. A wider view of the forces shaping the week.",
        collections: collection("markets", "Markets", "crypto", "Crypto"),
      },
    ],
  },
];
test.beforeAll(async ({ request }) => {
  for (const data of fixtures) {
    const response = await request.post("/api/v1/ingest", {
      headers: ingestHeaders,
      data,
    });
    expect([200, 201]).toContain(response.status());
  }
});
test("desktop reader and mobile layouts show configured categories and combined TLDR editions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "All reading",
    }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(6);
  await page.screenshot({ path: "qa/desktop-all.png", fullPage: true });
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button", { name: /^AI/ })
    .click();
  await page
    .getByRole("button", { name: "TLDR", exact: false })
    .first()
    .click();
  await expect(page.locator("article")).toHaveCount(3);
  await page.getByRole("checkbox", { name: "Show sponsored" }).check();
  await expect(page.locator("article")).toHaveCount(4);
  await page.getByRole("checkbox", { name: "Show sponsored" }).uncheck();
  await expect(
    page.locator("article").filter({ hasText: "TLDR AI" }),
  ).toHaveCount(1);
  await page.getByLabel("Filter by publication").selectOption("TLDR AI");
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByLabel("Filter by publication").selectOption("all");
  await page.screenshot({ path: "qa/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "qa/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Engineering/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "A practical guide to distributed systems",
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button", { name: /^AI/ })
    .click();
  await page.getByRole("button", { name: /Agents & Tools/ }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "A practical guide to distributed systems",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Markets/ }).click();
  await expect(
    page.getByRole("heading", { name: "Signals from the macro landscape" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read story" })).toHaveCount(0);
  await page.getByLabel("Search reading").fill("no match");
  await expect(
    page.getByRole("heading", { name: "No matching stories" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: /Business/ }).click();
  await expect(
    page.getByRole("heading", { name: "You're all caught up" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read history" }).click();
  await expect(
    page.getByRole("heading", { name: "No reading history yet" }),
  ).toBeVisible();
});
test("details, human preferences, clicks, resolve history and undo persist", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const card = page
    .locator("article")
    .filter({ hasText: "The next chapter of intelligent software" });
  const expansionResponse = page.waitForResponse((r) =>
    r.url().includes("description-expand"),
  );
  await card.getByRole("button", { name: "Details" }).click();
  const expansion = await expansionResponse;
  expect(expansion.status()).toBe(200);
  await expect(card.getByRole("button", { name: "Details" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await card.getByRole("button", { name: /More like/ }).click();
  await expect(card.getByRole("button", { name: /More like/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, body: "Synthetic destination" }),
  );
  const popup = page.waitForEvent("popup");
  await card.getByRole("link", { name: "Read story" }).click();
  const destination = await popup;
  await destination.waitForURL("https://example.com/software");
  await destination.close();
  await card.getByRole("button", { name: "Done" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Read history" }).click();
  await expect(card).toBeVisible();
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button", { name: /^AI/ })
    .click();
  await expect(
    page.getByRole("button", { name: "TLDR 1", exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Restore" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "To read", exact: true }).click();
  await expect(card).toBeVisible();
  const feedback = await request.get("/api/v1/engagement", {
    headers: { authorization: "Bearer synthetic-feedback-test-only" },
  });
  const { events } = await feedback.json();
  expect(
    events.find(
      (e: Record<string, unknown>) =>
        e.action === "resolve" &&
        e.api_source_id === "tldr" &&
        e.api_item_id === "story-1",
    ),
  ).toMatchObject({ actor: "human", resolve_mode: "after_open" });
  await page
    .getByRole("textbox", { name: "Search reading" })
    .fill("nonexistent");
  await expect(
    page.getByRole("heading", { name: "No matching stories" }),
  ).toBeVisible();
});
test("reader access, API roles, retired integrations and adversarial input", async ({
  request,
  page,
}) => {
  const reader = await request.get("/");
  expect(reader.status()).toBe(200);
  expect(reader.headers()["www-authenticate"]).toBeUndefined();
  expect(reader.headers()["cache-control"]).toContain("no-store");
  const inbox = await request.get("/api/inbox");
  expect(inbox.status()).toBe(200);
  expect(inbox.headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/api/v1/engagement")).status()).toBe(401);
  expect(
    (
      await request.get("/api/v1/engagement", { headers: ingestHeaders })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post("/api/v1/ingest", { data: fixtures[0] })).status(),
  ).toBe(401);
  expect((await request.post("/api/sync")).status()).toBe(410);
  expect(
    (
      await request.post("/api/items/1/resolve", {
        headers: { origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  expect((await request.post("/api/items/NaN/open")).status()).toBe(400);
  expect(
    (
      await request.post("/api/v1/ingest", {
        headers: ingestHeaders,
        data: {
          ...fixtures[0],
          items: [{ ...fixtures[0].items[0], url: "http://127.0.0.1/secrets" }],
        },
      })
    ).status(),
  ).toBe(400);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button", { name: /^AI/ })
    .click();
  await page.getByRole("button", { name: /Research/ }).click();
  expect(await page.evaluate(() => "compromised" in window)).toBe(false);
  await expect(page.locator("article script, article img")).toHaveCount(0);
});

test("failed actions can retry and reader mutations stay serialized", async ({
  page,
}) => {
  await page.goto("/");
  const card = page
    .locator("article")
    .filter({ hasText: "A practical guide to distributed systems" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/items/*/preference", async (route) => {
    requests++;
    if (requests === 1) {
      await gate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Synthetic temporary failure"}',
      });
    } else {
      await route.continue();
    }
  });
  await card.getByRole("button", { name: /More like/ }).click();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }).first(),
  ).toBeDisabled();
  await expect(card.getByRole("button", { name: /Less like/ })).toBeDisabled();
  release();
  const alert = page.locator(".error-message[role=alert]");
  await expect(alert).toContainText("Could not save this action");
  await expect(card.getByRole("button", { name: /More like/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await card.getByRole("button", { name: /More like/ }).click();
  await expect(card.getByRole("button", { name: /More like/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(alert).toHaveCount(0);
  expect(requests).toBe(2);
});
