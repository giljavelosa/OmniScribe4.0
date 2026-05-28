import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';
import {
  catalogToPayload,
  ensureActiveCatalog,
  publishNewCatalogVersion,
  updateActiveCatalog,
} from '@/lib/billing/catalog-service';
import { DEFAULT_CATALOG_PAYLOAD } from '@/lib/billing/catalog-defaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  monthlyPriceCents: z.number().int().min(0),
  monthlyVisitCredit: z.number().int().min(0),
});

const bundleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  visitCount: z.number().int().min(1),
  priceCents: z.number().int().min(0),
});

const catalogSchema = z.object({
  soloTiersJson: z.array(tierSchema).min(1),
  visitBundlesJson: z.array(bundleSchema).min(1),
  collaboratorSeatPriceCents: z.number().int().min(0),
  defaultOveragePriceCents: z.number().int().min(0),
  trialSoloVisits: z.number().int().min(0),
  trialSoloDays: z.number().int().min(1),
  trialOrgSeats: z.number().int().min(1),
  trialOrgVisits: z.number().int().min(0),
  trialOrgDays: z.number().int().min(1),
  enterpriseTemplateJson: z.object({
    defaultSeatPriceCents: z.number().int().min(0),
    defaultVisitsPerSeatPerMonth: z.number().int().min(0),
    defaultCommittedSeats: z.number().int().min(1),
  }),
  publishNewVersion: z.boolean().optional(),
});

export async function GET() {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const catalog = await ensureActiveCatalog();
  return NextResponse.json({
    data: {
      id: catalog.id,
      version: catalog.version,
      isActive: catalog.isActive,
      publishedAt: catalog.publishedAt?.toISOString() ?? null,
      ...catalogToPayload(catalog),
    },
  });
}

export async function PUT(req: Request) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const parsed = catalogSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const { publishNewVersion, ...catalogPayload } = payload;

  const catalog = publishNewVersion
    ? await publishNewCatalogVersion(catalogPayload, user.id)
    : await updateActiveCatalog(catalogPayload, user.id);

  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'PLATFORM_CATALOG_PUBLISHED',
    resourceType: 'PlatformBillingCatalog',
    resourceId: catalog.id,
    metadata: {
      version: catalog.version,
      publishNewVersion: !!publishNewVersion,
    },
  });

  return NextResponse.json({
    data: {
      id: catalog.id,
      version: catalog.version,
      ...catalogToPayload(catalog),
    },
  });
}

export async function POST() {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const catalog = await ensureActiveCatalog();
  return NextResponse.json({
    data: {
      id: catalog.id,
      version: catalog.version,
      defaults: DEFAULT_CATALOG_PAYLOAD,
    },
  });
}
