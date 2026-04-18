import {
  defaultDbPath,
  loadInteractions,
  parseFlags,
  readNumberFlag,
  readStringFlag,
  writeOutput,
} from "./common.mjs";

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "another",
  "because",
  "before",
  "being",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "more",
  "most",
  "over",
  "read",
  "some",
  "than",
  "that",
  "their",
  "there",
  "these",
  "this",
  "through",
  "under",
  "using",
  "were",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

const MODEL = {
  descriptionExpandWeight: 0.75,
  linkOpenWeight: 1.5,
  afterOpenResolveWeight: 4,
  directResolveWeight: -2,
  unresolveWeight: 1,
};

function normalizeText(input) {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input) {
  return normalizeText(input)
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOPWORDS.has(token) &&
        !/^\d+$/.test(token) &&
        !/^\d+\s*minute/.test(token),
    );
}

function titlePhrases(title) {
  const tokens = tokenize(title.replace(/\([^)]*\)/g, ""));
  const phrases = new Set();

  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return [...phrases];
}

function itemKey(row) {
  return `${row.sourceVariant}::${row.title}::${row.canonicalUrl ?? row.finalUrl ?? row.trackedUrl}`;
}

function interactionScore(row) {
  if (row.action === "description_expand") {
    return MODEL.descriptionExpandWeight;
  }

  if (row.action === "link_open") {
    return MODEL.linkOpenWeight;
  }

  if (row.action === "unresolve") {
    return MODEL.unresolveWeight;
  }

  if (row.action === "resolve") {
    return row.resolveMode === "after_open"
      ? MODEL.afterOpenResolveWeight
      : MODEL.directResolveWeight;
  }

  return 0;
}

function buildItemSignals(interactions) {
  const map = new Map();

  for (const row of interactions) {
    const key = itemKey(row);
    const current = map.get(key) ?? {
      key,
      sourceVariant: row.sourceVariant,
      section: row.section,
      itemKind: row.itemKind,
      readTimeText: row.readTimeText,
      title: row.title,
      fullDescription: row.fullDescription,
      canonicalUrl: row.canonicalUrl,
      finalUrl: row.finalUrl,
      descriptionExpands: 0,
      linkOpens: 0,
      directResolves: 0,
      afterOpenResolves: 0,
      unresolves: 0,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.createdAt,
      score: 0,
    };

    current.firstSeenAt = Math.min(current.firstSeenAt, row.createdAt);
    current.lastSeenAt = Math.max(current.lastSeenAt, row.createdAt);
    current.score += interactionScore(row);

    if (row.action === "description_expand") {
      current.descriptionExpands += 1;
    } else if (row.action === "link_open") {
      current.linkOpens += 1;
    } else if (row.action === "unresolve") {
      current.unresolves += 1;
    } else if (row.action === "resolve" && row.resolveMode === "after_open") {
      current.afterOpenResolves += 1;
    } else if (row.action === "resolve") {
      current.directResolves += 1;
    }

    map.set(key, current);
  }

  return [...map.values()].sort((a, b) => b.score - a.score);
}

function emptyAggregate(key) {
  return {
    key,
    itemCount: 0,
    eventCount: 0,
    descriptionExpands: 0,
    linkOpens: 0,
    directResolves: 0,
    afterOpenResolves: 0,
    unresolves: 0,
    score: 0,
  };
}

function aggregateBy(interactions, keyForRow) {
  const map = new Map();
  const itemKeysByAggregate = new Map();

  for (const row of interactions) {
    for (const key of keyForRow(row)) {
      const aggregate = map.get(key) ?? emptyAggregate(key);
      aggregate.eventCount += 1;
      aggregate.score += interactionScore(row);

      if (row.action === "description_expand") {
        aggregate.descriptionExpands += 1;
      } else if (row.action === "link_open") {
        aggregate.linkOpens += 1;
      } else if (row.action === "unresolve") {
        aggregate.unresolves += 1;
      } else if (row.action === "resolve" && row.resolveMode === "after_open") {
        aggregate.afterOpenResolves += 1;
      } else if (row.action === "resolve") {
        aggregate.directResolves += 1;
      }

      map.set(key, aggregate);

      const itemSet = itemKeysByAggregate.get(key) ?? new Set();
      itemSet.add(itemKey(row));
      itemKeysByAggregate.set(key, itemSet);
    }
  }

  for (const [key, aggregate] of map) {
    aggregate.itemCount = itemKeysByAggregate.get(key)?.size ?? 0;
  }

  return [...map.values()]
    .filter((aggregate) => aggregate.eventCount > 0)
    .sort((a, b) => b.score - a.score);
}

