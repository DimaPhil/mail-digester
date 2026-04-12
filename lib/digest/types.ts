import type { ProviderMessage } from "@/lib/mail/types";

export type ParsedDigestItemKind =
  | "editorial"
  | "sponsor"
  | "discussion"
  | "other";

export type ParsedDigestItem = {
  sourceItemId: string;
  section: string;
  position: number;
  title: string;
  summary: string;
  readTimeText: string | null;
  itemKind: ParsedDigestItemKind;
  trackedUrl: string;
  canonicalUrl: string | null;
  finalUrl: string | null;
};

export type ParsedDigestEmail = {
  providerMessageId: string;
  providerThreadId: string | null;
  sourceFamily: string;
  sourceVariant: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  items: ParsedDigestItem[];
};

export interface DigestSource {
  matches(message: ProviderMessage): boolean;
  parse(message: ProviderMessage): ParsedDigestEmail;
}
