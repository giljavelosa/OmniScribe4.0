import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StatusBadge } from '@/components/ui/status-badge';
import { TemplateEditor } from '@/app/(admin)/admin/templates/[id]/_components/template-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Template editor' };

/**
 * Clinical-shell template editor (Option A). Renders the same
 * `TemplateEditor` the admin surface uses, parameterized to:
 *   - link back to `/templates` (not `/admin/templates`)
 *   - lock the visibility picker to PERSONAL (server enforces the same)
 *
 * Authorization (route + page):
 *   - Server-side guard: the caller must own the row AND it must be a
 *     PERSONAL template — otherwise we `notFound()` rather than 403 so
 *     a probing clinician learns nothing about other rows that exist.
 *   - The TemplateEditor's PATCH / archive calls hit the existing
 *     `/api/admin/templates/[id]` routes which re-enforce the same rule.
 */
export default async function ClinicalTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  const orgUserId = session.user.orgUserId;
  if (session.user.role === 'ORG_ADMIN') {
    // Admins use the richer admin editor (it allows TEAM authoring).
    redirect(`/admin/templates/${id}`);
  }

  const template = await prisma.noteTemplate.findUnique({
    where: { id },
    include: {
      clonedFrom: { select: { id: true, name: true, version: true } },
      _count: { select: { notes: true, clones: true } },
    },
  });
  if (!template) notFound();

  const ownsRow =
    template.orgId === session.user.orgId &&
    template.visibility === 'PERSONAL' &&
    template.createdByOrgUserId === orgUserId &&
    !template.isPreset;
  if (!ownsRow) notFound();

  const initial = {
    id: template.id,
    name: template.name,
    description: template.description,
    division: template.division,
    specialty: template.specialty,
    visibility: template.visibility,
    sensitivityDefault: template.sensitivityDefault,
    version: template.version,
    isArchived: template.isArchived,
    sectionSchema: template.sectionSchema as {
      sections: Array<{ id: string; label: string; required?: boolean; promptHint?: string }>;
    },
    clonedFrom: template.clonedFrom,
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="space-y-1">
        <Link href="/templates" className="text-xs text-muted-foreground hover:underline">
          ← My templates
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2lg font-semibold">{template.name}</h1>
          <StatusBadge variant="neutral" noIcon>
            v{template.version}
          </StatusBadge>
          {template.isArchived && (
            <StatusBadge variant="neutral" noIcon>
              archived
            </StatusBadge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Personal template · only visible to you ·{' '}
          {template._count.notes} note{template._count.notes === 1 ? '' : 's'} use this template
        </p>
      </div>

      <TemplateEditor template={initial} basePath="/templates" personalOnly />
    </div>
  );
}
