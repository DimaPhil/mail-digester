import {
  defaultDbPath,
  loadInteractions,
  parseFlags,
  readNumberFlag,
  readStringFlag,
  writeOutput,
} from "./common.mjs";

const FILTER_RECOMMENDATION_SCHEMA_PATH =
  "analytics/filter-recommendations.schema.json";

function itemKey(row) {
  return `${row.sourceVariant}::${row.title}::${row.canonicalUrl ?? row.finalUrl ?? row.trackedUrl}`;
}

function truncateText(input, limit) {
  if (!input) {
    return null;
  }

  if (input.length <= limit) {
    return input;
  }

  return `${input.slice(0, limit - 1).trimEnd()}…`;
}

function summarizeItems(interactions) {
  const map = new Map();

  for (const row of interactions) {
    const key = itemKey(row);
    const current = map.get(key) ?? {
      sourceFamily: row.sourceFamily,
      sourceVariant: row.sourceVariant,
      section: row.section,
      itemKind: row.itemKind,
      readTimeText: row.readTimeText,
      title: row.title,
      fullDescription: row.fullDescription,
      canonicalUrl: row.canonicalUrl,
      finalUrl: row.finalUrl,
      snapshotStatus: row.snapshotStatus,
      snapshotTitle: row.snapshotTitle,
      snapshotByline: row.snapshotByline,
      snapshotSiteName: row.snapshotSiteName,
      snapshotExcerpt: row.snapshotExcerpt,
      snapshotContentText: row.snapshotContentText,
      emailSubjects: new Set(),
      linkOpens: 0,
      resolvesAfterOpen: 0,
      directResolves: 0,
      unresolves: 0,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.createdAt,
    };

    current.emailSubjects.add(row.emailSubject);
    current.firstSeenAt = Math.min(current.firstSeenAt, row.createdAt);
    current.lastSeenAt = Math.max(current.lastSeenAt, row.createdAt);

    if (row.action === "link_open") {
      current.linkOpens += 1;
    } else if (row.action === "unresolve") {
      current.unresolves += 1;
    } else if (row.action === "resolve" && row.resolveMode === "after_open") {
      current.resolvesAfterOpen += 1;
    } else if (row.action === "resolve") {
      current.directResolves += 1;
    }

    map.set(key, current);
  }

  return [...map.values()]
    .map((item) => ({
      ...item,
      emailSubjects: [...item.emailSubjects],
      interestScore:
        item.linkOpens * 1.5 +
        item.resolvesAfterOpen * 4 -
        item.directResolves * 2 +
        item.unresolves,
      articleSnapshot: item.snapshotStatus
        ? {
            status: item.snapshotStatus,
            title: item.snapshotTitle,
            byline: item.snapshotByline,
            siteName: item.snapshotSiteName,
            excerpt: item.snapshotExcerpt,
            contentTextPreview: truncateText(item.snapshotContentText, 2400),
          }
        : null,
    }))
    .map(
      ({
        snapshotStatus: _snapshotStatus,
        snapshotTitle: _snapshotTitle,
        snapshotByline: _snapshotByline,
        snapshotSiteName: _snapshotSiteName,
        snapshotExcerpt: _snapshotExcerpt,
        snapshotContentText: _snapshotContentText,
        ...item
      }) => item,
    )
    .sort((a, b) => {
      const eventDelta =
        b.linkOpens +
        b.resolvesAfterOpen +
        b.directResolves +
        b.unresolves -
        (a.linkOpens + a.resolvesAfterOpen + a.directResolves + a.unresolves);
      return eventDelta || b.interestScore - a.interestScore;
    });
}

function buildPayload(input) {
  const items = summarizeItems(input.interactions).slice(0, input.maxItems);

  return {
    generatedAt: new Date().toISOString(),
    dbPath: input.dbPath,
    warning: input.warning,
    instructions:
      "Infer the reader's interests from TLDR newsletter interactions. Resolving after opening a link is strong positive evidence. Opening without resolving is medium positive evidence. Direct resolve without opening is negative or low-interest evidence. Use the newsletter title and fullDescription for every item, plus articleSnapshot fields when they exist because the article was opened and extracted. Return only reversible recommendations and avoid overfitting sparse samples.",
    filterRecommendationSchemaPath: FILTER_RECOMMENDATION_SCHEMA_PATH,
    desiredOutputSchema: {
      summary: "Brief human-readable interest profile.",
      generatedAt: "ISO-8601 timestamp",
      rules: [
        {
          id: "stable-rule-id",
          name: "Human-readable rule name",
          enabled: false,
          source: "llm",
          action: "promote | deprioritize | hide",
          confidence: "low | medium | high",
          reversible: true,
          rationale: "Why this rule exists.",
          conditions: [
            {
              field:
                "sourceVariant | section | itemKind | title | fullDescription | keyword | titlePhrase | siteName | canonicalUrl",
              operator: "equals | contains | startsWith | anyOf",
              value: "string or string[]",
            },
          ],
          evidence: {
            interactionCount: 0,
            uniqueItemCount: 0,
            linkOpens: 0,
            resolvesAfterOpen: 0,
            directResolves: 0,
            unresolves: 0,
            exampleTitles: ["string"],
          },
          createdAt: "ISO-8601 timestamp",
        },
      ],
      questionsToAskUser: ["string"],
    },
    totals: {
      interactions: input.interactions.length,
      uniqueItems: items.length,
      linkOpens: input.interactions.filter((row) => row.action === "link_open")
        .length,
      resolvesAfterOpen: input.interactions.filter(
        (row) => row.action === "resolve" && row.resolveMode === "after_open",
      ).length,
      directResolves: input.interactions.filter(
        (row) => row.action === "resolve" && row.resolveMode !== "after_open",
      ).length,
      unresolves: input.interactions.filter((row) => row.action === "unresolve")
        .length,
    },
    items,
  };
}

function renderMarkdown(payload) {
  return `# Mail Digester LLM Context

Generated: ${payload.generatedAt}

DB: \`${payload.dbPath}\`

${payload.warning ? `Warning: ${payload.warning}\n` : ""}## Task

${payload.instructions}

JSON schema path for future app integration: \`${payload.filterRecommendationSchemaPath}\`

## Evidence Counts

- Interactions: ${payload.totals.interactions}
- Unique items in context: ${payload.totals.uniqueItems}
- Link opens: ${payload.totals.linkOpens}
- Resolves after opening: ${payload.totals.resolvesAfterOpen}
- Direct resolves: ${payload.totals.directResolves}
- Undo/unresolve events: ${payload.totals.unresolves}

## Desired Output Schema

\`\`\`json
${JSON.stringify(payload.desiredOutputSchema, null, 2)}
\`\`\`

## Interaction Evidence

\`\`\`json
${JSON.stringify(payload.items, null, 2)}
\`\`\`
`;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = readStringFlag(flags, "db", defaultDbPath());
  const format = readStringFlag(flags, "format", "markdown");
  const outputPath = readStringFlag(flags, "out", "");
  const sinceDays = readNumberFlag(flags, "since-days", 0);
  const maxItems = readNumberFlag(flags, "max-items", 80);
  const loaded = loadInteractions({
    dbPath,
    sinceDays: sinceDays > 0 ? sinceDays : undefined,
  });
  const payload = buildPayload({
    dbPath,
    interactions: loaded.interactions,
    maxItems,
    warning: loaded.warning,
  });

  writeOutput({
    content:
      format === "json"
        ? JSON.stringify(payload, null, 2)
        : renderMarkdown(payload),
    outputPath: outputPath || null,
  });
}

main();
