'use client';

import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import type { CatalogPayload } from '@/lib/billing/catalog-defaults';

type CatalogResponse = CatalogPayload & {
  id: string;
  version: number;
  isActive: boolean;
  publishedAt: string | null;
};

export function CatalogEditorClient() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startLoad] = useTransition();
  const [pending, startSave] = useTransition();

  function load() {
    setError(null);
    startLoad(async () => {
      const res = await fetch('/api/owner/commercial/catalog');
      if (!res.ok) {
        setError('Failed to load catalog.');
        return;
      }
      const json = (await res.json()) as { data: CatalogResponse };
      setCatalog(json.data);
    });
  }

  useEffect(() => {
    load();
  }, []);

  function save(publishNewVersion: boolean) {
    if (!catalog) return;
    setError(null);
    setSaved(false);
    startSave(async () => {
      const res = await fetch('/api/owner/commercial/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...catalog, publishNewVersion }),
      });
      if (!res.ok) {
        setError('Save failed.');
        return;
      }
      const json = (await res.json()) as { data: CatalogResponse };
      setCatalog(json.data);
      setSaved(true);
    });
  }

  if (!catalog) {
    return <p className="text-sm text-muted-foreground">Loading catalog…</p>;
  }

  const primaryTier = catalog.soloTiersJson[1] ?? catalog.soloTiersJson[0];

  return (
    <div className="space-y-6">
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {saved && <StatusBanner variant="success">Catalog saved.</StatusBanner>}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Active catalog v{catalog.version}</CardTitle>
          <CardDescription>
            Global list prices and trial defaults. Org contracts can override per customer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Solo standard — monthly fee (¢)</Label>
            <Input
              type="number"
              value={primaryTier?.monthlyPriceCents ?? 8900}
              onChange={(e) => {
                const cents = Number(e.target.value);
                setCatalog((c) =>
                  c
                    ? {
                        ...c,
                        soloTiersJson: c.soloTiersJson.map((t) =>
                          t.id === primaryTier?.id ? { ...t, monthlyPriceCents: cents } : t,
                        ),
                      }
                    : c,
                );
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Visits credited per month (solo standard)</Label>
            <Input
              type="number"
              value={primaryTier?.monthlyVisitCredit ?? 100}
              onChange={(e) => {
                const visits = Number(e.target.value);
                setCatalog((c) =>
                  c
                    ? {
                        ...c,
                        soloTiersJson: c.soloTiersJson.map((t) =>
                          t.id === primaryTier?.id ? { ...t, monthlyVisitCredit: visits } : t,
                        ),
                      }
                    : c,
                );
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Collaborator seat fee (¢/mo)</Label>
            <Input
              type="number"
              value={catalog.collaboratorSeatPriceCents}
              onChange={(e) =>
                setCatalog((c) =>
                  c ? { ...c, collaboratorSeatPriceCents: Number(e.target.value) } : c,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Default overage (¢/draft)</Label>
            <Input
              type="number"
              value={catalog.defaultOveragePriceCents}
              onChange={(e) =>
                setCatalog((c) =>
                  c ? { ...c, defaultOveragePriceCents: Number(e.target.value) } : c,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Trial solo — visits / days</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={catalog.trialSoloVisits}
                onChange={(e) =>
                  setCatalog((c) => (c ? { ...c, trialSoloVisits: Number(e.target.value) } : c))
                }
              />
              <Input
                type="number"
                value={catalog.trialSoloDays}
                onChange={(e) =>
                  setCatalog((c) => (c ? { ...c, trialSoloDays: Number(e.target.value) } : c))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Trial org — seats / visits / days</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={catalog.trialOrgSeats}
                onChange={(e) =>
                  setCatalog((c) => (c ? { ...c, trialOrgSeats: Number(e.target.value) } : c))
                }
              />
              <Input
                type="number"
                value={catalog.trialOrgVisits}
                onChange={(e) =>
                  setCatalog((c) => (c ? { ...c, trialOrgVisits: Number(e.target.value) } : c))
                }
              />
              <Input
                type="number"
                value={catalog.trialOrgDays}
                onChange={(e) =>
                  setCatalog((c) => (c ? { ...c, trialOrgDays: Number(e.target.value) } : c))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button disabled={pending} onClick={() => save(false)}>
          {pending ? 'Saving…' : 'Save active catalog'}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => save(true)}>
          Publish new version
        </Button>
      </div>
    </div>
  );
}
