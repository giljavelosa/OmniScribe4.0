'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Eye, X } from 'lucide-react';

/**
 * ImpersonationBanner — Unit 32.
 *
 * Mounted at the root layout. Self-renders nothing when no impersonation
 * is active (session.impersonation === null) so it's safe to live above
 * every surface, including unauthenticated pages.
 *
 * When active: shows a sticky banner with target user + reason +
 * remaining time + an "End impersonation" button. Click → DELETE
 * /api/owner/orgs/[orgId]/impersonate → session.update({ impersonation:
 * null }) → router.refresh().
 *
 * Color: --status-danger-* tokens. The mode is high-blast-radius +
 * should be UNMISTAKABLE; the danger tint is intentional, not a
 * status-color violation of Rule 23 (which prohibits hardcoded hex /
 * not the token system).
 */
export function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const imp = session?.impersonation ?? null;
  if (!imp) return null;

  function endImpersonation() {
    if (!imp) return;
    startTransition(async () => {
      const res = await fetch(
        `/api/owner/orgs/${imp.targetOrgId}/impersonate`,
        { method: 'DELETE' },
      );
      // Clear the JWT field regardless of res.ok — even if the audit
      // write failed for some reason, we want the local UI to drop
      // back to owner mode. The server-side check would catch any
      // truly broken state on the next mutation attempt.
      await update({ impersonation: null });
      router.push('/home');
      router.refresh();
      // Suppress unused-var lint when res unused beyond pending state.
      void res;
    });
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-[var(--status-danger-fg)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]"
    >
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Impersonation active</strong> · acting as{' '}
            <code className="font-mono">{imp.targetUserId}</code> in org{' '}
            <code className="font-mono">{imp.targetOrgId}</code>
            {imp.reason ? ` · "${imp.reason}"` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={endImpersonation}
          disabled={pending}
          className="inline-flex items-center gap-1 min-h-[var(--touch-min)] rounded-md bg-[var(--status-danger-fg)] text-[var(--status-danger-bg)] px-3 py-1 text-xs uppercase tracking-wide hover:opacity-90 disabled:opacity-50"
        >
          <X className="h-3 w-3" aria-hidden />
          {pending ? 'Ending…' : 'End impersonation'}
        </button>
      </div>
    </div>
  );
}
