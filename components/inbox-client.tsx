"use client";
import { useMemo, useState } from "react";
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
  ThumbsDown,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import type { InboxPayload } from "@/lib/inbox/types";
type ReadingItem = InboxPayload["emails"][number]["items"][number];
export function InboxClient({ initialData }: { initialData: InboxPayload }) {
  const [data, setData] = useState(initialData),
    [category, setCategory] = useState("ai"),
    [tab, setTab] = useState("all"),
    [query, setQuery] = useState(""),
    [publication, setPublication] = useState("all"),
    [showRead, setShowRead] = useState(false),
    [showSponsors, setShowSponsors] = useState(false),
    [expanded, setExpanded] = useState<number[]>([]),
    [busy, setBusy] = useState<number | null>(null),
    [error, setError] = useState("");
  const all = useMemo(
    () =>
      data.emails.flatMap((email) =>
        email.items.map((item) => ({
          ...item,
          email,
          collections: item.collections,
        })),
      ),
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
  const visible = scoped.filter(
    (i) =>
      (tab === "all" ||
        i.collections.some(
          (c) => c.categoryId === activeCategory && c.tabId === tab,
        )) &&
      (showSponsors || i.itemKind !== "sponsor") &&
      (publication === "all" || i.email.sourceVariant === publication) &&
      (showRead ? i.resolvedAt != null : i.resolvedAt == null) &&
      `${i.title} ${i.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  const remaining = all.filter(
    (i) => i.resolvedAt == null && (showSponsors || i.itemKind !== "sponsor"),
  ).length;
  async function refresh() {
    const r = await fetch("/api/inbox", { cache: "no-store" });
    if (!r.ok) throw new Error("Could not refresh the library.");
    setData(await r.json());
  }
  async function action(item: ReadingItem, name: string, body?: unknown) {
    setBusy(item.id);
    setError("");
    try {
      const r = await fetch(`/api/items/${item.id}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok)
        throw new Error("Could not save this action. Please try again.");
      if (["resolve", "unresolve", "preference"].includes(name))
        await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save action");
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function expand(item: ReadingItem) {
    if (expanded.includes(item.id)) {
      setExpanded(expanded.filter((id) => id !== item.id));
      return;
    }
    if (await action(item, "description-expand")) {
      setExpanded([...expanded, item.id]);
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
          {(categories.length ? categories : [["ai", "AI"]]).map(
            ([id, label]) => (
              <button
                className={`category-button ${activeCategory === id ? "active" : ""}`}
                key={id}
                onClick={() => {
                  setCategory(id);
                  setTab("all");
                  setPublication("all");
                }}
              >
                <Inbox size={18} />
                <span>{label}</span>
                <span className="count">
                  {
                    all.filter(
                      (i) =>
                        i.resolvedAt == null &&
                        (showSponsors || i.itemKind !== "sponsor") &&
                        (id === "all-categories" ||
                          i.collections.some((c) => c.categoryId === id)),
                    ).length
                  }
                </span>
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />A quieter way to stay informed.
        </div>
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
              <div className="eyebrow">CURATED FOR YOUR CURIOSITY</div>
              <h1>
                A little perspective.
                <br />
                <span>Ahead of the noise.</span>
              </h1>
              <p>Good links. Useful context. Your next worthwhile read.</p>
            </div>
            <div className="reading-count">
              <strong>{remaining}</strong>
              <span>links to explore</span>
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
                        i.resolvedAt == null &&
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
                aria-pressed={!showRead}
                onClick={() => setShowRead(false)}
              >
                To read
              </button>
              <button aria-pressed={showRead} onClick={() => setShowRead(true)}>
                Read history
              </button>
            </div>
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
          <div className="reading-list">
            {visible.map((item) => (
              <article className="reading-card" key={item.id}>
                <div className="card-topline">
                  <span className="source-badge">
                    {item.email.sourceVariant}
                  </span>
                  <span>{item.section}</span>
                  <span className="card-date">
                    {new Date(item.email.receivedAt).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", timeZone: "UTC" },
                    )}
                  </span>
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
                <div className="card-bottom">
                  <div className="story-links">
                    {item.safeUrl ? (
                      <a
                        href={item.safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          event.preventDefault();
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
                      <span className="muted">Link unavailable</span>
                    )}
                    {item.readTimeText && (
                      <span className="read-time">{item.readTimeText}</span>
                    )}
                    <button
                      className="text-button"
                      aria-expanded={expanded.includes(item.id)}
                      disabled={busy === item.id}
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
                      aria-pressed={item.preference === "interested"}
                      disabled={busy === item.id}
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
                      aria-pressed={item.preference === "less_like_this"}
                      disabled={busy === item.id}
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
                      disabled={busy === item.id}
                      onClick={() =>
                        action(item, item.resolvedAt ? "unresolve" : "resolve")
                      }
                    >
                      {item.resolvedAt ? (
                        <Undo2 size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      <span>{item.resolvedAt ? "Restore" : "Done"}</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!visible.length && (
            <div className="empty-state">
              <Circle size={28} />
              <h2>
                {query
                  ? "No matching stories"
                  : showRead
                    ? "Your reading history starts here"
                    : "Room for a fresh perspective"}
              </h2>
              <p>
                {query
                  ? "Try a different word or collection."
                  : "New stories will appear here when added to your library."}
              </p>
            </div>
          )}
          <footer className="content-footer">
            A considered reading list. At your pace.
          </footer>
        </div>
      </main>
    </div>
  );
}
