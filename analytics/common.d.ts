export type LoadedInteraction = {
  id: number;
  itemId: number;
  emailId: number;
  action: string;
  resolveMode: string | null;
  openedBeforeResolve: number | null;
  provider: string;
  providerMessageId: string;
  providerThreadId: string | null;
  sourceFamily: string;
  sourceVariant: string;
  senderName: string;
  senderEmail: string;
  emailSubject: string;
  emailReceivedAt: number;
  section: string;
  position: number;
  itemKind: string;
  readTimeText: string | null;
  title: string;
  fullDescription: string;
  trackedUrl: string;
  canonicalUrl: string | null;
  finalUrl: string | null;
  metadataJson: string | null;
  createdAt: number;
  snapshotStatus: string | null;
  snapshotSourceUrl: string | null;
  snapshotFinalUrl: string | null;
  snapshotTitle: string | null;
  snapshotByline: string | null;
  snapshotSiteName: string | null;
  snapshotExcerpt: string | null;
  snapshotContentText: string | null;
  snapshotErrorMessage: string | null;
  snapshotFetchedAt: number | null;
};

export function parseFlags(argv: string[]): Record<string, string | boolean>;
export function readStringFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: string,
): string;
export function readNumberFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: number,
): number;
export function defaultDbPath(): string;
export function loadInteractions(input: {
  dbPath: string;
  sinceDays?: number;
}): {
  interactions: LoadedInteraction[];
  warning: string | null;
};
export function writeOutput(input: {
  content: string;
  outputPath: string | null;
}): void;
