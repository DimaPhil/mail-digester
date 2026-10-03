import type { getInboxPayload } from "@/lib/inbox/service";
export type InboxPayload = Awaited<ReturnType<typeof getInboxPayload>>;
