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
      data: {
        ...data,
        items: data.items.map((item) => ({
          ...item,
          interestStatus: "interesting",
        })),
      },
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
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Archive is empty" }),
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
  await page.getByRole("button", { name: "Archive", exact: true }).click();
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
  let libraryRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/inbox") libraryRequests++;
  });
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
    card.getByRole("button", { name: /^Like and mark Done:/ }),
  ).toBeDisabled();
  await expect(card.getByRole("button", { name: /Less like/ })).toBeDisabled();
  await expect(card.getByRole("button", { name: /More like/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
  expect(libraryRequests).toBe(0);
});

test("Done waits for confirmation and ignores an older in-flight refresh", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const older = await (await request.get("/api/inbox")).json();
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let refreshRequests = 0;
  await page.route("**/api/inbox", async (route) => {
    refreshRequests++;
    await refreshGate;
    await route.fulfill({ json: older });
  });
  await page.getByRole("button", { name: "Refresh library" }).click();
  await expect.poll(() => refreshRequests).toBe(1);
  let releaseAction!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  let saved = false;
  await page.route("**/api/items/*/resolve?compact=1", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect((await response.json()).emails).toBeUndefined();
    saved = true;
    await actionGate;
    await route.fulfill({ response });
  });
  const card = page
    .locator("article")
    .filter({ hasText: "Designing a calmer relationship with technology" });
  await card.getByRole("button", { name: /^Like and mark Done:/ }).click();
  await expect.poll(() => saved).toBe(true);
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: /^Like and mark Done:/ }),
  ).toBeDisabled();
  releaseAction();
  await expect(card).toHaveCount(0);
  const refreshResponse = page.waitForResponse("**/api/inbox");
  releaseRefresh();
  await (await refreshResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(card).toHaveCount(0);
  expect(refreshRequests).toBe(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "To read", exact: true }).click();
  await expect(card).toBeVisible();
  expect(refreshRequests).toBe(1);
});

test("large libraries render bounded pages and search the entire archive", async ({
  page,
  request,
}) => {
  const payload = await (await request.get("/api/inbox")).json();
  const template = payload.emails[0];
  const item = template.items[0];
  payload.emails = [
    {
      ...template,
      items: Array.from({ length: 7623 }, (_, index) => ({
        ...item,
        id: 100000 + index,
        title: `Synthetic performance story ${index}`,
        itemKind: "editorial",
        resolvedAt: null,
        readingState: index < 1062 ? "to_read" : "archived",
        interestStatus: index < 1062 ? "interesting" : "not_interesting",
        interestCategory: index < 1062 ? "interesting" : "not_interesting",
      })),
    },
  ];
  await page.route("**/api/inbox", (route) => route.fulfill({ json: payload }));
  await page.goto("/");
  await page.getByRole("button", { name: "Refresh library" }).click();
  await expect(page.locator("article")).toHaveCount(50);
  const pages = page.getByRole("navigation", { name: "Story pages" });
  await expect(pages).toContainText("1–50 of 1062");
  await pages.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pages).toContainText("51–100 of 1062");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(50);
  await expect(pages).toContainText("1–50 of 6561");
  await page.screenshot({ path: "qa/pagination-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "qa/pagination-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await pages.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pages).toContainText("51–100 of 6561");
  await pages.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(pages).toContainText("1–50 of 6561");
  await page
    .getByLabel("Search reading")
    .fill("Synthetic performance story 7622");
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("story 7622");
  await page.getByLabel("Search reading").fill("");
  await expect(page.locator("article")).toHaveCount(50);
  await expect(pages).toContainText("1–50 of 6561");
});

