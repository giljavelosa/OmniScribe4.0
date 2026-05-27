import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { CreateTemplateSheet } from '@/app/(admin)/admin/templates/_components/create-template-sheet';
import { CloneTemplateButton } from '@/app/(admin)/admin/templates/_components/clone-template-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My templates' };

/**
 * Clinical-shell templates surface (Option A). Lists:
 *   - the caller's own PERSONAL templates (editable)
 *   - org-shared TEAM templates (read-only for clinicians; clone-to-personal)
 *   - platform presets (read-only; clone-to-personal)
 *
 * Authoring authority is enforced server-side in
 * `/api/admin/templates/**` — non-admin callers can only create / edit /
 * archive PERSONAL rows they own. This page only renders affordances
 * the server will honor.
 */
export default async function ClinicalTemplatesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  const orgUserId = session.user.orgUserId;
  const isOrgAdmin = session.user.role === 'ORG_ADMIN';
  // Admins land in the richer admin surface; this page is the clinician
  // one. Keeps the admin sidebar nav intact for admin users without
  // double-rendering "Templates" / "My templates" in their flow.
  if (isOrgAdmin) redirect('/admin/templates');

  const templates = await prisma.noteTemplate.findMany({
    where: {
      isArchived: false,
      OR: [
        { isPreset: true, orgId: null },
        {
          orgId: session.user.orgId,
          OR: [
            { visibility: { in: ['TEAM', 'PUBLIC'] } },
            { visibility: 'PERSONAL', createdByOrgUserId: orgUserId },
          ],
        },
      ],
    },
    orderBy: [{ isPreset: 'desc' }, { division: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { notes: true, clones: true } } },
  });

  const personal = templates.filter(
    (t) => !t.isPreset && t.visibility === 'PERSONAL' && t.createdByOrgUserId === orgUserId,
  );
  const team = templates.filter(
    (t) => !t.isPreset && (t.visibility === 'TEAM' || t.visibility === 'PUBLIC'),
  );
  const presets = templates.filter((t) => t.isPreset);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2lg font-semibold">My templates</h1>
          <p className="text-sm text-muted-foreground">
            Personal note templates you author. Only you can see them.
          </p>
        </div>
        <CreateTemplateSheet basePath="/templates" personalOnly />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Your personal templates</CardTitle>
          <CardDescription>
            {personal.length} template{personal.length === 1 ? '' : 's'} · only visible to you.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {personal.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No personal templates yet — tap &ldquo;New template&rdquo; above, or clone a preset
              below.
            </p>
          ) : (
            <TemplateTable
              templates={personal}
              basePath="/templates"
              personalOnly
              kind="personal"
            />
          )}
        </CardContent>
      </Card>

      {team.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Team templates (read-only)</CardTitle>
            <CardDescription>
              Authored by your org admin. Clone one to make your own editable copy.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <TemplateTable templates={team} basePath="/templates" personalOnly kind="team" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Platform presets (read-only)</CardTitle>
          <CardDescription>
            Seeded defaults shipped with OmniScribe. Clone one into your personal library to
            tweak.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <TemplateTable templates={presets} basePath="/templates" personalOnly kind="preset" />
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateTable({
  templates,
  basePath,
  personalOnly,
  kind,
}: {
  templates: Array<{
    id: string;
    name: string;
    division: string;
    visibility: string;
    isPreset: boolean;
    isArchived: boolean;
    sensitivityDefault: string;
    version: number;
    specialty: string | null;
    _count: { notes: number; clones: number };
  }>;
  basePath: string;
  personalOnly: boolean;
  kind: 'personal' | 'team' | 'preset';
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left px-4 py-2 font-medium">Name</th>
            <th className="text-left px-4 py-2 font-medium">Division</th>
            <th className="text-left px-4 py-2 font-medium">Visibility</th>
            <th className="text-left px-4 py-2 font-medium">Version</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3 font-medium">
                {kind === 'personal' ? (
                  <Link href={`${basePath}/${t.id}`} className="hover:underline">
                    {t.name}
                    {t.specialty && (
                      <span className="text-muted-foreground text-xs ml-1">· {t.specialty}</span>
                    )}
                  </Link>
                ) : (
                  <span>
                    {t.name}
                    {t.specialty && (
                      <span className="text-muted-foreground text-xs ml-1">· {t.specialty}</span>
                    )}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">{t.division}</td>
              <td className="px-4 py-3">
                <StatusBadge
                  variant={
                    t.visibility === 'PERSONAL'
                      ? 'neutral'
                      : t.visibility === 'TEAM'
                        ? 'info'
                        : 'success'
                  }
                  noIcon
                >
                  {t.visibility}
                </StatusBadge>
              </td>
              <td className="px-4 py-3 font-mono text-xs">v{t.version}</td>
              <td className="px-4 py-3 text-right">
                <CloneTemplateButton
                  templateId={t.id}
                  defaultName={t.name}
                  basePath={basePath}
                  personalOnly={personalOnly}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
