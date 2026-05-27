import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { type AiCommandPattern } from '@/lib/ai-command/classify';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'AI command telemetry' };

/**
 * /admin/ai-queries — Tier 2 dashboard.
 *
 * Reads the last 7 days of AI_PANEL_QUERY audit rows, aggregates them
 * client-of-the-DB (in JS — volume is low), and renders three small
 * cards:
 *
 *   1. Pattern breakdown    — % of submissions per shape bucket. The
 *                             headline number that drives Tier 3 scope.
 *   2. Command verbs        — when shape was 'looks_like_command',
 *                             which canonical verb was matched. Tells
 *                             us which Tier 3 deterministic commands
 *                             will move the needle.
 *   3. Recent submissions   — last 50 rows so an admin can spot-check.
 *
 * PHI-fence
 * ---------
 * Every value rendered here comes from the closed-enum metadata
 * fields (`pattern`, `commandVerb`, `surface`, `queryLength`,
 * `wordCount`). No user-typed text is stored in the audit log so
 * none can leak through this page either — this is a structural
 * report, not a query log.
 */

const PATTERN_LABELS: Record<AiCommandPattern, string> = {
  empty: 'Empty / whitespace',
  looks_like_name: 'Patient name',
  looks_like_command: 'Known command',
  looks_like_question: 'Question',
  mrn_pattern: 'MRN-shaped',
  other: 'Other (design space)',
};

const VERB_LABELS: Record<string, string> = {
  drafts: 'Drafts',
  schedule: 'Schedule / today',
  followups: 'Follow-ups',
  unsigned: 'Unsigned notes',
  start_visit: 'Start a visit',
  find_patient: 'Find patient',
  home: 'Go home',
  patients: 'Patients list',
};

const WINDOW_DAYS = 7;

type AiPanelQueryMeta = {
  pattern?: AiCommandPattern;
  commandVerb?: string | null;
  queryLength?: number;
  wordCount?: number;
  surface?: 'home-desktop' | 'home-mobile';
};