test("imports all links, defaults to interesting unread stories, and archives Done by feedback category", async ({
  page,
  request,
}) => {
  const payload = {
    source: fixtures[0].source,
    message: {
      id: "synthetic-archive-issue",
      subject: "Archive workflow fixture",
      receivedAt: "2026-10-06T08:00:00Z",
    },
    items: [
      {
        id: "positive",
        title: "Archive fixture technical deep dive",
        interestStatus: "interesting",
        interestReason: "Concrete technical mechanisms",
      },
      {
        id: "negative",
        title: "Archive fixture launch headline",
        interestStatus: "not_interesting",
        interestReason: "Shallow announcement",
      },
      { id: "unknown", title: "Archive fixture awaiting classification" },
    ],
  };
  expect(
    (
      await request.post("/api/v1/ingest", {
        headers: ingestHeaders,
        data: payload,
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await page.getByLabel("Search reading").fill("Archive fixture");
  const cards = page.locator("article");
  const positive = cards.filter({ hasText: "technical deep dive" });
  await expect(cards).toHaveCount(1);
  await positive.getByRole("button", { name: /Less like/ }).click();
  await expect(
    positive.getByRole("button", { name: /Less like/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page
    .getByLabel("Filter archive by interest")
    .selectOption("not_interesting");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("launch headline");
  await cards.getByRole("button", { name: "Details" }).click();
  await expect(cards).toContainText(
    "Uploader classification: Shallow announcement",
  );
  await page
    .getByLabel("Filter archive by interest")
    .selectOption("unclassified");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("awaiting classification");
  await page.getByRole("button", { name: "To read", exact: true }).click();
  await positive.getByRole("button", { name: "Done", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByLabel("Filter archive by interest")
    .selectOption("not_interesting");
  await expect(cards).toHaveCount(2);
  await expect(positive).toContainText("Done");
  await positive.getByRole("button", { name: /More like/ }).click();
  await expect(positive).toHaveCount(0);
  await page
    .getByLabel("Filter archive by interest")
    .selectOption("interesting");
  await expect(positive).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByLabel("Search reading").fill("Archive fixture");
  await expect(cards).toHaveCount(3);
  await page.screenshot({ path: "qa/archive-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "qa/archive-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await positive.getByRole("button", { name: "Restore" }).click();
  await expect(positive).toHaveCount(0);
  await page.getByRole("button", { name: "To read", exact: true }).click();
  await expect(positive).toBeVisible();
});

test("one-click feedback and Done, persisted choices, neutral popover, and failed/slow saves", async ({
  page,
  request,
}) => {
  const imported = await (
    await request.post("/api/v1/ingest", {
      headers: ingestHeaders,
      data: {
        source: fixtures[0].source,
        message: {
          id: "synthetic-one-click",
          subject: "One-click fixture",
          receivedAt: "2026-10-07T08:00:00Z",
        },
        items: ["positive", "negative", "neutral"].map((id) => ({
          id,
          title: `One-click ${id} story`,
          interestStatus: "interesting",
        })),
      },
    })
  ).json();
  await page.goto("/");
  const positive = page
    .locator("article")
    .filter({ hasText: "One-click positive story" });
  const negative = page
    .locator("article")
    .filter({ hasText: "One-click negative story" });
  const neutral = page
    .locator("article")
    .filter({ hasText: "One-click neutral story" });
  await expect(
    positive.getByRole("button", { name: /^Like and mark Done:/ }),
  ).toBeVisible();
  await expect(
    positive.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCount(0);
  await positive.getByRole("button", { name: /^Less like:/ }).click();
  await expect(
    positive.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    positive.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  await expect(
    positive.getByRole("button", { name: /^Like and mark Done:/ }),
  ).toHaveCount(0);
  await positive.getByRole("button", { name: /^Less like:/ }).click();
  await expect(
    positive.getByRole("button", { name: /^Like and mark Done:/ }),
  ).toBeVisible();
  await positive
    .locator(".story-actions")
    .screenshot({ path: "qa/one-click-actions-desktop.png" });
  let resolveRequests = 0,
    libraryRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/inbox") libraryRequests++;
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/resolve")
    )
      resolveRequests++;
  });
  await positive.getByRole("button", { name: /^Like and mark Done:/ }).click();
  await expect(positive).toHaveCount(0);
  expect(resolveRequests).toBe(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    positive.getByRole("button", { name: /^More like:/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await positive.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "To read", exact: true }).click();
  await expect(
    positive.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();

  let attempts = 0,
    saved = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/items/*/resolve?compact=1", async (route) => {
    if (route.request().postDataJSON()?.signal !== "less_like_this") {
      await route.continue();
      return;
    }
    attempts++;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic failure" },
      });
      return;
    }
    const response = await route.fetch();
    saved = true;
    await gate;
    await route.fulfill({ response });
  });
  await negative
    .getByRole("button", { name: /^Dislike and mark Done:/ })
    .click();
  await expect(page.locator(".error-message[role=alert]")).toContainText(
    "Could not save this action",
  );
  await expect(
    negative.getByRole("button", { name: /^Less like:/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await negative
    .getByRole("button", { name: /^Dislike and mark Done:/ })
    .click();
  await expect.poll(() => saved).toBe(true);
  await expect(negative).toBeVisible();
  await expect(
    negative.getByRole("button", { name: /^Dislike and mark Done:/ }),
  ).toBeDisabled();
  await expect(
    negative.getByRole("button", { name: /^Less like:/ }),
  ).toHaveAttribute("aria-pressed", "false");
  release();
  await expect(negative).toHaveCount(0);
  expect(attempts).toBe(2);

  const more = neutral.getByRole("button", { name: /^More actions:/ });
  const neutralDone = neutral.getByRole("button", {
    name: "Done without feedback",
    exact: true,
  });
  await more.focus();
  await more.press("Enter");
  await expect(neutralDone).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(neutralDone).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("heading", { name: "All reading", exact: true }).click();
  await expect(neutralDone).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await more.click();
  await expect(neutralDone).toBeVisible();
  const box = (await neutralDone.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "qa/one-click-mobile.png", fullPage: true });
  await neutralDone.click();
  await expect(neutral).toHaveCount(0);
  const payload = await (await request.get("/api/inbox")).json();
  const items = payload.emails.flatMap(
    (email: { items: Record<string, unknown>[] }) => email.items,
  );
  const neutralId = imported.items.find(
    (item: { id: string }) => item.id === "neutral",
  ).internalId;
  expect(
    items.find((item: { id: number }) => item.id === neutralId),
  ).toMatchObject({
    preference: null,
    resolvedAt: expect.any(Number),
    readingState: "archived",
  });
  expect(libraryRequests).toBe(0);
});
