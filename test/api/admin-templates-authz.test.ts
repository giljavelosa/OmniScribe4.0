import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Option A — clinician personal templates authz tests.
 *
 * Locks the row-level guards on `/api/admin/templates/**`:
 *   - POST: non-admin callers may only create PERSONAL templates.
 *   - PATCH: non-admin callers may only edit their own PERSONAL row;
 *           may not flip visibility to TEAM/PUBLIC.
 *   - Archive: non-admin callers may only archive their own PERSONAL.
 *   - Clone: non-admin clones must land as PERSONAL.
 *   - ORG_ADMIN keeps full authority (regression).
 *
 * All Prisma + audit + authz dependencies are mocked so we drive the
 * route handlers without a database.
 */

const templateCreate = vi.fn();
const templateFindUnique = vi.fn();
const templateUpdate = vi.fn();
const auditLogCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    noteTemplate: {
      create: (...a: unknown[]) => templateCreate(...a),
      findUnique: (...a: unknown[]) => templateFindUnique(...a),
      update: (...a: unknown[]) => templateUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

const assertOrgScoped = vi.fn();
vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: (...a: unknown[]) => assertOrgScoped(...a),
}));

import { POST as createTemplate } from '@/app/api/admin/templates/route';
import { PATCH as patchTemplate } from '@/app/api/admin/templates/[id]/route';
import { POST as archiveTemplate } from '@/app/api/admin/templates/[id]/archive/route';
import { POST as cloneTemplate } from '@/app/api/admin/templates/[id]/clone/route';

const ORG_ID = 'org_1';
const CLINICIAN_ID = 'ou_clinician';
const OTHER_CLINICIAN_ID = 'ou_other';
const ADMIN_ID = 'ou_admin';
const TPL_ID = 'tpl_1';

function clinicianGuard() {
  return {
    user: { id: 'user_clinician' },
    authorizationUser: {
      userId: 'user_clinician',
      orgUserId: CLINICIAN_ID,
      orgId: ORG_ID,
      role: 'CLINICIAN',
      canManagePatients: false,
    },
  };
}
function adminGuard() {
  return {
    user: { id: 'user_admin' },
    authorizationUser: {
      userId: 'user_admin',
      orgUserId: ADMIN_ID,
      orgId: ORG_ID,
      role: 'ORG_ADMIN',
      canManagePatients: true,
    },
  };
}

function defaultSectionSchema() {
  return {
    sections: [
      { id: 'notes', label: 'Notes', required: true, promptHint: 'Free-form.' },
    ],
  };
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TPL_ID,
    orgId: ORG_ID,
    name: 'Test',
    description: null,
    division: 'MEDICAL',
    specialty: null,
    visibility: 'PERSONAL',
    isPreset: false,
    isArchived: false,
    sectionSchema: defaultSectionSchema(),
    promptHints: null,
    sensitivityDefault: 'STANDARD_CLINICAL',
    version: 1,
    createdByOrgUserId: CLINICIAN_ID,
    clonedFromId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    archivedByOrgUserId: null,
    ...overrides,
  };
}

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  templateCreate.mockReset();
  templateFindUnique.mockReset();
  templateUpdate.mockReset();
  auditLogCreate.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();
  assertOrgScoped.mockReset();
  templateCreate.mockResolvedValue(templateRow());
  templateUpdate.mockImplementation(({ data }) =>
    Promise.resolve(templateRow(data as Record<string, unknown>)),
  );
});

// ---------------------------------------------------------------------------
// POST /api/admin/templates
// ---------------------------------------------------------------------------

