import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { CreateTemplateSheet } from './_components/create-template-sheet';
import { CloneTemplateButton } from './_components/clone-template-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Templates' };

export default async function AdminTemplatesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');
  const orgUserId = session.user.orgUserId;

  const templates = await prisma.noteTemplate.findMany({
    where: {
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

  const presets = templates.filter((t) => t.isPreset);
  const orgTemplates = templates.filter((t) => !t.isPreset);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2lg font-semibold">Templates</h1>
        <CreateTemplateSheet />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Your org&apos;s templates</CardTitle>
          <CardDescription>
            {orgTemplates.length} template{orgTemplates.length === 1 ? '' : 's'}. Personal
            templates are visible only to you; team templates are visible to everyone in your
            org.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {orgTemplates.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No templates yet — tap &ldquo;New template&rdquo; above, or clone a preset below.
            </p>
          ) : (
            <TemplateTable templates={orgTemplates} showClone />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Platform presets (read-only)</CardTitle>
          <CardDescription>
            Seeded defaults shipped with OmniScribe. Clone into your org to customize.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <TemplateTable templates={presets} showClone presetMode />
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateTable({
  templates,
  showClone,
  presetMode,
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
  showClone?: boolean;
  presetMode?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left px-4 py-2 font-medium">Name</th>
            <th className="text-left px-4 py-2 font-medium">Division</th>
            <th className="text-left px-4 py-2 font-medium">Visibility</th>
            <th className="text-left px-4 py-2 font-medium">Sensitivity</th>
            <th className="text-left px-4 py-2 font-medium">Version</th>
            <th className="text-left px-4 py-2 font-medium">Notes</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3 font-medium">
                {presetMode ? (
                  <span>
                    {t.name}{' '}
                    {t.specialty && <span className="text-muted-foreground text-xs">· {t.specialty}</span>}
                  </span>
                ) : (
                  <Link href={`/admin/templates/${t.id}`} className="hover:underline">
                    {t.name}
                    {t.specialty && <span className="text-muted-foreground text-xs ml-1">· {t.specialty}</span>}
                  </Link>
                )}
                {t.isArchived && (
                  <StatusBadge variant="neutral" noIcon className="ml-2">archived</StatusBadge>
                )}
              </td>
              <td className="px-4 py-3">{t.division}</td>
              <td className="px-4 py-3">
                <StatusBadge
                  variant={t.visibility === 'PERSONAL' ? 'neutral' : t.visibility === 'TEAM' ? 'info' : 'success'}
                  noIcon
                >
                  {t.visibility}
                </StatusBadge>
              </td>
              <td className="px-4 py-3 text-xs">{t.sensitivityDefault}</td>
              <td className="px-4 py-3 font-mono text-xs">v{t.version}</td>
              <td className="px-4 py-3 text-muted-foreground">{t._count.notes}</td>
              <td className="px-4 py-3 text-right">
                {showClone && (
                  <CloneTemplateButton templateId={t.id} defaultName={t.name} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
