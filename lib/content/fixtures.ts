export const FIXTURE_ARTICLES: Record<
  string,
  {
    title: string;
    siteName: string;
    byline: string;
    excerpt: string;
    paragraphs: string[];
  }
> = {
  "openai-roadmap": {
    title: "OpenAI sharpens its enterprise roadmap",
    siteName: "Example Briefs",
    byline: "Avery Lane",
    excerpt:
      "A packaging shift designed to close the gap between exploration and production deployment.",
    paragraphs: [
      "OpenAI used its latest roadmap note to tighten the handoff from experimental AI usage to production-grade enterprise deployment.",
      "The biggest change is not one model release. It is the clearer packaging around governance, observability, and cost controls.",
      "That matters because most teams do not need more demos. They need a faster path from pilot work to accountable rollout.",
    ],
  },
  "claude-control-panels": {
    title: "Claude adds role-aware control panels",
    siteName: "Example Briefs",
    byline: "Jordan Hale",
    excerpt:
      "Anthropic focused on governance surfaces that make collaborative usage easier to manage.",
    paragraphs: [
      "Anthropic expanded Claude with workspace controls that better match how teams actually budget and delegate AI work.",
      "The new controls emphasize visibility, role boundaries, and operational confidence instead of headline-grabbing novelty.",
      "For organizations already using assistant tooling, that usually shortens the distance between adoption and standardization.",
    ],
  },
  "eval-loops": {
    title: "A practical guide to evaluation loops",
    siteName: "Operational Notes",
    byline: "Kai Mercer",
    excerpt:
      "How to keep experimentation fast while still catching regressions before users do.",
    paragraphs: [
      "Teams over-invest in dashboards and under-invest in the small evaluation loops that prevent recurring regressions.",
      "The most reliable evaluation systems are boring: they run often, they are easy to interpret, and they feed directly into release decisions.",
      "If a signal cannot change an engineering decision, it is reporting, not evaluation.",
    ],
  },
  "compute-race": {
    title: "Amazon escalates the infrastructure race",
    siteName: "Systems Weekly",
    byline: "Morgan Price",
    excerpt:
      "Custom silicon, logistics leverage, and ownership of the full stack are increasingly linked.",
    paragraphs: [
      "Amazon framed the next phase of cloud competition around controlling more of the stack, from silicon to logistics and distribution.",
      "That shifts the conversation from raw model quality to who can make complex systems cheaper, more reliable, and easier to ship at scale.",
      "The strongest players are converging on the same lesson: infrastructure is product strategy.",
    ],
  },
  "ai-humans": {
    title: "The full-stack developer platform to build real-time AI humans",
    siteName: "Vendor Brief",
    byline: "Partner Studio",
    excerpt:
      "A sponsor-style piece on shipping low-latency conversational experiences.",
    paragraphs: [
      "Real-time AI products fail when latency, state management, and multimodal orchestration are treated as separate problems.",
      "The pitch here is that a single platform can reduce glue code and give teams a more direct path to production.",
      "Whether that tradeoff is worth it depends on how opinionated a team wants its core stack to be.",
    ],
  },
  "programming-hunches": {
    title: "What are your programming hunches you haven't yet investigated?",
    siteName: "Community Thread Digest",
    byline: "Forum Staff",
    excerpt:
      "A thread full of engineering intuitions waiting for real experiments.",
    paragraphs: [
      "One of the healthiest engineering habits is keeping a list of intuitions that feel true but have not yet earned trust.",
      "Threads like this are useful because they surface candidate experiments rather than polished conclusions.",
      "The best replies tend to transform vague hunches into measurable tests.",
    ],
  },
};

export function getFixtureArticle(slug: string) {
  return FIXTURE_ARTICLES[slug] ?? null;
}

export function getFixtureArticleHtml(slug: string) {
  const article = getFixtureArticle(slug);
  if (!article) {
    return null;
  }

  return `
    <!doctype html>
    <html>
      <head>
        <title>${article.title}</title>
      </head>
      <body>
        <main>
          <article>
            <h1>${article.title}</h1>
            <p>${article.byline}</p>
            <p>${article.excerpt}</p>
            ${article.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}
          </article>
        </main>
      </body>
    </html>
  `;
}

export function resolveFixtureUrl(url: string) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const slug = segments.at(-1);

  if (!slug) {
    return null;
  }

  if (
    parsed.pathname.includes("/redirect/") ||
    parsed.pathname.includes("/article/") ||
    parsed.pathname.includes("/test-fixtures/article/")
  ) {
    return {
      finalUrl: `http://fixtures.test/article/${slug}`,
      html: getFixtureArticleHtml(slug),
    };
  }

  return null;
}
