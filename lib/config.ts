import path from "node:path";

export const APP_NAME = "Mail Digester";
export const APP_PORT = Number(process.env.PORT ?? "4001");
export const DB_PATH =
  process.env.MAIL_DIGESTER_DB_PATH ??
  path.join(process.cwd(), "data", "mail-digester.sqlite");
export const GWS_BINARY = process.env.GWS_BINARY ?? "gws";
export const GMAIL_TLDR_QUERY =
  process.env.GMAIL_TLDR_QUERY ?? "is:unread from:tldrnewsletter.com";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4";
const interestClassificationConcurrency = Number(
  process.env.MAIL_DIGESTER_INTEREST_CLASSIFICATION_CONCURRENCY ?? "4",
);
export const INTEREST_CLASSIFICATION_CONCURRENCY =
  Number.isFinite(interestClassificationConcurrency) &&
  interestClassificationConcurrency >= 1
    ? Math.floor(interestClassificationConcurrency)
    : 4;
export const INITIAL_SYNC_STALE_MS = 1000 * 60 * 15;
export const USER_AGENT =
  "MailDigester/1.0 (+https://github.com/DimaPhil/mail-digester)";