function buildKeywordKeys(row) {
  const titleTokens = new Set(tokenize(row.title));
  const descriptionTokens = new Set(tokenize(row.fullDescription));
  return [...new Set([...titleTokens, ...descriptionTokens])];
}

function buildAnalysis({ dbPath, interactions, warning, minSamples, top }) {
  const items = buildItemSignals(interactions);
  const interactionCount = interactions.length;
  const ready = interactionCount >= minSamples;
  const limit = Math.max(1, top);
  const keywords = aggregateBy(interactions, buildKeywordKeys);
  const titlePhraseSignals = aggregateBy(interactions, (row) =>
    titlePhrases(row.title),
  );
  const positiveSignals = [...keywords, ...titlePhraseSignals].filter(
    (signal) =>
      signal.score >= 4 &&
      signal.afterOpenResolves + signal.linkOpens >= 2 &&
      signal.directResolves <= signal.afterOpenResolves,
  );
  const negativeSignals = [...keywords, ...titlePhraseSignals].filter(
    (signal) =>
      signal.score <= -4 &&
      signal.directResolves >= 2 &&
      signal.afterOpenResolves === 0,
  );

  return {
    generatedAt: new Date().toISOString(),
    dbPath,
    warning,
    interactionCount,
    uniqueItemCount: items.length,
    readiness: {
      minSamples,
      ready,
      message: ready
        ? "Enough interactions for directional scoring. Review manually before automating filters."
        : `Collect at least ${Math.max(0, minSamples - interactionCount)} more interaction(s) before trusting filtering suggestions.`,
    },
    model: MODEL,
    totals: {
      descriptionExpands: interactions.filter(
        (row) => row.action === "description_expand",
      ).length,
      linkOpens: interactions.filter((row) => row.action === "link_open")
        .length,
      directResolves: interactions.filter(
        (row) => row.action === "resolve" && row.resolveMode !== "after_open",
      ).length,
      afterOpenResolves: interactions.filter(
        (row) => row.action === "resolve" && row.resolveMode === "after_open",
      ).length,
      unresolves: interactions.filter((row) => row.action === "unresolve")
        .length,
    },
    topInterestingItems: items.filter((item) => item.score > 0).slice(0, limit),
    likelySkippedItems: [...items]
      .filter((item) => item.directResolves > 0 && item.score < 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, limit),
    sourceVariants: aggregateBy(interactions, (row) => [
      row.sourceVariant,
    ]).slice(0, limit),
    sections: aggregateBy(interactions, (row) => [
      `${row.sourceVariant} / ${row.section}`,
    ]).slice(0, limit),
    itemKinds: aggregateBy(interactions, (row) => [row.itemKind]).slice(
      0,
      limit,
    ),
    keywords: keywords.slice(0, limit),
    titlePhrases: titlePhraseSignals.slice(0, limit),
    candidateRules: [
      ...positiveSignals.slice(0, limit).map((signal) => ({
        type: "promote",
        signal: signal.key,
        reason:
          "Positive score from description expands, link opens, and/or resolves after opening the article.",
        score: signal.score,
        evidenceCount: signal.eventCount,
      })),
      ...negativeSignals.slice(0, limit).map((signal) => ({
        type: "deprioritize",
        signal: signal.key,
        reason:
          "Repeated direct resolves without prior link opens suggest low interest.",
        score: signal.score,
        evidenceCount: signal.eventCount,
      })),
    ],
  };
}

function formatScore(score) {
  return score.toFixed(1).replace(/\.0$/, "");
}

