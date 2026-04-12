export default function Loading() {
  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_30px_80px_rgba(79,53,20,0.08)] backdrop-blur">
          <div className="mb-2 h-4 w-32 animate-pulse rounded-full bg-[var(--accent-soft)]" />
          <div className="h-10 w-64 animate-pulse rounded-full bg-white/70" />
          <div className="mt-4 h-3 w-96 max-w-full animate-pulse rounded-full bg-white/70" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
          <div className="space-y-4 rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-4 backdrop-blur">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="rounded-[22px] border border-white/60 bg-white/70 p-5"
              >
                <div className="h-4 w-24 animate-pulse rounded-full bg-[var(--accent-soft)]" />
                <div className="mt-4 h-6 w-4/5 animate-pulse rounded-full bg-[var(--bg-strong)]" />
                <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-[var(--bg-strong)]" />
                <div className="mt-2 h-4 w-2/3 animate-pulse rounded-full bg-[var(--bg-strong)]" />
              </div>
            ))}
          </div>
          <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-6 backdrop-blur">
            <div className="h-5 w-40 animate-pulse rounded-full bg-[var(--accent-soft)]" />
            <div className="mt-5 h-6 w-5/6 animate-pulse rounded-full bg-[var(--bg-strong)]" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-4 animate-pulse rounded-full bg-[var(--bg-strong)]"
                  style={{ width: `${90 - index * 5}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
