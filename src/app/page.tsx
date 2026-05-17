// Placeholder root page — verifies layout + tokens render correctly.
// Replaced in Commit 5 with `redirect('/login')` once the auth group exists.

export default function Home() {
  return (
    <main className="flex-1 grid place-items-center px-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-card text-card-foreground p-8 shadow-sm">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Scaffold check</p>
        <h1 className="mt-2 text-2lg font-semibold">OmniScribe</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tokens, fonts, and layout are wired. Sign-in lands in Unit 01 (next commit).
        </p>
        <div className="mt-6 flex gap-2 text-xs">
          <span className="rounded-md px-2 py-1 bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border border-[var(--status-success-border)]">success</span>
          <span className="rounded-md px-2 py-1 bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border border-[var(--status-warning-border)]">warning</span>
          <span className="rounded-md px-2 py-1 bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] border border-[var(--status-danger-border)]">danger</span>
          <span className="rounded-md px-2 py-1 bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border border-[var(--status-info-border)]">info</span>
          <span className="rounded-md px-2 py-1 bg-[var(--status-violet-bg)] text-[var(--status-violet-fg)] border border-[var(--status-violet-border)]">violet</span>
        </div>
      </div>
    </main>
  );
}
