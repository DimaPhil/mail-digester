import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";
import { USER_AGENT } from "@/lib/config";
import { resolveFixtureUrl } from "@/lib/content/fixtures";
import { canonicalizeUrl } from "@/lib/content/url";

export type ReadableArticle = {
  urlKey: string;
  sourceUrl: string;
  finalUrl: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  contentHtml: string;
  contentText: string;
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "h1",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "code",
    "a",
    "strong",
    "em",
    "b",
    "i",
    "hr",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noreferrer noopener",
    }),
  },
};

export function extractReadableArticleFromHtml(input: {
  html: string;
  sourceUrl: string;
  finalUrl: string;
}) {
  const dom = new JSDOM(input.html, {
    url: input.finalUrl,
  });
  const reader = new Readability(dom.window.document);
  const result = reader.parse();

  if (!result?.content) {
    throw new Error("Could not extract readable article content.");
  }

  const contentHtml = sanitizeHtml(result.content, SANITIZE_OPTIONS);

  return {
    urlKey: canonicalizeUrl(input.finalUrl),
    sourceUrl: input.sourceUrl,
    finalUrl: input.finalUrl,
    title: result.title || input.finalUrl,
    byline: result.byline || null,
    siteName: result.siteName || dom.window.document.title || null,
    excerpt: result.excerpt || null,
    contentHtml,
    contentText: result.textContent || "",
  } satisfies ReadableArticle;
}

export async function fetchReadableSnapshot(url: string) {
  const fixture = resolveFixtureUrl(url);
  if (fixture?.html) {
    return extractReadableArticleFromHtml({
      html: fixture.html,
      sourceUrl: url,
      finalUrl: fixture.finalUrl,
    });
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch article (${response.status}).`);
  }

  const finalUrl = response.url;
  const html = await response.text();

  return extractReadableArticleFromHtml({
    html,
    sourceUrl: url,
    finalUrl,
  });
}
