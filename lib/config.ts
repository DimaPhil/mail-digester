import path from "node:path";
export const APP_NAME = "Mail Digester";
export const DB_PATH =
  process.env.MAIL_DIGESTER_DB_PATH ??
  path.join(process.cwd(), "data", "mail-digester.sqlite");
