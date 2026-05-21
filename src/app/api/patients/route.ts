import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { canActAtSite, getClinicianSiteIds } from '@/lib/authz/site-scope';
import { isValidPersonName } from '@/lib/patient/name-validator';
import { PatientSex, PatientAddressKind, PatientCoverageStatus } from '@prisma/client';

export const runtime = 'nodejs';

const PAGE_SIZE = 20;

const createSchema = z.object({
  firstName: z
    .string()
    .min(1)
    .refine(isValidPersonName, { message: 'invalid characters in first name' }),
  lastName: z
    .string()
    .min(1)
    .refine(isValidPersonName, { message: 'invalid characters in last name' }),
  // MRN is optional — OmniScribe generates an internal patient ID automatically.
  // Require DOB for safer matching when MRN is absent.
  mrn: z.string().min(1).optional(),
  dob: z.string().min(1),
  sex: z.enum(PatientSex),
  // Optional default site. The site of record for a specific visit is set
  // at recording-time on the Encounter (via the StartVisit dialog), not
  // baked into the patient row. Patient.siteId is just a convenience
  // default for the dialog's site picker.
  siteId: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  preferredLanguage: z.string().optional(),
  address: z
    .object({
      kind: z.enum(PatientAddressKind).default(PatientAddressKind.HOME),
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      postalCode: z.string().min(1),
      country: z.string().default('US'),
    })
    .optional(),
  coverage: z
    .object({
      carrier: z.string().min(1),
      planName: z.string().optional(),
      memberId: z.string().min(1),
      groupId: z.string().optional(),
      status: z.enum(PatientCoverageStatus).default(PatientCoverageStatus.ACTIVE),
    })
    .optional(),
});

export async function GET(req: Request) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get('query') ?? '').trim();
  const includeDeleted = url.searchParams.get('includeDeleted') === '1';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);

  const where = {
    orgId: authorizationUser.orgId,
    ...(includeDeleted ? {} : { isDeleted: false }),
    ...(rawQuery
      ? {
          OR: [
            { lastName: { contains: rawQuery, mode: 'insensitive' as const } },
            { firstName: { contains: rawQuery, mode: 'insensitive' as const } },
            { mrn: { contains: rawQuery, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mrn: true,
        dob: true,
        sex: true,
        siteId: true,
        isDeleted: true,
        encounters: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { startedAt: true, status: true },
        },
      },
    }),
  ]);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_SEARCHED',
    metadata: { queryLength: rawQuery.length, page, includeDeleted, totalMatched: total },
  });

  return NextResponse.json({ data: { items, total, page, pageSize: PAGE_SIZE } });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;
  const dob = new Date(data.dob);
  if (Number.isNaN(dob.getTime())) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid DOB.' } }, { status: 400 });
  }

  // MRN uniqueness check — only when MRN is provided.
  if (data.mrn) {
    const dupe = await prisma.patient.findFirst({
      where: { orgId: authorizationUser.orgId, mrn: data.mrn },
    });
    if (dupe) {
      return NextResponse.json({ error: { code: 'duplicate_mrn' } }, { status: 409 });
    }
  }

  // When a default site is supplied, validate it: (a) exists in this org
  // and (b) is in the caller's site scope. Site-scoped admins can't assign
  // a patient to a site they aren't enrolled at; ORG_ADMIN+ get scope:
  // 'all' implicitly. When siteId is omitted entirely we skip validation —
  // the patient is created without a default; the StartVisit dialog picks
  // the site at recording-time.
  if (data.siteId) {
    const site = await prisma.site.findFirst({
      where: { id: data.siteId, orgId: authorizationUser.orgId, isArchived: false },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: { code: 'site_not_found' } }, { status: 400 });
    }
    const siteScope = await getClinicianSiteIds(
      authorizationUser.orgUserId,
      authorizationUser.orgId,
    );
    if (!canActAtSite(siteScope, data.siteId)) {
      return NextResponse.json({ error: { code: 'site_not_in_scope' } }, { status: 403 });
    }
  }

  const patient = await prisma.$transaction(async (tx) => {
    const p = await tx.patient.create({
      data: {
        orgId: authorizationUser.orgId,
        siteId: data.siteId,
        firstName: data.firstName,
        lastName: data.lastName,
        mrn: data.mrn ?? null,
        dob,
        sex: data.sex,
        phone: data.phone,
        email: data.email,
        preferredLanguage: data.preferredLanguage,
      },
    });
    if (data.address) {
      await tx.patientAddress.create({ data: { patientId: p.id, ...data.address } });
    }
    if (data.coverage) {
      await tx.patientCoverage.create({ data: { patientId: p.id, ...data.coverage } });
    }
    return p;
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_CREATED',
    resourceType: 'Patient',
    resourceId: patient.id,
    metadata: { hadAddress: !!data.address, hadCoverage: !!data.coverage },
  });

  return NextResponse.json({ data: { id: patient.id } });
}
