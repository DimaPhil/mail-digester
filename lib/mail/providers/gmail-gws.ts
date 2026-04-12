import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GMAIL_TLDR_QUERY, GWS_BINARY } from "@/lib/config";
import { parseSender } from "@/lib/digest/tldr";
import type {
  MailMessageRef,
  MailProvider,
  ProviderMessage,
} from "@/lib/mail/types";

const execFileAsync = promisify(execFile);

type GmailListResponse = {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
};

type GmailMessagePart = {
  mimeType?: string;
  body?: {
    data?: string;
  };
  parts?: GmailMessagePart[];
  headers?: Array<{ name: string; value: string }>;
};

type GmailMessageResponse = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart & {
    headers?: Array<{ name: string; value: string }>;
  };
};

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function pickBody(
  parts: GmailMessagePart[] | undefined,
  mimeType: string,
): string {
  if (!parts?.length) {
    return "";
  }

  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    const nested = pickBody(part.parts, mimeType);
    if (nested) {
      return nested;
    }
  }

  return "";
}

async function runGws<T>(args: string[]) {
  const { stdout, stderr } = await execFileAsync(GWS_BINARY, args, {
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });

  const output = `${stdout}${stderr}`.replace(
    /^Using keyring backend:.*\n/gm,
    "",
  );
  return JSON.parse(output) as T;
}

export class GmailGwsProvider implements MailProvider {
  async listUnreadCandidates(): Promise<MailMessageRef[]> {
    const messages: MailMessageRef[] = [];
    let pageToken: string | undefined;

    do {
      const response = await runGws<GmailListResponse>([
        "gmail",
        "users",
        "messages",
        "list",
        "--params",
        JSON.stringify({
          userId: "me",
          q: GMAIL_TLDR_QUERY,
          maxResults: 100,
          pageToken,
        }),
      ]);

      messages.push(...(response.messages ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return messages;
  }

  async getMessage(messageId: string): Promise<ProviderMessage> {
    const response = await runGws<GmailMessageResponse>([
      "gmail",
      "users",
      "messages",
      "get",
      "--params",
      JSON.stringify({
        userId: "me",
        id: messageId,
        format: "full",
      }),
    ]);

    const headers = response.payload?.headers ?? [];
    const headerMap = new Map(
      headers.map((header) => [header.name.toLowerCase(), header.value]),
    );
    const sender = parseSender(headerMap.get("from") ?? "");
    const htmlBody = pickBody(response.payload?.parts, "text/html");
    const textBody = pickBody(response.payload?.parts, "text/plain");

    return {
      id: response.id,
      threadId: response.threadId,
      headers,
      senderName: sender.senderName,
      senderEmail: sender.senderEmail,
      subject: headerMap.get("subject") ?? "(No subject)",
      receivedAt: Number(response.internalDate ?? Date.now()),
      snippet: response.snippet ?? "",
      htmlBody,
      textBody,
      rawLabelIds: response.labelIds ?? [],
    };
  }

  async markMessageRead(messageId: string) {
    await runGws([
      "gmail",
      "users",
      "messages",
      "modify",
      "--params",
      JSON.stringify({
        userId: "me",
        id: messageId,
      }),
      "--json",
      JSON.stringify({
        removeLabelIds: ["UNREAD"],
      }),
    ]);
  }
}
