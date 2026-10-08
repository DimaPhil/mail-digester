"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  Inbox,
  RefreshCw,
  Search,
  Settings,
  ThumbsDown,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import type { InboxPayload } from "@/lib/inbox/types";
type ReadingItem = InboxPayload["emails"][number]["items"][number];
const pageSize = 50;
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const interestLabels: Record<string, string> = {
  interesting: "Interesting",
  not_interesting: "Not interesting",
  unclassified: "Unclassified",
};
export function InboxClient({ initialData }: { initialData: InboxPayload }) {
  const [data, setData] = useState(initialData),
    [category, setCategory] = useState("all-categories"),
    [tab, setTab] = useState("all"),
    [query, setQuery] = useState(""),
    [publication, setPublication] = useState("all"),
    [showArchive, setShowArchive] = useState(false),
    [interestFilter, setInterestFilter] = useState("all"),
    [showSponsors, setShowSponsors] = useState(false),
    [expanded, setExpanded] = useState<number[]>([]),
    [busy, setBusy] = useState<number | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [pagination, setPagination] = useState({ key: "", page: 0 }),
    [error, setError] = useState("");
  const pending = useRef(false);
  const refreshVersion = useRef(0);
  const all = useMemo(
    () =>
      data.emails.flatMap((email) => {
        const date = dateFormat.format(new Date(email.receivedAt));
        return email.items.map((item) => ({
          ...item,
          email,
          date,
        }));
      }),
    [data],
  );
  const categories = Array.from(
    new Map([
      ["all-categories", "All reading"] as const,
      ...data.navigation.map((c) => [c.id, c.label] as const),
      ...all.flatMap((i) =>
        i.collections.map((c) => [c.categoryId, c.categoryLabel] as const),
      ),
    ]).entries(),
  );
  const activeCategory = categories.some(([id]) => id === category)
    ? category
    : (categories[0]?.[0] ?? "ai");
  const scoped =
    activeCategory === "all-categories"
      ? all
      : all.filter((i) =>
          i.collections.some((c) => c.categoryId === activeCategory),
        );
  const tabs =
    activeCategory === "all-categories"
      ? []
      : Array.from(
          new Map([
            ...(
              data.navigation.find((c) => c.id === activeCategory)?.tabs ?? []
            ).map((t) => [t.id, t.label] as const),
            ...scoped.flatMap((i) =>
              i.collections
                .filter(
                  (c) => c.categoryId === activeCategory && c.tabId !== "all",
                )
                .map((c) => [c.tabId, c.tabLabel] as const),
            ),
          ]).entries(),
        );
  const matchesView = (item: ReadingItem) =>
    item.readingState === (showArchive ? "archived" : "to_read") &&
    (!showArchive ||
      interestFilter === "all" ||
      item.interestCategory === interestFilter);
  const visible = scoped.filter(
    (i) =>
      (tab === "all" ||
        i.collections.some(
          (c) => c.categoryId === activeCategory && c.tabId === tab,
        )) &&
      (showSponsors || i.itemKind !== "sponsor") &&
      (publication === "all" || i.email.sourceVariant === publication) &&
      matchesView(i) &&
      `${i.title} ${i.summary} ${i.email.sourceVariant} ${i.email.subject}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const remaining = scoped.filter(
    (i) => matchesView(i) && (showSponsors || i.itemKind !== "sponsor"),
  ).length;
  const pageKey = JSON.stringify([
    activeCategory,
    tab,
    query,
    publication,
    showArchive,
    interestFilter,
    showSponsors,
  ]);
  const page = Math.min(
    pagination.key === pageKey ? pagination.page : 0,
    Math.max(0, Math.ceil(visible.length / pageSize) - 1),
  );
  const pageStart = page * pageSize;
  function changePage(nextPage: number) {
    setPagination({ key: pageKey, page: nextPage });
    document.querySelector(".section-caption")?.scrollIntoView();
  }
  async function refresh() {
    const version = ++refreshVersion.current;
    setRefreshing(true);
    try {
      const r = await fetch("/api/inbox", { cache: "no-store" });
      if (!r.ok) throw new Error("Could not refresh the library.");
      const payload = await r.json();
      if (version === refreshVersion.current) {
        setData(payload);
        setError("");
      }
    } finally {
      if (version === refreshVersion.current) setRefreshing(false);
    }
  }
  async function action(item: ReadingItem, name: string, body?: unknown) {
    // ponytail: serialize reader mutations; use per-item queues if parallel actions matter.
    if (pending.current) return false;
    pending.current = true;
    // Discard any refresh started before this write; it contains older state.
    ++refreshVersion.current;
    setRefreshing(false);
    setBusy(item.id);
    setError("");
    try {
      const compact = ["resolve", "unresolve"].includes(name)
        ? "?compact=1"
        : "";
      const r = await fetch(`/api/items/${item.id}/${name}${compact}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok)
        throw new Error("Could not save this action. Please try again.");
      if (["resolve", "unresolve", "preference"].includes(name)) {
        const result = await r.json();
        if (result.item?.id !== item.id)
          throw new Error(
            "Could not confirm the saved item. Refresh the library.",
          );
        setData((current) => ({
          ...current,
          emails: current.emails.map((email) =>
            email.items.some((entry) => entry.id === item.id)
              ? {
                  ...email,
                  items: email.items.map((entry) =>
                    entry.id === item.id ? { ...entry, ...result.item } : entry,
                  ),
                }
              : email,
          ),
        }));
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save action");
      return false;
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  async function expand(item: ReadingItem) {
    if (expanded.includes(item.id)) {
      setExpanded((ids) => ids.filter((id) => id !== item.id));
      return;
    }
    if (await action(item, "description-expand")) {
      setExpanded((ids) => [...ids, item.id]);
      await action(item, "open");
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <BookOpen size={20} />
          </span>
          <span>
            Mail Digester
            <span className="brand-caption">YOUR READING SPACE</span>
          </span>
        </Link>
        <div className="sidebar-label">LIBRARY</div>
        <nav aria-label="Categories">
          {categories.map(([id, label]) => (
            <button
              className={`category-button ${activeCategory === id ? "active" : ""}`}
              key={id}
              aria-pressed={activeCategory === id}
              onClick={() => {
                setCategory(id);
                setTab("all");
                setPublication("all");
              }}
            >
              <Inbox size={18} />
              <span>{label}</span>
              <span
                className="count"
                title={showArchive ? "Archived stories" : "Stories to read"}
              >
                {
                  all.filter(
                    (i) =>
                      matchesView(i) &&
                      (showSponsors || i.itemKind !== "sponsor") &&
                      (id === "all-categories" ||
                        i.collections.some((c) => c.categoryId === id)),
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <Link className="category-button admin-link" href="/admin">
          <Settings size={18} /> Admin settings
        </Link>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <span>
            Library <span className="breadcrumb">/</span>{" "}
            {categories.find(([id]) => id === activeCategory)?.[1] ?? "AI"}
          </span>
          <button
            className="icon-button"
            aria-label="Refresh library"
            disabled={refreshing || busy !== null}
            onClick={() => {
              refresh().catch(() => setError("Could not refresh the library."));
            }}
          >
            <RefreshCw size={16} />
          </button>
        </header>
        <div className="reading-content">
          <div className="page-intro">
            <div>
              <div className="eyebrow">YOUR READING SPACE</div>
              <h1>{categories.find(([id]) => id === activeCategory)?.[1]}</h1>
              <p>
                {showArchive
                  ? "All your other stories, including those marked Done."
                  : "Interesting stories and newsletters, ready to read."}
              </p>
            </div>
            <div className="reading-count">
              <strong>{remaining}</strong>
              <span>
                {showArchive ? "archived stories" : "stories to read"}
              </span>
            </div>
          </div>
          <nav className="source-tabs" aria-label="Reading collections">
            <button aria-pressed={tab === "all"} onClick={() => setTab("all")}>
              All reading
            </button>
            {tabs.map(([id, label]) => (
              <button
                aria-pressed={tab === id}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
                <span>
                  {
                    scoped.filter(
                      (i) =>
                        matchesView(i) &&
                        (showSponsors || i.itemKind !== "sponsor") &&
                        i.collections.some(
                          (c) =>
                            c.categoryId === activeCategory && c.tabId === id,
                        ),
                    ).length
                  }
                </span>
              </button>
            ))}
          </nav>
          <div className="list-toolbar">
            <div className="view-switch">
              <button
                aria-pressed={!showArchive}
                onClick={() => setShowArchive(false)}
              >
                To read
              </button>
              <button
                aria-pressed={showArchive}
                onClick={() => setShowArchive(true)}
              >
                Archive
              </button>
            </div>
            {showArchive && (
              <select
                className="publication-filter"
                aria-label="Filter archive by interest"
                value={interestFilter}
                onChange={(e) => setInterestFilter(e.target.value)}
              >
                <option value="all">All interest categories</option>
                {Object.entries(interestLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <label className="sponsor-filter">
              <input
                type="checkbox"
                checked={showSponsors}
                onChange={(e) => setShowSponsors(e.target.checked)}
              />
              Show sponsored
            </label>
            <select
              className="publication-filter"
              aria-label="Filter by publication"
              value={publication}
              onChange={(e) => setPublication(e.target.value)}
            >
              <option value="all">All publications</option>
              {Array.from(
                new Set(scoped.map((i) => i.email.sourceVariant)),
              ).map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search reading"
                placeholder="Find a story…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="section-caption">
            <span>
              {visible.length} {visible.length === 1 ? "STORY" : "STORIES"}
            </span>
            <span>NEWEST FIRST</span>
          </div>
          <div className="reading-list" aria-busy={refreshing}>
            {visible.slice(pageStart, pageStart + pageSize).map((item) => (
              <article className="reading-card" key={item.id}>
                <div className="card-topline">
                  <span className="source-badge">
                    {item.email.sourceVariant}
                  </span>
                  <span>{item.section}</span>
                  <span
                    className="interest-badge"
                    title={`Uploader: ${interestLabels[item.interestStatus]}`}
                  >
                    {interestLabels[item.interestCategory]}
                  </span>
                  {showArchive && (
                    <span>{item.resolvedAt == null ? "Unread" : "Done"}</span>
                  )}
                  {item.itemKind === "sponsor" && (
                    <span className="sponsor-badge">Sponsored</span>
                  )}
                  <span className="card-date">{item.date}</span>
                </div>
                <h2>{item.title}</h2>
                <p
                  className={
                    expanded.includes(item.id)
                      ? "description"
                      : "description collapsed"
                  }
                >
                  {item.summary}
                </p>
                {expanded.includes(item.id) && item.interestReason && (
                  <p className="classification-reason">
                    Uploader classification: {item.interestReason}
                  </p>
                )}
                <div className="card-bottom">
                  <div className="story-links">
                    {item.safeUrl ? (
                      <a
                        href={item.safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          event.preventDefault();
                          if (pending.current) return;
                          const destination = window.open(
                            "about:blank",
                            "_blank",
                          );
                          if (!destination) {
                            setError("Allow a new tab to open this story.");
                            return;
                          }
                          destination.opener = null;
                          action(item, "link-open").then((ok) => {
                            if (ok && destination)
                              destination.location.href = item.safeUrl!;
                            else destination?.close();
                          });
                        }}
                      >
                        <span>Read story</span>
                        <ArrowUpRight size={16} />
                      </a>
                    ) : (
                      <span className="muted">Newsletter</span>
                    )}
                    {item.readTimeText && (
                      <span className="read-time">{item.readTimeText}</span>
                    )}
                    <button
                      className="text-button"
                      aria-expanded={expanded.includes(item.id)}
                      disabled={busy !== null}
                      onClick={() => expand(item)}
                    >
                      Details
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <div className="story-actions">
                    <button
                      className={`icon-button ${item.preference === "interested" ? "selected" : ""}`}
                      aria-label={`More like: ${item.title}`}
                      title="More like this"
                      aria-pressed={item.preference === "interested"}
                      disabled={busy !== null}
                      onClick={() =>
                        action(item, "preference", {
                          signal:
                            item.preference === "interested"
                              ? "clear"
                              : "interested",
                        })
                      }
                    >
                      <ThumbsUp size={16} />
                    </button>
                    <button
                      className={`icon-button ${item.preference === "less_like_this" ? "selected" : ""}`}
                      aria-label={`Less like: ${item.title}`}
                      title="Less like this"
                      aria-pressed={item.preference === "less_like_this"}
                      disabled={busy !== null}
                      onClick={() =>
                        action(item, "preference", {
                          signal:
                            item.preference === "less_like_this"
                              ? "clear"
                              : "less_like_this",
                        })
                      }
                    >
                      <ThumbsDown size={16} />
                    </button>
                    <button
                      className="resolve-button"
                      disabled={busy !== null}
                      onClick={() =>
                        action(item, item.resolvedAt ? "unresolve" : "resolve")
                      }
                    >
                      {item.resolvedAt ? (
                        <Undo2 size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      <span>
                        {item.resolvedAt
                          ? item.interestStatus === "interesting"
                            ? "Restore"
                            : "Mark unread"
                          : "Done"}
                      </span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {visible.length > pageSize && (
            <nav className="list-toolbar" aria-label="Story pages">
              <button
                className="resolve-button"
                disabled={page === 0}
                onClick={() => changePage(page - 1)}
              >
                Previous
              </button>
              <span aria-live="polite">
                {pageStart + 1}–{Math.min(pageStart + pageSize, visible.length)}{" "}
                of {visible.length}
              </span>
              <button
                className="resolve-button"
                disabled={pageStart + pageSize >= visible.length}
                onClick={() => changePage(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
          {!visible.length && (
            <div className="empty-state">
              <Circle size={28} />
              <h2>
                {query ||
                publication !== "all" ||
                tab !== "all" ||
                (showArchive && interestFilter !== "all")
                  ? "No matching stories"
                  : showArchive
                    ? "Archive is empty"
                    : "You're all caught up"}
              </h2>
              <p>
                {query ||
                publication !== "all" ||
                tab !== "all" ||
                (showArchive && interestFilter !== "all")
                  ? "Try another search, publication, or collection."
                  : showArchive
                    ? "Non-interesting, unclassified, and Done stories appear here."
                    : "Interesting stories appear here. Other stories are in Archive."}
              </p>
              {(query ||
                publication !== "all" ||
                tab !== "all" ||
                (showArchive && interestFilter !== "all")) && (
                <button
                  className="resolve-button"
                  onClick={() => {
                    setQuery("");
                    setPublication("all");
                    setTab("all");
                    setInterestFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
