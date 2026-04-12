import type {
  InboxEmail,
  SnapshotRecord,
  SyncStateRecord,
} from "@/lib/db/repository";

export type InboxPayload = {
  emails: InboxEmail[];
  sync: SyncStateRecord;
  shouldAutoSync: boolean;
};

export type ArticlePanelPayload = {
  itemId: number;
  snapshot: SnapshotRecord | null;
  item: InboxEmail["items"][number];
};
