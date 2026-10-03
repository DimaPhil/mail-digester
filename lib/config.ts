import path from "node:path";
export const APP_NAME = "Mail Digester";
export const APP_PORT = Number(process.env.PORT ?? "4001");
export const DB_PATH =
  process.env.MAIL_DIGESTER_DB_PATH ??
  path.join(process.cwd(), "data", "mail-digester.sqlite");
export const USER_AGENT =
  "MailDigester/2.0 (+https://github.com/DimaPhil/mail-digester)";
