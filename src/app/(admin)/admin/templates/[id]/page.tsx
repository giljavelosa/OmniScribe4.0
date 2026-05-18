import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StatusBadge } from '@/components/ui/status-badge';
import { TemplateEditor } from './_components/template-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Template editor' };

export default async function AdminTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');

  const template = await prisma.noteTemplate.findUnique({
    where: { id },
    include: {
      clonedFrom: { select: { id: true, name: true, version: true } },
      _count: { select: { notes: true, clones: true } },
    },
  });
  if (!template) notFound();

  const visibleToOrg =
    (template.isPreset && template.orgId === null) ||
    template.orgId === session.user.orgId;
  if (!visibleToOrg) notFound();

  // Presets are read-only; redirect to the list with the preset surfaced
  // (the list's Clone action is the next step).
  if (template.isPreset || template.orgId === null) {
    redirect('/admin/templates');
  }

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
    sectionSchema: template.sectionSchema as { sections: Array<{ id: string; label: string; required?: boolean; promptHint?: string }> },
    clonedFrom: template.clonedFrom,
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link href="/admin/templates" className="text-xs text-muted-foreground hover:underline">
          ← All templates
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2lg font-semibold">{template.name}</h1>
          <StatusBadge variant="neutral" noIcon>v{template.version}</StatusBadge>
          {template.isArchived && <StatusBadge variant="neutral" noIcon>archived</StatusBadge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {template._count.notes} note{template._count.notes === 1 ? '' : 's'} use this template ·{' '}
          {template._count.clones} clone{template._count.clones === 1 ? '' : 's'}
        </p>
      </div>

      <TemplateEditor template={initial} />
    </div>
  );
}
