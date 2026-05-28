'use client';

import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * AuditMetadataDiff — Unit 34.
 *
 * Renders audit metadata that follows the canonical Unit 34 shape:
 *
 *   { changes: { fieldName: { before, after } }, ...otherMeta }
 *
 * When `metadata.changes` is present + a valid object, renders a
 * 2-column field-by-field table (field → before → after) plus any
 * surviving non-`changes` keys as a smaller meta line. Falls back to
 * the original JSON dump when the metadata doesn't match the shape
 * (so legacy rows + opaque metadata still render).
 *
 * Used by both /admin/audit and /owner/audit + /ops/audit tables.
 */

type ChangeMap = Record<string, { before: unknown; after: unknown }>;

export function AuditMetadataDiff({ metadata }: { metadata: unknown }) {
  if (metadata == null) return <span className="text-muted-foreground">—</span>;
  if (typeof metadata !== 'object') {
    return (
      <MetadataScrollBox>
        <pre className="whitespace-pre-wrap break-all text-[11px]">{String(metadata)}</pre>
      </MetadataScrollBox>
    );
  }

  const meta = metadata as Record<string, unknown>;
  const changes = extractChanges(meta.changes);
  if (changes) {
    const otherKeys = Object.keys(meta).filter((k) => k !== 'changes');
    return (
      <MetadataScrollBox className="space-y-1">
        <table className="text-[11px] border-separate border-spacing-x-2">
          <tbody>
            {Object.entries(changes).map(([field, { before, after }]) => (
              <tr key={field}>
                <td className="font-mono text-foreground/80 pr-1 align-top">{field}:</td>
                <td className="font-mono text-muted-foreground align-top">
                  {formatValue(before)}
                </td>
                <td className="px-1 align-top">
                  <ArrowRight className="h-3 w-3 inline text-muted-foreground" aria-hidden />
                </td>
                <td className="font-mono text-foreground align-top">
                  {formatValue(after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {otherKeys.length > 0 && (
          <p className="text-[10px] text-muted-foreground italic">
            {otherKeys.map((k) => `${k}=${formatValue(meta[k])}`).join(' · ')}
          </p>
        )}
      </MetadataScrollBox>
    );
  }

  // Fallback: legacy opaque metadata.
  return (
    <MetadataScrollBox>
      <pre className="whitespace-pre-wrap break-all text-[11px]">
        {JSON.stringify(metadata, null, 0)}
      </pre>
    </MetadataScrollBox>
  );
}

function MetadataScrollBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'max-h-32 overflow-y-auto rounded-sm border border-border/50 bg-muted/20 p-1.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

function extractChanges(raw: unknown): ChangeMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: ChangeMap = {};
  for (const [field, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') return null;
    const entry = value as Record<string, unknown>;
    if (!('before' in entry) || !('after' in entry)) return null;
    out[field] = { before: entry.before, after: entry.after };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
