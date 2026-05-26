import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// POST /api/ai-command/log — Tier 2 telemetry sink for the home AI panel.
//
// What's under test:
//   - Auth gate (401 when no session).
//   - Body validation (400 on bad payload).
//   - Classifier integration: every accepted body produces an audit row
//     whose metadata is the structural shape ONLY (no user-typed text).
//   - PHI fence: the raw query is NOT in the audit metadata.
// ---------------------------------------------------------------------------

const auth = vi.fn();
const writeAuditLog = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

import { POST } from '@/app/api/ai-command/log/route';

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/ai-command/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({
    user: { id: 'user_clinician', orgId: 'org_1' },
  });
  writeAuditLog.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/ai-command/log — auth', () => {
  it('returns 401 when no session', async () => {
    auth.mockResolvedValue(null);
    const res = await POST(postReq({ query: 'drafts', surface: 'home-desktop' }));
    expect(res.status).toBe(401);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 401 when session has no user.orgId (multi-tenant gate)', async () => {
    auth.mockResolvedValue({ user: { id: 'user_x' } });
    const res = await POST(postReq({ query: 'drafts', surface: 'home-desktop' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/ai-command/log — body validation', () => {
  it('returns 400 for an empty query', async () => {
    const res = await POST(postReq({ query: '', surface: 'home-desktop' }));
    expect(res.status).toBe(400);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown surface value', async () => {
    const res = await POST(
      postReq({ query: 'drafts', surface: 'definitely-not-a-surface' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a query over the 500-char ceiling', async () => {
    const huge = 'A'.repeat(501);
    const res = await POST(postReq({ query: huge, surface: 'home-desktop' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-JSON bodies', async () => {
    const res = await POST(
      new Request('http://localhost/api/ai-command/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{{{',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ai-command/log — happy path', () => {
  it('classifies "drafts" → command, writes audit row, returns the shape', async () => {
    const res = await POST(postReq({ query: 'drafts', surface: 'home-desktop' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { ok: boolean; pattern: string; commandVerb: string | null };
    };
    expect(body.data.ok).toBe(true);
    expect(body.data.pattern).toBe('looks_like_command');
    expect(body.data.commandVerb).toBe('drafts');

    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_PANEL_QUERY',
        userId: 'user_clinician',
        orgId: 'org_1',
        resourceType: 'AiCommandPanel',
        metadata: expect.objectContaining({
          pattern: 'looks_like_command',
          commandVerb: 'drafts',
          queryLength: 6,
          wordCount: 1,
          surface: 'home-desktop',
        }),
      }),
    );
  });

  it('classifies a name search and emits the right shape', async () => {
    const res = await POST(
      postReq({ query: 'Maria Alvarez', surface: 'home-desktop' }),
    );
    expect(res.status).toBe(200);
    expect(writeAuditLog.mock.calls[0]?.[0].metadata).toEqual({
      pattern: 'looks_like_name',
      commandVerb: null,
      queryLength: 'Maria Alvarez'.length,
      wordCount: 2,
      surface: 'home-desktop',
    });
  });

  it('mobile surface is recorded distinctly from desktop', async () => {
    await POST(postReq({ query: 'today', surface: 'home-mobile' }));
    expect(writeAuditLog.mock.calls[0]?.[0].metadata.surface).toBe('home-mobile');
  });
});

describe('POST /api/ai-command/log — PHI fence', () => {
  it('NEVER writes the user-typed query into audit metadata', async () => {
    // The clinician might type a patient name; the audit metadata
    // must hold only the structural shape, never the raw text.
    const sensitiveQuery = 'Maria Alvarez DOB 1949';
    await POST(postReq({ query: sensitiveQuery, surface: 'home-desktop' }));

    const metadata = writeAuditLog.mock.calls[0]?.[0].metadata as Record<string, unknown>;
    const flatJson = JSON.stringify(metadata);
    expect(flatJson).not.toContain('Maria');
    expect(flatJson).not.toContain('Alvarez');
    expect(flatJson).not.toContain('1949');
    expect(flatJson).not.toContain('DOB');
  });

  it('only writes whitelisted metadata keys (closed schema)', async () => {
    await POST(postReq({ query: 'drafts', surface: 'home-desktop' }));
    const metadata = writeAuditLog.mock.calls[0]?.[0].metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(
      ['commandVerb', 'pattern', 'queryLength', 'surface', 'wordCount'].sort(),
    );
  });
});