export default async function AdminAiQueriesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');
  const orgId = session.user.orgId;

  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);

  const rows = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: 'AI_PANEL_QUERY',
      createdAt: { gte: since },
    },
    select: {
      id: true,
      createdAt: true,
      userId: true,
      metadata: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5_000, // hard cap — at typical clinic volume a week is ≪ 5k rows
  });

  // AuditLog has no Prisma relation to User (denormalized userId), so
  // we resolve emails in a single batched query for the rows we'll
  // actually render.
  const userIds = Array.from(
    new Set(rows.slice(0, 50).map((r) => r.userId).filter((id): id is string => !!id)),
  );
  const userEmailById = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    for (const u of users) userEmailById.set(u.id, u.email);
  }

  const patternCounts = new Map<string, number>();
  const verbCounts = new Map<string, number>();
  const surfaceCounts = new Map<string, number>();
  let totalLength = 0;
  let totalWords = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as AiPanelQueryMeta;
    const pattern = meta.pattern ?? 'other';
    patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);

    const verb = meta.commandVerb ?? null;
    if (verb) verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1);

    const surface = meta.surface ?? 'unknown';
    surfaceCounts.set(surface, (surfaceCounts.get(surface) ?? 0) + 1);

    totalLength += meta.queryLength ?? 0;
    totalWords += meta.wordCount ?? 0;
  }

  const total = rows.length;
  const recent = rows.slice(0, 50);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2lg font-semibold">Ask OmniScribe AI — telemetry</h1>
        <p className="text-sm text-muted-foreground">
          Last {WINDOW_DAYS} days · {total.toLocaleString()} submission{total === 1 ? '' : 's'}.
          The home AI panel today is a stub that routes to patient search; this dashboard
          shows what clinicians are typing into it (PHI-stripped) so the next iteration
          can be designed from real data.
        </p>
      </header>

      {total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No AI panel submissions in the last {WINDOW_DAYS} days. Once clinicians
            start using the &ldquo;Ask OmniScribe AI&rdquo; box on the home cockpit,
            their queries will be classified and counted here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-md">Query shapes</CardTitle>
              <CardDescription>
                What KIND of thing clinicians are typing. Drives Tier 3 scope: a
                high &ldquo;Patient name&rdquo; rate prioritizes patient
                disambiguation; a high &ldquo;Known command&rdquo; rate
                prioritizes a deterministic command vocabulary.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShareTable rows={shareRows(patternCounts, total, PATTERN_LABELS)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-md">Top command verbs</CardTitle>
              <CardDescription>
                When the classifier matched a known command, which canonical verb
                fired. The verbs here are the closed enum from{' '}
                <code className="text-xs">classify.ts</code> — never user-typed text.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {verbCounts.size === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No command verbs matched yet. (Either the panel is unused or
                  clinicians are typing patient names exclusively.)
                </p>
              ) : (
                <ShareTable rows={shareRows(verbCounts, total, VERB_LABELS)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-md">Surface mix</CardTitle>
              <CardDescription>
                Which variant of the panel is generating submissions. Mobile-heavy
                usage suggests cockpit-on-the-go; desktop-heavy means at the
                workstation between visits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShareTable
                rows={shareRows(surfaceCounts, total, {
                  'home-desktop': 'Desktop cockpit',
                  'home-mobile': 'Mobile cockpit',
                  unknown: 'Unknown',
                })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-md">Aggregate stats</CardTitle>
              <CardDescription>
                Bounded counts only — no PHI. Useful for sanity-checking the
                classifier (very high avg word count suggests a lot of free-text
                questions; very low suggests one-word lookups).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Avg query length</dt>
                  <dd className="font-mono">
                    {total > 0 ? Math.round(totalLength / total) : 0} chars
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Avg word count</dt>
                  <dd className="font-mono">
                    {total > 0 ? (totalWords / total).toFixed(1) : '0'} words
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total submissions</dt>
                  <dd className="font-mono">{total.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Window</dt>
                  <dd className="font-mono">{WINDOW_DAYS} days</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Recent submissions ({recent.length})</CardTitle>
            <CardDescription>
              The 50 most recent rows, newest first. Each row shows only the
              CLASSIFIED shape — the original query text was never stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">User</th>
                  <th className="py-2 font-medium">Pattern</th>
                  <th className="py-2 font-medium">Verb</th>
                  <th className="py-2 font-medium">Surface</th>
                  <th className="py-2 font-medium text-right">Len</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => {
                  const meta = (row.metadata ?? {}) as AiPanelQueryMeta;
                  const pattern = meta.pattern ?? 'other';
                  return (
                    <tr key={row.id} className="border-b border-border/40">
                      <td className="py-2 font-mono text-xs">
                        {row.createdAt.toLocaleString()}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                        {row.userId ? (userEmailById.get(row.userId) ?? '—') : '—'}
                      </td>
                      <td className="py-2">
                        <StatusBadge variant={patternBadgeVariant(pattern)} noIcon>
                          {PATTERN_LABELS[pattern as AiCommandPattern] ?? pattern}
                        </StatusBadge>
                      </td>
                      <td className="py-2 text-xs font-mono">
                        {meta.commandVerb ?? '—'}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {meta.surface ?? '—'}
                      </td>
                      <td className="py-2 text-right font-mono text-xs">
                        {meta.queryLength ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function shareRows(
  counts: Map<string, number>,
  total: number,
  labels: Record<string, string>,
): Array<{ key: string; label: string; count: number; pct: number }> {
  if (total === 0) return [];
  const out: Array<{ key: string; label: string; count: number; pct: number }> = [];
  for (const [key, count] of counts.entries()) {
    out.push({
      key,
      label: labels[key] ?? key,
      count,
      pct: (count / total) * 100,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

function ShareTable({
  rows,
}: {
  rows: Array<{ key: string; label: string; count: number; pct: number }>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data.</p>;
  }
  const max = Math.max(...rows.map((r) => r.pct));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="text-sm flex-1 min-w-0 truncate">{r.label}</span>
          <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
            {r.count}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
            {r.pct.toFixed(1)}%
          </span>
          {/* Simple inline bar — visual scan for the dominant bucket. */}
          <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
            <div
              className="h-full bg-primary"
              style={{ width: `${(r.pct / max) * 100}%` }}
              aria-hidden
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function patternBadgeVariant(
  p: string,
): 'success' | 'info' | 'warning' | 'neutral' | 'violet' {
  switch (p) {
    case 'looks_like_command':
      return 'success';
    case 'looks_like_name':
      return 'info';
    case 'mrn_pattern':
      return 'info';
    case 'looks_like_question':
      return 'violet';
    case 'empty':
      return 'neutral';
    default:
      return 'warning';
  }
}

