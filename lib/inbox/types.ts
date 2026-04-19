import type {
  InboxEmail,
  SnapshotRecord,
  SyncStateRecord,
} from "@/lib/db/repository";
import type { InboxAppConfig } from "@/lib/inbox/service";

export type InboxPayload = {
  emails: InboxEmail[];
  sync: SyncStateRecord;
  shouldAutoSync: boolean;
  appConfig: InboxAppConfig;
};

export type ArticlePanelPayload = {
  itemId: number;
  snapshot: SnapshotRecord | null;
  item: InboxEmail["items"][number];
};
