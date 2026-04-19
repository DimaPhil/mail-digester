export type MailMessageRef = {
  id: string;
  threadId?: string;
};

export type ListMailOptions = {
  afterTs?: number | null;
};

export type MessageHeader = {
  name: string;
  value: string;
};

export type ProviderMessage = {
  id: string;
  threadId?: string;
  headers: MessageHeader[];
  senderName: string;
  senderEmail: string;
  subject: string;
  receivedAt: number;
  snippet: string;
  htmlBody: string;
  textBody: string;
  rawLabelIds: string[];
};

export interface MailProvider {
  listUnreadCandidates(options?: ListMailOptions): Promise<MailMessageRef[]>;
  getMessage(messageId: string): Promise<ProviderMessage>;
  markMessageRead(messageId: string): Promise<void>;
}