describe('POST /api/admin/templates — visibility coercion', () => {
  it('allows CLINICIAN to create PERSONAL', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    const res = await createTemplate(
      jsonReq('http://x/api/admin/templates', {
        name: 'Mine',
        division: 'MEDICAL',
        visibility: 'PERSONAL',
        sectionSchema: defaultSectionSchema(),
      }),
    );
    expect(res.status).toBe(201);
    expect(templateCreate).toHaveBeenCalled();
  });

  it('rejects CLINICIAN attempting visibility=TEAM', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    const res = await createTemplate(
      jsonReq('http://x/api/admin/templates', {
        name: 'Shared?',
        division: 'MEDICAL',
        visibility: 'TEAM',
        sectionSchema: defaultSectionSchema(),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('visibility_forbidden');
    expect(templateCreate).not.toHaveBeenCalled();
  });

  it('allows ORG_ADMIN to create TEAM (regression)', async () => {
    requireFeatureAccess.mockResolvedValueOnce(adminGuard());
    const res = await createTemplate(
      jsonReq('http://x/api/admin/templates', {
        name: 'Org template',
        division: 'MEDICAL',
        visibility: 'TEAM',
        sectionSchema: defaultSectionSchema(),
      }),
    );
    expect(res.status).toBe(201);
    expect(templateCreate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/templates/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/templates/[id] — non-admin row guards', () => {
  const params = Promise.resolve({ id: TPL_ID });

  it('allows CLINICIAN to PATCH their own PERSONAL', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(templateRow());
    const res = await patchTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}`, { name: 'Renamed' }),
      { params },
    );
    expect(res.status).toBe(200);
  });

  it('rejects CLINICIAN PATCH on TEAM template', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(
      templateRow({ visibility: 'TEAM', createdByOrgUserId: ADMIN_ID }),
    );
    const res = await patchTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}`, { name: 'Tampered' }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it('rejects CLINICIAN PATCH on another clinician PERSONAL', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(
      templateRow({ createdByOrgUserId: OTHER_CLINICIAN_ID }),
    );
    const res = await patchTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}`, { name: 'Stolen' }),
      { params },
    );
    expect(res.status).toBe(403);
  });

  it('rejects CLINICIAN attempting visibility=TEAM flip', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(templateRow());
    const res = await patchTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}`, {
        visibility: 'TEAM',
      }),
      { params },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('visibility_forbidden');
  });

  it('rejects PATCH on preset for everyone', async () => {
    requireFeatureAccess.mockResolvedValueOnce(adminGuard());
    templateFindUnique.mockResolvedValueOnce(
      templateRow({ isPreset: true, orgId: null }),
    );
    const res = await patchTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}`, { name: 'Edit preset' }),
      { params },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Archive /api/admin/templates/[id]/archive
// ---------------------------------------------------------------------------

describe('POST archive — non-admin row guards', () => {
  const params = Promise.resolve({ id: TPL_ID });

  it('allows CLINICIAN to archive their own PERSONAL', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(templateRow());
    const res = await archiveTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}/archive`, {
        action: 'archive',
      }),
      { params },
    );
    expect(res.status).toBe(200);
  });

  it('rejects CLINICIAN archive on TEAM template', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(
      templateRow({ visibility: 'TEAM', createdByOrgUserId: ADMIN_ID }),
    );
    const res = await archiveTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}/archive`, {
        action: 'archive',
      }),
      { params },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Clone /api/admin/templates/[id]/clone
// ---------------------------------------------------------------------------

describe('POST clone — non-admin visibility coercion', () => {
  const params = Promise.resolve({ id: TPL_ID });

  it('allows CLINICIAN to clone a preset into PERSONAL', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(
      templateRow({ isPreset: true, orgId: null, visibility: 'PUBLIC' }),
    );
    const res = await cloneTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}/clone`, {
        name: 'My fork',
        visibility: 'PERSONAL',
      }),
      { params },
    );
    expect(res.status).toBe(201);
    expect(templateCreate).toHaveBeenCalled();
  });

  it('rejects CLINICIAN clone with visibility=TEAM', async () => {
    requireFeatureAccess.mockResolvedValueOnce(clinicianGuard());
    templateFindUnique.mockResolvedValueOnce(
      templateRow({ isPreset: true, orgId: null, visibility: 'PUBLIC' }),
    );
    const res = await cloneTemplate(
      jsonReq(`http://x/api/admin/templates/${TPL_ID}/clone`, {
        name: 'Team fork',
        visibility: 'TEAM',
      }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(templateCreate).not.toHaveBeenCalled();
  });
});
