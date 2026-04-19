"use client";

import * as Checkbox from "@radix-ui/react-checkbox";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  MailCheck,
  RefreshCcw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { InboxPayload } from "@/lib/inbox/types";
import { cn, formatRelativeDate } from "@/lib/utils";

type UndoState = {
  itemId: number;
  title: string;
} | null;

type EmailItem = InboxPayload["emails"][number]["items"][number];
type EmailRecord = InboxPayload["emails"][number];
type GroupedSections = Array<[string, EmailItem[]]>;
type InterestFilter =
  | "all"
  | "interesting"
  | "not_interesting"
  | "unclassified";
type SortDirection = "asc" | "desc";
type ViewMode = "emails" | "flat";

const SUMMARY_PREVIEW_LIMIT = 260;

const serverDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

function groupSections<T extends { section: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const current = groups.get(item.section) ?? [];
    current.push(item);
    groups.set(item.section, current);
  }
  return [...groups.entries()];
}

function progressPercent(processed: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

function matchesInterestFilter(item: EmailItem, filter: InterestFilter) {
  return filter === "all" || item.interestStatus === filter;
}

function interestLabel(item: EmailItem) {
  if (item.interestNeedsRefresh) {
    return "Needs recheck";
  }

  switch (item.interestStatus) {
    case "interesting":
      return "Interesting";
    case "not_interesting":
      return "Not interesting";
    default:
      return "Unclassified";
  }
}

function interestTone(item: EmailItem): "accent" | "neutral" | "warning" {
  if (item.interestStatus === "interesting") {
    return "accent";
  }

  if (item.interestStatus === "not_interesting") {
    return "warning";
  }

  return "neutral";
}

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "Request failed";
    throw new Error(message);
  }

  return payload;
}