function formatAggregateTable(items) {
  if (!items.length) {
    return "_No data yet._";
  }

  return [
    "| Signal | Score | Items | Description expands | Opens | After-open resolves | Direct resolves |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map(
      (item) =>
        `| ${item.key} | ${formatScore(item.score)} | ${item.itemCount} | ${item.descriptionExpands} | ${item.linkOpens} | ${item.afterOpenResolves} | ${item.directResolves} |`,
    ),
  ].join("\n");
}

function formatItemList(items) {
  if (!items.length) {
    return "_No data yet._";
  }

  return items
    .map(
      (item, index) =>
        `${index + 1}. **${item.title}** (${item.sourceVariant}, ${item.section}) - score ${formatScore(item.score)}, description expands ${item.descriptionExpands}, opens ${item.linkOpens}, after-open resolves ${item.afterOpenResolves}, direct resolves ${item.directResolves}`,
    )
    .join("\n");
}

function renderMarkdown(analysis) {
  return `# Mail Digester Interest Analysis

Generated: ${analysis.generatedAt}

DB: \`${analysis.dbPath}\`

${analysis.warning ? `Warning: ${analysis.warning}\n` : ""}## Readiness

- Interactions: ${analysis.interactionCount}
- Unique items: ${analysis.uniqueItemCount}
- Minimum sample target: ${analysis.readiness.minSamples}
- Status: ${analysis.readiness.message}

## Scoring Model

- Description expanded: +${analysis.model.descriptionExpandWeight}
- Link opened: +${analysis.model.linkOpenWeight}
- Resolved after opening link: +${analysis.model.afterOpenResolveWeight}
- Resolved directly without opening: ${analysis.model.directResolveWeight}
- Unresolved via undo: +${analysis.model.unresolveWeight}

Interpretation: expanding the newsletter description is a light interest signal, opening an item before resolving is a strong interest signal, and resolving directly is a low-interest signal because it means the item was cleared without visiting the article.

## Totals

- Description expands: ${analysis.totals.descriptionExpands}
- Link opens: ${analysis.totals.linkOpens}
- Resolves after opening: ${analysis.totals.afterOpenResolves}
- Direct resolves: ${analysis.totals.directResolves}
- Undo/unresolve events: ${analysis.totals.unresolves}

## Top Interesting Items

${formatItemList(analysis.topInterestingItems)}

## Likely Skipped Items

${formatItemList(analysis.likelySkippedItems)}

## Source Variants

${formatAggregateTable(analysis.sourceVariants)}

## Sections

${formatAggregateTable(analysis.sections)}

## Item Kinds

${formatAggregateTable(analysis.itemKinds)}

## Keywords

${formatAggregateTable(analysis.keywords)}

## Title Phrases

${formatAggregateTable(analysis.titlePhrases)}

## Candidate Rules

${
  analysis.candidateRules.length
    ? analysis.candidateRules
        .map(
          (rule) =>
            `- ${rule.type.toUpperCase()} \`${rule.signal}\`: ${rule.reason} Score ${formatScore(rule.score)} from ${rule.evidenceCount} event(s).`,
        )
        .join("\n")
    : "_No rule candidates yet. Collect more interactions first._"
}
`;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = readStringFlag(flags, "db", defaultDbPath());
  const format = readStringFlag(flags, "format", "markdown");
  const outputPath = readStringFlag(flags, "out", "");
  const minSamples = readNumberFlag(flags, "min-samples", 30);
  const top = readNumberFlag(flags, "top", 12);
  const sinceDays = readNumberFlag(flags, "since-days", 0);
  const loaded = loadInteractions({
    dbPath,
    sinceDays: sinceDays > 0 ? sinceDays : undefined,
  });
  const analysis = buildAnalysis({
    dbPath,
    interactions: loaded.interactions,
    minSamples,
    top,
    warning: loaded.warning,
  });

  writeOutput({
    content:
      format === "json"
        ? JSON.stringify(analysis, null, 2)
        : renderMarkdown(analysis),
    outputPath: outputPath || null,
  });
}

main();
