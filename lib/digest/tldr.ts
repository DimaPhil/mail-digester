import { JSDOM } from "jsdom";
import { normalizeTrackedUrl } from "@/lib/content/url";
import type {
  DigestSource,
  ParsedDigestEmail,
  ParsedDigestItem,
  ParsedDigestItemKind,
} from "@/lib/digest/types";
import type { ProviderMessage } from "@/lib/mail/types";
import { cleanText } from "@/lib/utils";

const HEADING_PATTERN =
  /^(headlines|deep dives|engineering|research|launches|together with|tools|miscellaneous|news|other stories)/i;
const READING_PATTERN = /\(([^)]*(?:minute read|thread|sponsor))\)/i;
const IGNORE_TEXT_PATTERN =
  /^(sign up|advertise|view online|manage your subscriptions|unsubscribe|track your referrals|apply here|create your own role|learn more|run your first query|grab time with the team|sign up here|track your referral|refer)/i;
const IGNORE_URL_PATTERN =
  /(unsubscribe|manage|refer|advertise|signup|web-version|track-your-referrals|track-your-referral|jobs\.ashbyhq\.com\/tldr\.tech)/i;

function getHeader(message: ProviderMessage, name: string) {
  return (
    message.headers.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function isHeading(text: string) {
  const normalized = cleanText(text);
  if (!normalized || normalized.length < 4 || normalized.length > 60) {
    return false;
  }

  const uppercaseRatio =
    normalized.replace(/[^A-Z]/g, "").length / Math.max(normalized.length, 1);
  return uppercaseRatio > 0.35 || HEADING_PATTERN.test(normalized);
}

function pickContainer(anchor: HTMLAnchorElement) {
  let current: HTMLElement | null = anchor.parentElement;

  while (current) {
    const text = cleanText(current.textContent);
    const anchors = current.querySelectorAll("a[href]").length;

    if (text.length >= 40 && text.length <= 3000 && anchors <= 6) {
      return current;
    }

    current = current.parentElement;
  }

  return anchor.parentElement ?? anchor;
}

function summarizeContainer(container: HTMLElement, title: string) {
  const text = cleanText(container.textContent);
  if (!text) {
    return "";
  }

  let summary = text.replace(title, "").trim();
  summary = summary.replace(/\bSponsor\b/gi, "").trim();
  summary = summary.replace(/\s+/g, " ");

  if (summary.length <= 24) {
    return "";
  }

  return summary;
}

function classifyItemKind(
  title: string,
  summary: string,
): ParsedDigestItemKind {
  if (/sponsor/i.test(title) || /sponsor/i.test(summary)) {
    return "sponsor";
  }

  if (/thread/i.test(title)) {
    return "discussion";
  }

  if (/minute read/i.test(title)) {
    return "editorial";
  }

  return "other";
}

function isPrimaryItemTitle(title: string) {
  return READING_PATTERN.test(title);
}

function inferVariant(senderName: string, subject: string, html: string) {
  const normalizedSender = cleanText(senderName);
  if (normalizedSender && !normalizedSender.includes("@")) {
    return normalizedSender;
  }

  const variantFromLink = html.match(/tldr\.tech\/([a-z0-9-]+)\?/i)?.[1];
  if (variantFromLink) {
    return `TLDR ${variantFromLink.toUpperCase()}`;
  }

  return subject.includes("AI") ? "TLDR AI" : "TLDR";
}

export class TldrDigestSource implements DigestSource {
  matches(message: ProviderMessage) {
    return (
      message.senderEmail.endsWith("@tldrnewsletter.com") &&
      message.htmlBody.includes("tracking.tldrnewsletter.com")
    );
  }

  parse(message: ProviderMessage): ParsedDigestEmail {
    const dom = new JSDOM(message.htmlBody);
    const document = dom.window.document;
    const headings = new Map<Element, string>();

    for (const element of document.querySelectorAll("p, h1, h2, h3, strong")) {
      const text = cleanText(element.textContent);
      if (isHeading(text)) {
        headings.set(element, text);
      }
    }

    let currentSection = "Top stories";
    const items: ParsedDigestItem[] = [];
    const seenKeys = new Set<string>();

    const orderedHeadings = [...headings.entries()];

    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
      "a[href]",
    )) {
      const title = cleanText(anchor.textContent);
      const href = cleanText(anchor.getAttribute("href"));

      if (!title || !href) {
        continue;
      }

      if (IGNORE_TEXT_PATTERN.test(title) || IGNORE_URL_PATTERN.test(href)) {
        continue;
      }

      if (!isPrimaryItemTitle(title)) {
        continue;
      }

      const domNode = anchor.ownerDocument.defaultView?.Node;
      for (const heading of orderedHeadings) {
        if (
          domNode &&
          heading[0].compareDocumentPosition(anchor) &
            domNode.DOCUMENT_POSITION_PRECEDING
        ) {
          break;
        }
        currentSection = heading[1];
      }

      const container = pickContainer(anchor);
      const summary = summarizeContainer(container, title);
      const readTime = title.match(READING_PATTERN)?.[1] ?? null;
      const itemKind = classifyItemKind(title, summary);

      if (!readTime && summary.length < 64) {
        continue;
      }

      const normalized = normalizeTrackedUrl(href);
      const sourceItemId = `${currentSection}:${title}:${normalized.canonicalUrl ?? href}`;

      if (seenKeys.has(sourceItemId)) {
        continue;
      }

      seenKeys.add(sourceItemId);
      items.push({
        sourceItemId,
        section: currentSection,
        position: items.length,
        title,
        summary,
        readTimeText: readTime,
        itemKind,
        trackedUrl: href,
        canonicalUrl: normalized.canonicalUrl,
        finalUrl: normalized.needsNetworkResolution
          ? null
          : normalized.canonicalUrl,
      });
    }

    return {
      providerMessageId: message.id,
      providerThreadId: message.threadId ?? null,
      sourceFamily: "tldr",
      sourceVariant: inferVariant(
        message.senderName,
        message.subject,
        message.htmlBody,
      ),
      senderName: message.senderName,
      senderEmail: message.senderEmail,
      subject: message.subject,
      snippet: message.snippet,
      receivedAt: message.receivedAt,
      items,
    };
  }
}

export function parseSender(value: string) {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) {
    return {
      senderName: value,
      senderEmail: value,
    };
  }

  return {
    senderName: cleanText(match[1].replace(/(^"|"$)/g, "")),
    senderEmail: cleanText(match[2]),
  };
}

export function providerMessageFromFixture(input: {
  id: string;
  subject: string;
  from: string;
  htmlBody: string;
  receivedAt?: number;
  snippet?: string;
}): ProviderMessage {
  const sender = parseSender(input.from);
  return {
    id: input.id,
    threadId: input.id,
    headers: [
      { name: "From", value: input.from },
      { name: "Subject", value: input.subject },
      {
        name: "Date",
        value: new Date(input.receivedAt ?? Date.now()).toUTCString(),
      },
    ],
    senderName: sender.senderName,
    senderEmail: sender.senderEmail,
    subject: input.subject,
    receivedAt: input.receivedAt ?? Date.now(),
    snippet: input.snippet ?? "",
    htmlBody: input.htmlBody,
    textBody: "",
    rawLabelIds: ["UNREAD"],
  };
}