export function InboxClient({ initialData }: { initialData: InboxPayload }) {
  const [emails, setEmails] = useState(initialData.emails);
  const [sync, setSync] = useState(initialData.sync);
  const [appConfig, setAppConfig] = useState(initialData.appConfig);
  const [undoState, setUndoState] = useState<UndoState>(null);
  const [resolvingIds, setResolvingIds] = useState<number[]>([]);
  const optimisticResolvedIds = useRef<Set<number>>(new Set());
  const openedItemIds = useRef<Set<number>>(new Set());
  const trackedExpandedIds = useRef<Set<number>>(new Set());
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("emails");
  const [interestFilter, setInterestFilter] = useState<InterestFilter>("all");
  const [interestPromptDraft, setInterestPromptDraft] = useState(
    initialData.appConfig.interestPrompt,
  );
  const [keepRecentDays, setKeepRecentDays] = useState("7");
  const [configPending, setConfigPending] = useState(false);
  const [bulkResolvePending, setBulkResolvePending] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [forceFullResync, setForceFullResync] = useState(false);
  const [refreshPending, startRefreshTransition] = useTransition();
  const autoSyncTriggered = useRef(false);
  const pollTimer = useRef<number | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);

  const visibleEmails = useMemo(
    () =>
      [...emails].sort((a, b) =>
        sortDirection === "asc"
          ? a.receivedAt - b.receivedAt
          : b.receivedAt - a.receivedAt,
      ),
    [emails, sortDirection],
  );

  const activeEmails = useMemo(
    () =>
      visibleEmails.filter(
        (email) =>
          email.completionState !== "complete" || email.gmailSyncPending,
      ),
    [visibleEmails],
  );

  const completedEmails = useMemo(
    () =>
      visibleEmails.filter(
        (email) =>
          email.completionState === "complete" && !email.gmailSyncPending,
      ),
    [visibleEmails],
  );

  const totalUnreadItems = useMemo(
    () =>
      visibleEmails.reduce((sum, email) => {
        const unresolvedCount = email.items.filter(
          (item) => item.resolvedAt == null,
        ).length;
        return sum + unresolvedCount;
      }, 0),
    [visibleEmails],
  );

  const filteredUnresolvedCount = useMemo(
    () =>
      activeEmails.reduce(
        (sum, email) =>
          sum +
          email.items.filter(
            (item) =>
              item.resolvedAt == null &&
              matchesInterestFilter(item, interestFilter),
          ).length,
        0,
      ),
    [activeEmails, interestFilter],
  );

  const flatItems = useMemo(
    () =>
      activeEmails
        .flatMap((email) =>
          email.items
            .filter(
              (item) =>
                item.resolvedAt == null &&
                matchesInterestFilter(item, interestFilter),
            )
            .map((item) => ({
              email,
              item,
            })),
        )
        .sort((a, b) => {
          const dateDelta =
            sortDirection === "asc"
              ? a.email.receivedAt - b.email.receivedAt
              : b.email.receivedAt - a.email.receivedAt;
          return dateDelta || a.item.position - b.item.position;
        }),
    [activeEmails, interestFilter, sortDirection],
  );

  const selectedEmail =
    visibleEmails.find((email) => email.id === selectedEmailId) ??
    visibleEmails[0] ??
    null;

  const selectedEmailSections = useMemo<{
    unresolved: GroupedSections;
    resolved: GroupedSections;
  }>(() => {
    if (!selectedEmail) {
      return {
        unresolved: [],
        resolved: [],
      };
    }

    const unresolved = selectedEmail.items.filter(
      (item) =>
        item.resolvedAt == null && matchesInterestFilter(item, interestFilter),
    );
    const resolved = selectedEmail.items.filter(
      (item) =>
        item.resolvedAt != null && matchesInterestFilter(item, interestFilter),
    );

    return {
      unresolved: groupSections(unresolved) as GroupedSections,
      resolved: groupSections(resolved) as GroupedSections,
    };
  }, [interestFilter, selectedEmail]);

  const applyOptimisticResolutions = useCallback(
    (nextEmails: InboxPayload["emails"]) => {
      if (optimisticResolvedIds.current.size === 0) {
        return nextEmails;
      }

      const timestamp = Date.now();
      return nextEmails.map((email) => {
        let changed = false;
        const nextItems = email.items.map((item) => {
          if (!optimisticResolvedIds.current.has(item.id)) {
            return item;
          }

          if (item.resolvedAt != null) {
            return item;
          }

          changed = true;
          return {
            ...item,
            resolvedAt: timestamp,
          };
        });

        if (!changed) {
          return email;
        }

        const resolvedItems = nextItems.filter(
          (item) => item.resolvedAt != null,
        ).length;

        return {
          ...email,
          completionState:
            resolvedItems >= email.totalItems ? "complete" : "active",
          resolvedItems,
          items: nextItems,
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (optimisticResolvedIds.current.size === 0) {
      return;
    }

    const nextOptimisticResolvedIds = new Set(optimisticResolvedIds.current);
    for (const email of emails) {
      for (const item of email.items) {
        if (item.resolvedAt != null && nextOptimisticResolvedIds.has(item.id)) {
          nextOptimisticResolvedIds.delete(item.id);
        }
      }
    }
    optimisticResolvedIds.current = nextOptimisticResolvedIds;
  }, [emails]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!selectedEmail && visibleEmails[0]) {
      setSelectedEmailId(visibleEmails[0].id);
      return;
    }

    if (
      selectedEmailId != null &&
      !visibleEmails.some((email) => email.id === selectedEmailId)
    ) {
      setSelectedEmailId(visibleEmails[0]?.id ?? null);
    }
  }, [selectedEmail, selectedEmailId, visibleEmails]);

  useEffect(() => {
    if (!mobileDetailOpen || !selectedEmail) {
      return;
    }

    const unresolvedCount = selectedEmail.items.filter(
      (item) => item.resolvedAt == null,
    ).length;

    if (unresolvedCount > 0) {
      return;
    }

    setMobileDetailOpen(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }, [mobileDetailOpen, selectedEmail]);

  const syncInboxData = useCallback(async () => {
    const payload = await readJson<InboxPayload>("/api/inbox");
    setEmails(applyOptimisticResolutions(payload.emails));
    setSync(payload.sync);
    setAppConfig(payload.appConfig);
    return payload;
  }, [applyOptimisticResolutions]);

  useEffect(() => {
    setInterestPromptDraft(appConfig.interestPrompt);
  }, [appConfig.interestPrompt]);

  function stopPolling() {
    if (pollTimer.current != null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function startPolling() {
    if (pollTimer.current != null) {
      return;
    }

    pollTimer.current = window.setInterval(async () => {
      const payload = await syncInboxData();
      if (!payload.sync.active) {
        stopPolling();
      }
    }, 900);
  }

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  async function triggerSync(
    reason: "startup" | "manual",
    options: { forceFullResync?: boolean } = {},
  ) {
    if (reason === "startup" && autoSyncTriggered.current) {
      return;
    }

    autoSyncTriggered.current = true;
    const forceResync = options.forceFullResync === true;
    setSync((current) => ({
      ...current,
      active: true,
      status: "running",
      phase: "listing",
      message:
        reason === "startup"
          ? "Starting inbox sync for unread TLDR newsletters…"
          : forceResync
            ? "Refreshing all unread TLDR newsletters from scratch…"
            : "Refreshing unread TLDR newsletters since the last sync…",
    }));

    startPolling();

    try {
      const payload = await readJson<InboxPayload>("/api/sync", {
        body: JSON.stringify({
          forceFullResync: forceResync,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      startTransition(() => {
        setEmails(applyOptimisticResolutions(payload.emails));
        setSync(payload.sync);
        setAppConfig(payload.appConfig);
      });
    } finally {
      stopPolling();
      await syncInboxData();
    }
  }

  useEffect(() => {
    if (initialData.shouldAutoSync && !autoSyncTriggered.current) {
      autoSyncTriggered.current = true;
      setSync((current) => ({
        ...current,
        active: true,
        status: "running",
        phase: "listing",
        message: "Starting inbox sync for unread TLDR newsletters…",
      }));

      if (pollTimer.current == null) {
        pollTimer.current = window.setInterval(async () => {
          const payload = await syncInboxData();
          if (!payload.sync.active) {
            stopPolling();
          }
        }, 900);
      }

      void (async () => {
        try {
          const payload = await readJson<InboxPayload>("/api/sync", {
            body: JSON.stringify({
              forceFullResync: false,
            }),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
          });
          startTransition(() => {
            setEmails(applyOptimisticResolutions(payload.emails));
            setSync(payload.sync);
            setAppConfig(payload.appConfig);
          });
        } finally {
          stopPolling();
          await syncInboxData();
        }
      })();
    }
  }, [applyOptimisticResolutions, initialData.shouldAutoSync, syncInboxData]);

  function formatEmailDate(timestamp: number) {
    if (!hydrated) {
      return serverDateFormatter.format(timestamp);
    }

    return new Date(timestamp).toLocaleString();
  }

  function formatLastSync(timestamp: number) {
    if (!hydrated) {
      return `Last sync ${serverDateFormatter.format(timestamp)}`;
    }

    return `Last sync ${formatRelativeDate(timestamp)}`;
  }

  function getInteractionMetadata(
    extra: Record<string, boolean | number | string | null> = {},
  ) {
    const layout =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
        ? "mobile"
        : "desktop";

    return {
      layout,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : null,
      viewportHeight: typeof window !== "undefined" ? window.innerHeight : null,
      timezone:
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : null,
      clientTimestamp: Date.now(),
      ...extra,
    };
  }

  function sendInteraction(
    itemId: number,
    action: "description-expand" | "link-open",
    metadata: Record<string, boolean | number | string | null> = {},
  ) {
    const body = JSON.stringify({
      metadata: getInteractionMetadata(metadata),
    });
    const url = `/api/items/${itemId}/${action}`;

    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        url,
        new Blob([body], {
          type: "application/json",
        }),
      );
      return;
    }

    void fetch(url, {
      body,
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      method: "POST",
    });
  }

  function trackLinkOpen(itemId: number, href: string) {
    openedItemIds.current.add(itemId);
    sendInteraction(itemId, "link-open", {
      href,
    });
  }

  function trackDescriptionExpand(itemId: number, summaryLength: number) {
    if (trackedExpandedIds.current.has(itemId)) {
      return;
    }

    trackedExpandedIds.current.add(itemId);
    sendInteraction(itemId, "description-expand", {
      previewLength: SUMMARY_PREVIEW_LIMIT,
      summaryLength,
    });
  }

  function applyLocalResolution(
    currentEmails: InboxPayload["emails"],
    itemId: number,
    resolvedAt: number,
  ) {
    return currentEmails.map((email) => {
      let changed = false;
      const nextItems = email.items.map((entry) => {
        if (entry.id !== itemId || entry.resolvedAt != null) {
          return entry;
        }

        changed = true;
        return {
          ...entry,
          resolvedAt,
        };
      });

      if (!changed) {
        return email;
      }

      const resolvedItems = nextItems.filter(
        (entry) => entry.resolvedAt != null,
      ).length;

      return {
        ...email,
        completionState:
          resolvedItems >= email.totalItems ? "complete" : "active",
        resolvedItems,
        items: nextItems,
      };
    });
  }

  async function resolveItem(itemId: number) {
    const item = emails
      .flatMap((email) => email.items)
      .find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    if (optimisticResolvedIds.current.has(itemId)) {
      return;
    }

    optimisticResolvedIds.current.add(itemId);
    setResolvingIds((current) =>
      current.includes(itemId) ? current : [...current, itemId],
    );
    setUndoState({
      itemId,
      title: item.title,
    });

    const previous = emails;
    setEmails((current) => applyLocalResolution(current, itemId, Date.now()));

    try {
      const payload = await readJson<{ emails: InboxPayload["emails"] }>(
        `/api/items/${itemId}/resolve`,
        {
          body: JSON.stringify({
            metadata: getInteractionMetadata({
              clientOpenedBeforeResolve: openedItemIds.current.has(itemId),
            }),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      setEmails(applyOptimisticResolutions(payload.emails));
    } catch {
      optimisticResolvedIds.current.delete(itemId);
      setEmails(previous);
      setUndoState(null);
    } finally {
      setResolvingIds((current) => current.filter((entry) => entry !== itemId));
      void syncInboxData();
    }
  }

  async function undoResolve() {
    if (!undoState) {
      return;
    }

    const payload = await readJson<{ emails: InboxPayload["emails"] }>(
      `/api/items/${undoState.itemId}/unresolve`,
      {
        method: "POST",
      },
    );
    optimisticResolvedIds.current.delete(undoState.itemId);
    setEmails(applyOptimisticResolutions(payload.emails));
    setUndoState(null);
    await syncInboxData();
  }

  async function saveInterestPrompt() {
    setConfigPending(true);
    setFeedbackMessage(null);

    try {
      const payload = await readJson<InboxPayload>("/api/config", {
        body: JSON.stringify({
          interestPrompt: interestPromptDraft,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      setEmails(applyOptimisticResolutions(payload.emails));
      setSync(payload.sync);
      setAppConfig(payload.appConfig);
      setFeedbackMessage("Interest prompt saved.");
    } catch (error) {
      setFeedbackMessage(
        error instanceof Error ? error.message : "Failed to save prompt.",
      );
    } finally {
      setConfigPending(false);
    }
  }

  async function bulkResolveNotInteresting() {
    const parsedDays = Number(keepRecentDays);
    if (!Number.isFinite(parsedDays) || parsedDays < 0) {
      setFeedbackMessage("Keep recent days must be a non-negative number.");
      return;
    }

    setBulkResolvePending(true);
    setFeedbackMessage(null);

    try {
      const payload = await readJson<{
        emails: InboxPayload["emails"];
        resolvedCount: number;
      }>("/api/items/resolve-not-interesting", {
        body: JSON.stringify({
          keepRecentDays: Math.floor(parsedDays),
          metadata: getInteractionMetadata(),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      setEmails(applyOptimisticResolutions(payload.emails));
      setFeedbackMessage(
        payload.resolvedCount === 0
          ? "No not-interesting links matched the selected age cutoff."
          : `Resolved ${payload.resolvedCount} not-interesting link${payload.resolvedCount === 1 ? "" : "s"}.`,
      );
      await syncInboxData();
    } catch (error) {
      setFeedbackMessage(
        error instanceof Error
          ? error.message
          : "Failed to resolve not-interesting links.",
      );
    } finally {
      setBulkResolvePending(false);
    }
  }

  function selectEmail(emailId: number) {
    setSelectedEmailId(emailId);

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      setMobileDetailOpen(true);
      window.requestAnimationFrame(() => {
        detailPanelRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });
    }
  }

  function toggleSummary(itemId: number, summaryLength: number) {
    let expanded = false;
    setExpandedSummaryIds((current) => {
      const next = new Set(current);

      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
        expanded = true;
      }

      return next;
    });

    if (expanded) {
      trackDescriptionExpand(itemId, summaryLength);
    }
  }

  function renderSortControls() {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Date order
        </span>
        <button
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition",
            sortDirection === "asc"
              ? "border-[var(--accent)] bg-white text-[var(--accent-strong)]"
              : "border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--accent)]",
          )}
          onClick={() => setSortDirection("asc")}
          type="button"
        >
          Oldest first
        </button>
        <button
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition",
            sortDirection === "desc"
              ? "border-[var(--accent)] bg-white text-[var(--accent-strong)]"
              : "border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--accent)]",
          )}
          onClick={() => setSortDirection("desc")}
          type="button"
        >
          Newest first
        </button>
      </div>
    );
  }

  function renderViewControls() {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          View
        </span>
        <button
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition",
            viewMode === "emails"
              ? "border-[var(--accent)] bg-white text-[var(--accent-strong)]"
              : "border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--accent)]",
          )}
          onClick={() => setViewMode("emails")}
          type="button"
        >
          Email view
        </button>
        <button
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition",
            viewMode === "flat"
              ? "border-[var(--accent)] bg-white text-[var(--accent-strong)]"
              : "border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--accent)]",
          )}
          onClick={() => setViewMode("flat")}
          type="button"
        >
          Flat links
        </button>
      </div>
    );
  }

  function renderInterestControls() {
    const options: Array<{
      label: string;
      value: InterestFilter;
    }> = [
      { label: "All links", value: "all" },
      { label: "Interesting", value: "interesting" },
      { label: "Not interesting", value: "not_interesting" },
      { label: "Unclassified", value: "unclassified" },
    ];

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Interest
        </span>
        {options.map((option) => (
          <button
            key={option.value}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition",
              interestFilter === option.value
                ? "border-[var(--accent)] bg-white text-[var(--accent-strong)]"
                : "border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--accent)]",
            )}
            onClick={() => setInterestFilter(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  function renderFlatItemCard(email: EmailRecord, item: EmailItem) {
    const isResolving = resolvingIds.includes(item.id);
    const href = item.finalUrl ?? item.canonicalUrl ?? item.trackedUrl;
    const summaryExpanded = expandedSummaryIds.has(item.id);
    const hasLongSummary = item.summary.length > SUMMARY_PREVIEW_LIMIT;
    const visibleSummary =
      hasLongSummary && !summaryExpanded
        ? `${item.summary.slice(0, SUMMARY_PREVIEW_LIMIT).trimEnd()}…`
        : item.summary;

    return (
      <article
        key={item.id}
        className="rounded-[22px] border border-white/80 bg-white/82 p-4 shadow-[0_18px_50px_rgba(79,53,20,0.08)] sm:p-5"
      >
        <div className="flex gap-3">
          <Checkbox.Root
            checked={false}
            className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-strong)] transition hover:border-[var(--accent)]"
            disabled={isResolving}
            onClick={() => void resolveItem(item.id)}
          >
            <span className="sr-only">Resolve {item.title}</span>
            <Checkbox.Indicator>
              <Check className="h-4 w-4 text-[var(--accent)]" />
            </Checkbox.Indicator>
          </Checkbox.Root>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={email.sourceVariant} tone="accent" />
              <StatusChip label={item.section} tone="neutral" />
              <StatusChip
                label={formatEmailDate(email.receivedAt)}
                tone="neutral"
              />
            </div>

            <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              From {email.subject}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                className="text-base font-semibold leading-snug transition hover:text-[var(--accent-strong)] hover:underline sm:text-lg"
                href={href}
                onClick={() => trackLinkOpen(item.id, href)}
                rel="noreferrer noopener"
                target="_blank"
              >
                {item.title}
              </a>
              <StatusChip
                label={item.itemKind}
                tone={item.itemKind === "sponsor" ? "warning" : "neutral"}
              />
              <StatusChip
                label={interestLabel(item)}
                tone={interestTone(item)}
              />
              {item.readTimeText ? (
                <StatusChip label={item.readTimeText} tone="neutral" />
              ) : null}
            </div>

            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Email description
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                {visibleSummary}
              </p>
              {item.interestReason ? (
                <p className="mt-3 text-sm leading-6 text-[var(--text)]">
                  Why: {item.interestReason}
                </p>
              ) : null}
              {hasLongSummary ? (
                <button
                  className="mt-3 inline-flex rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)] transition hover:border-[var(--accent)]"
                  onClick={() => toggleSummary(item.id, item.summary.length)}
                  type="button"
                >
                  {summaryExpanded ? "Show less" : "Show full description"}
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
              <a
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1.5 font-medium transition hover:border-[var(--accent)]"
                href={href}
                onClick={() => trackLinkOpen(item.id, href)}
                rel="noreferrer noopener"
                target="_blank"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open link
              </a>
              {isResolving ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[var(--accent-strong)]">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Marking complete…
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    );
  }

  function renderFlatView() {
    return (
      <div className="rounded-[30px] border border-[var(--border)] bg-[var(--panel)] backdrop-blur">
        <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Flat links
              </div>
              <div className="text-sm text-[var(--muted)]">
                One continuous queue of unresolved links, sorted by email date
                without making you enter each issue first.
              </div>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm">
              {flatItems.length}
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3">
              {renderSortControls()}
              {renderInterestControls()}
            </div>
            {renderViewControls()}
          </div>
        </div>

        <div className="space-y-4 p-4 md:p-5">
          {flatItems.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-white/65 p-8 text-center">
              <MailCheck className="mx-auto h-10 w-10 text-[var(--accent)]" />
              <h2 className="mt-4 font-[var(--font-source-serif)] text-2xl">
                {sync.active
                  ? "Building your flat queue…"
                  : "Flat queue cleared"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                {sync.active
                  ? "Unread TLDR issues are still being parsed. New links will appear here as soon as they land."
                  : "All tracked links are resolved. Switch back to email view if you want to review completed issues."}
              </p>
            </div>
          ) : null}

          {flatItems.map(({ email, item }) => renderFlatItemCard(email, item))}
        </div>
      </div>
    );
  }

  function renderEmailDetail() {
    const selectedEmailTotalUnresolved =
      selectedEmail?.items.filter((item) => item.resolvedAt == null).length ??
      0;
    const filteredSelectedItemCount =
      selectedEmailSections.unresolved.length +
      selectedEmailSections.resolved.length;

    return (
      <>
        <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5 md:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Email detail
              </div>
              <div className="text-sm text-[var(--muted)]">
                Links open in a new tab. Resolve actions stay local and update
                Gmail when an email is fully done.
              </div>
            </div>
            <button
              className="inline-flex w-fit items-center justify-center rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-sm lg:hidden"
              onClick={() => setMobileDetailOpen(false)}
              type="button"
            >
              Back to emails
            </button>
          </div>
        </div>

        <div className="p-3 sm:p-4 md:p-6">
          {!selectedEmail ? (
            <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-white/65 p-6 text-center sm:p-8">
              <Sparkles className="mx-auto h-10 w-10 text-[var(--accent)]" />
              <h2 className="mt-4 font-[var(--font-source-serif)] text-2xl">
                Select an email
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                Choose an email from the left to inspect the links, summaries,
                and progress for that issue.
              </p>
            </div>
          ) : (
            <div className="space-y-5 md:space-y-6">
              <header className="rounded-[24px] border border-white/80 bg-white/80 p-4 shadow-[0_18px_50px_rgba(79,53,20,0.08)] sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip
                        label={selectedEmail.sourceVariant}
                        tone="accent"
                      />
                      <StatusChip
                        label={`${selectedEmail.totalItems} link${selectedEmail.totalItems === 1 ? "" : "s"}`}
                        tone="neutral"
                      />
                    </div>
                    <h2 className="font-[var(--font-source-serif)] text-2xl leading-tight sm:text-3xl">
                      {selectedEmail.subject}
                    </h2>
                    <div className="break-words text-sm text-[var(--muted)]">
                      {selectedEmail.senderName} · {selectedEmail.senderEmail}
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Received {formatEmailDate(selectedEmail.receivedAt)}
                    </div>
                  </div>

                  <div className="w-full rounded-[20px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 sm:w-auto sm:min-w-44">
                    <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      Completion
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {selectedEmail.resolvedItems}/{selectedEmail.totalItems}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{
                          width: `${progressPercent(
                            selectedEmail.resolvedItems,
                            selectedEmail.totalItems,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </header>

              {selectedEmailSections.unresolved.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-white/65 p-6 text-center sm:p-8">
                  <MailCheck className="mx-auto h-10 w-10 text-[var(--accent)]" />
                  <h3 className="mt-4 font-[var(--font-source-serif)] text-2xl">
                    {selectedEmailTotalUnresolved === 0
                      ? "This email is fully resolved"
                      : filteredSelectedItemCount === 0
                        ? "No links match the current interest filter"
                        : "This filter has no unresolved links"}
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                    {selectedEmailTotalUnresolved === 0
                      ? `Gmail read-state sync ${
                          selectedEmail.gmailSyncPending
                            ? "is pending retry"
                            : "has been handled"
                        }.`
                      : "Adjust the interest filter or switch to the flat link view to inspect a broader queue."}
                  </p>
                </div>
              ) : null}

              {selectedEmailSections.unresolved.map(
                ([section, sectionItems]) => (
                  <section key={`unresolved-${section}`} className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      {section}
                    </div>
                    <div className="space-y-3">
                      {sectionItems.map((item) => {
                        const isResolving = resolvingIds.includes(item.id);
                        const href =
                          item.finalUrl ?? item.canonicalUrl ?? item.trackedUrl;
                        const summaryExpanded = expandedSummaryIds.has(item.id);
                        const hasLongSummary =
                          item.summary.length > SUMMARY_PREVIEW_LIMIT;
                        const visibleSummary =
                          hasLongSummary && !summaryExpanded
                            ? `${item.summary.slice(0, SUMMARY_PREVIEW_LIMIT).trimEnd()}…`
                            : item.summary;

                        return (
                          <article
                            key={item.id}
                            className="rounded-[22px] border border-white/80 bg-white/82 p-4 shadow-[0_18px_50px_rgba(79,53,20,0.08)] sm:p-5"
                          >
                            <div className="flex gap-3">
                              <Checkbox.Root
                                checked={false}
                                className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-strong)] transition hover:border-[var(--accent)]"
                                disabled={isResolving}
                                onClick={() => void resolveItem(item.id)}
                              >
                                <span className="sr-only">
                                  Resolve {item.title}
                                </span>
                                <Checkbox.Indicator>
                                  <Check className="h-4 w-4 text-[var(--accent)]" />
                                </Checkbox.Indicator>
                              </Checkbox.Root>

                              <div className="min-w-0 flex-1 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <a
                                    className="text-base font-semibold leading-snug transition hover:text-[var(--accent-strong)] hover:underline sm:text-lg"
                                    href={href}
                                    onClick={() => trackLinkOpen(item.id, href)}
                                    rel="noreferrer noopener"
                                    target="_blank"
                                  >
                                    {item.title}
                                  </a>
                                  <StatusChip
                                    label={item.itemKind}
                                    tone={
                                      item.itemKind === "sponsor"
                                        ? "warning"
                                        : "neutral"
                                    }
                                  />
                                  <StatusChip
                                    label={interestLabel(item)}
                                    tone={interestTone(item)}
                                  />
                                  {item.readTimeText ? (
                                    <StatusChip
                                      label={item.readTimeText}
                                      tone="neutral"
                                    />
                                  ) : null}
                                </div>

                                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                                    Email description
                                  </div>
                                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                                    {visibleSummary}
                                  </p>
                                  {item.interestReason ? (
                                    <p className="mt-3 text-sm leading-6 text-[var(--text)]">
                                      Why: {item.interestReason}
                                    </p>
                                  ) : null}
                                  {hasLongSummary ? (
                                    <button
                                      className="mt-3 inline-flex rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)] transition hover:border-[var(--accent)]"
                                      onClick={() =>
                                        toggleSummary(
                                          item.id,
                                          item.summary.length,
                                        )
                                      }
                                      type="button"
                                    >
                                      {summaryExpanded
                                        ? "Show less"
                                        : "Show full description"}
                                    </button>
                                  ) : null}
                                </div>

                                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                  <a
                                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1.5 font-medium transition hover:border-[var(--accent)]"
                                    href={href}
                                    onClick={() => trackLinkOpen(item.id, href)}
                                    rel="noreferrer noopener"
                                    target="_blank"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open link
                                  </a>
                                  {isResolving ? (
                                    <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[var(--accent-strong)]">
                                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                      Marking complete…
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ),
              )}

              {selectedEmailSections.resolved.length > 0 ? (
                <section className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    Already resolved
                  </div>
                  <div className="space-y-2">
                    {selectedEmailSections.resolved.flatMap(
                      ([section, sectionItems]) =>
                        sectionItems.map((item) => (
                          <div
                            key={`resolved-${item.id}`}
                            className="rounded-[18px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm text-[var(--muted)]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="font-medium text-[var(--text)]">
                                  {item.title}
                                </div>
                                <div className="text-xs uppercase tracking-[0.14em]">
                                  {section}
                                </div>
                              </div>
                              <StatusChip label="Resolved" tone="neutral" />
                            </div>
                          </div>
                        )),
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </>
    );
  }

  function renderEmailCard(email: (typeof visibleEmails)[number]) {
    const unresolvedCount = email.items.filter(
      (item) => item.resolvedAt == null,
    ).length;
    const resolvedCount = email.totalItems - unresolvedCount;
    const selected = email.id === selectedEmail?.id;

    return (
      <button
        key={email.id}
        className={cn(
          "block w-full rounded-[24px] border p-4 text-left shadow-[0_18px_50px_rgba(79,53,20,0.08)] transition sm:rounded-[26px] sm:p-5",
          selected
            ? "border-[var(--accent)] bg-white"
            : "border-white/80 bg-white/78 hover:border-[var(--accent)]",
        )}
        onClick={() => selectEmail(email.id)}
        type="button"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={email.sourceVariant} tone="accent" />
              {email.completionState === "complete" &&
              !email.gmailSyncPending ? (
                <StatusChip label="Resolved" tone="neutral" />
              ) : null}
              {email.gmailSyncPending ? (
                <StatusChip label="Gmail retry pending" tone="warning" />
              ) : null}
            </div>
            <h2 className="max-w-xl font-[var(--font-source-serif)] text-xl leading-tight sm:text-2xl">
              {email.subject}
            </h2>
            <div className="text-sm text-[var(--muted)]">
              {email.senderName} · {formatEmailDate(email.receivedAt)}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
              {email.snippet}
            </p>
          </div>

          <div className="w-full rounded-[20px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left sm:w-auto sm:min-w-40 sm:text-right">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
              Progress
            </div>
            <div className="mt-1 text-lg font-semibold">
              {resolvedCount}/{email.totalItems}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{
                  width: `${progressPercent(resolvedCount, email.totalItems)}%`,
                }}
              />
            </div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              {unresolvedCount === 0
                ? "Fully resolved"
                : `${unresolvedCount} unresolved`}
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <main className="min-h-screen px-3 py-3 sm:px-4 sm:py-5 md:px-8 md:py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 md:gap-6">
        <section className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--panel)] shadow-[0_35px_100px_rgba(79,53,20,0.12)] backdrop-blur sm:rounded-[32px]">
          <div className="grid gap-5 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-sm text-[var(--muted)]">
                <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                TLDR inbox review
              </div>
              <div className="space-y-2">
                <h1 className="max-w-3xl font-[var(--font-source-serif)] text-3xl leading-tight sm:text-4xl md:text-5xl">
                  Scan emails first. Dive into one issue only when you choose.
                </h1>
                <p className="max-w-3xl text-[15px] leading-7 text-[var(--muted)] md:text-base">
                  The left side is now your issue list. Pick an email to inspect
                  its links, summaries, and progress in the right pane. Article
                  links open directly in a new tab, while resolve actions stay
                  here.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <StatusChip
                  label={`${activeEmails.length} active email${activeEmails.length === 1 ? "" : "s"}`}
                  tone="neutral"
                />
                <StatusChip
                  label={`${completedEmails.length} completed email${completedEmails.length === 1 ? "" : "s"}`}
                  tone="neutral"
                />
                <StatusChip
                  label={`${totalUnreadItems} unresolved item${totalUnreadItems === 1 ? "" : "s"}`}
                  tone="accent"
                />
                <StatusChip
                  label={`${filteredUnresolvedCount} visible under filter`}
                  tone="neutral"
                />
                <StatusChip
                  label={
                    sync.lastFinishedAt
                      ? formatLastSync(sync.lastFinishedAt)
                      : "No sync yet"
                  }
                  tone="neutral"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-col gap-3">
                  {renderSortControls()}
                  {renderInterestControls()}
                </div>
                {renderViewControls()}
              </div>
            </div>
            <div className="flex items-start justify-start md:justify-end">
              <div className="flex w-full max-w-md flex-col items-start gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
                  <Checkbox.Root
                    checked={forceFullResync}
                    className="inline-flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] bg-white transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={refreshPending || sync.active}
                    onCheckedChange={(checked) =>
                      setForceFullResync(checked === true)
                    }
                  >
                    <Checkbox.Indicator>
                      <Check className="h-3.5 w-3.5 text-[var(--accent)]" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  Force full resync
                </label>
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-3 text-sm font-medium shadow-[0_12px_30px_rgba(32,23,13,0.08)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={refreshPending || sync.active}
                  onClick={() => {
                    startRefreshTransition(() => {
                      void triggerSync("manual", {
                        forceFullResync,
                      });
                    });
                  }}
                  type="button"
                >
                  {refreshPending || sync.active ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  {sync.active
                    ? "Syncing inbox…"
                    : forceFullResync
                      ? "Resync all unread mail"
                      : "Sync new unread mail"}
                </button>
                <div className="w-full rounded-[24px] border border-[var(--border)] bg-white/80 p-4 shadow-[0_12px_30px_rgba(32,23,13,0.08)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={appConfig.openAiModel} tone="accent" />
                    <StatusChip
                      label={
                        appConfig.openAiApiKeyConfigured
                          ? "OpenAI key ready"
                          : "OpenAI key missing"
                      }
                      tone={
                        appConfig.openAiApiKeyConfigured ? "neutral" : "warning"
                      }
                    />
                    {appConfig.interestRefreshPendingCount > 0 ? (
                      <StatusChip
                        label={`${appConfig.interestRefreshPendingCount} link${appConfig.interestRefreshPendingCount === 1 ? "" : "s"} need recheck`}
                        tone="warning"
                      />
                    ) : null}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-[var(--text)]">
                    Interest prompt
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    The prompt is applied to each individual link during sync
                    and decides whether it is interesting or not.
                  </p>
                  <textarea
                    className="mt-3 min-h-32 w-full rounded-[18px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm leading-6 text-[var(--text)] outline-none transition focus:border-[var(--accent)]"
                    disabled={configPending}
                    onChange={(event) =>
                      setInterestPromptDraft(event.target.value)
                    }
                    placeholder="Describe what kinds of links are interesting to you."
                    value={interestPromptDraft}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={configPending}
                      onClick={() => void saveInterestPrompt()}
                      type="button"
                    >
                      {configPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : null}
                      Save prompt
                    </button>
                    {appConfig.interestRefreshPendingCount > 0 ? (
                      <span className="text-xs text-[var(--muted)]">
                        Run a full resync to reclassify stored links with the
                        latest prompt.
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      Bulk resolve not-interesting links
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                      Leave the most recent N days unresolved, and resolve older
                      links classified as not interesting.
                    </p>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        className="w-full rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-2 text-sm outline-none transition focus:border-[var(--accent)] sm:max-w-32"
                        disabled={bulkResolvePending}
                        inputMode="numeric"
                        min="0"
                        onChange={(event) =>
                          setKeepRecentDays(event.target.value)
                        }
                        type="number"
                        value={keepRecentDays}
                      />
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={
                          bulkResolvePending ||
                          !appConfig.interestPrompt.trim() ||
                          !appConfig.openAiApiKeyConfigured
                        }
                        onClick={() => void bulkResolveNotInteresting()}
                        type="button"
                      >
                        {bulkResolvePending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : null}
                        Resolve older not-interesting links
                      </button>
                    </div>
                  </div>
                  {feedbackMessage ? (
                    <div className="mt-3 text-sm text-[var(--muted)]">
                      {feedbackMessage}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--border)] bg-white/55 px-4 py-4 sm:px-6 md:px-8">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {sync.active
                      ? "Sync in progress"
                      : sync.status === "error"
                        ? "Sync needs attention"
                        : "Inbox status"}
                  </div>
                  <div className="text-sm text-[var(--muted)]">
                    {sync.message}
                  </div>
                </div>
                <div className="rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  {sync.phase}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                <div
                  className={cn(
                    "h-full rounded-full bg-[var(--accent)] transition-[width] duration-500",
                    sync.active &&
                      sync.discoveredEmails === 0 &&
                      "animate-pulse",
                  )}
                  style={{
                    width: `${progressPercent(sync.processedEmails, sync.discoveredEmails)}%`,
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                <span>
                  {sync.phase === "classifying"
                    ? "Links classified"
                    : "Emails processed"}
                  : {sync.processedEmails}/{sync.discoveredEmails || "?"}
                </span>
                {sync.lastError ? <span>Error: {sync.lastError}</span> : null}
              </div>
            </div>
          </div>
        </section>

        <section
          className={cn(
            "grid items-start gap-6",
            viewMode === "emails" &&
              "lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]",
          )}
        >
          {viewMode === "emails" ? (
            <>
              <div
                className={cn(
                  "rounded-[30px] border border-[var(--border)] bg-[var(--panel)] backdrop-blur",
                  mobileDetailOpen && "hidden lg:block",
                )}
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 md:px-6">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                      Emails
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Active emails stay at the top. Completed emails move to
                      the bottom.
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm">
                    {visibleEmails.length}
                  </div>
                </div>

                <div className="space-y-4 p-4 md:p-5">
                  {visibleEmails.length === 0 ? (
                    <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-white/65 p-8 text-center">
                      <MailCheck className="mx-auto h-10 w-10 text-[var(--accent)]" />
                      <h2 className="mt-4 font-[var(--font-source-serif)] text-2xl">
                        {sync.active
                          ? "Fetching unread newsletters…"
                          : "Inbox cleared"}
                      </h2>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                        {sync.active
                          ? "The app is pulling unread TLDR issues and will populate this view as soon as parsing completes."
                          : "All tracked TLDR items are resolved. Refresh to pick up new unread issues."}
                      </p>
                    </div>
                  ) : null}

                  {activeEmails.length > 0 ? (
                    <section className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          Active queue
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {activeEmails.length} email
                          {activeEmails.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      {activeEmails.map(renderEmailCard)}
                    </section>
                  ) : visibleEmails.length > 0 ? (
                    <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-white/65 p-6 text-center">
                      <MailCheck className="mx-auto h-8 w-8 text-[var(--accent)]" />
                      <h2 className="mt-3 font-[var(--font-source-serif)] text-xl">
                        Active queue cleared
                      </h2>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                        Every parsed email is resolved. Completed issues stay
                        below for reference.
                      </p>
                    </div>
                  ) : null}

                  {completedEmails.length > 0 ? (
                    <section className="space-y-4 border-t border-[var(--border)] pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          Completed emails
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {completedEmails.length} email
                          {completedEmails.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      {completedEmails.map(renderEmailCard)}
                    </section>
                  ) : null}
                </div>
              </div>

              <div
                ref={detailPanelRef}
                className={cn(
                  "rounded-[30px] border border-[var(--border)] bg-[var(--panel)] backdrop-blur",
                  !mobileDetailOpen && "hidden lg:block",
                )}
              >
                {renderEmailDetail()}
              </div>
            </>
          ) : (
            renderFlatView()
          )}
        </section>

        {undoState ? (
          <div className="fixed bottom-3 left-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 rounded-[18px] border border-[var(--border)] bg-[var(--panel-strong)] p-3 shadow-[0_24px_60px_rgba(32,23,13,0.16)] sm:bottom-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  Resolved “{undoState.title}”.
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Undo will restore the item to the selected email.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold"
                  onClick={() => void undoResolve()}
                  type="button"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Undo
                </button>
                <button
                  aria-label="Dismiss notification"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
                  onClick={() => setUndoState(null)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "accent" | "neutral" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]",
        tone === "accent" &&
          "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
        tone === "neutral" && "bg-white text-[var(--muted)]",
        tone === "warning" && "bg-[var(--warning-soft)] text-[var(--warning)]",
      )}
    >
      {label}
    </span>
  );
}
