import type { Metadata } from 'next';

import { CatalogEditorClient } from './_components/catalog-editor-client';

export const metadata: Metadata = { title: 'Commercial catalog' };

export default function OwnerCommercialCatalogPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2lg font-semibold">Commercial catalog</h1>
        <p className="text-sm text-muted-foreground">
          Set global monthly tiers, bundle prices, trial limits, and collaborator seat fees.
        </p>
      </header>
      <CatalogEditorClient />
    </div>
  );
}
