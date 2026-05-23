import { describe, expect, it } from 'vitest';

import {
  CaseAwarenessJsonSchema,
  ConversationFactsJsonSchema,
  ObservedPatternsJsonSchema,
  detectGoalStalled,
  detectMeasureTrend,
  detectRecertDueSoon,
  detectTopicMentionedUnaddressed,
} from '@/services/copilot/state-builder';

/**
 * Sprint 0.14 — state-builder unit tests.
 *
 * Coverage:
 *   - Each pattern detector fires + cites correctly.
 *   - Each detector is a pure function (idempotent).
 *   - Zod schemas accept the output shapes.
 */

const ONE_DAY = 86_400_000;

function noteWithTranscript(
  id: string,
  daysAgo: number,
  transcript: string,
  planContent: string,
) {
  return {
    id,
    signedAt: new Date(Date.now() - daysAgo * ONE_DAY),
    transcriptClean: { plaintext: transcript } as never,
    finalJson: {
      sections: [{ id: 'plan', label: 'Plan', content: planContent }],
    } as never,
  };
}

describe('detectTopicMentionedUnaddressed', () => {
  it('fires when a topic appears in 3+ consecutive notes but never in plan', () => {
    const notes = [
      noteWithTranscript('n1', 1, 'patient reports trouble with sleep', 'continue lisinopril'),
      noteWithTranscript('n2', 8, 'sleep again poor', 'recheck BP in 4 weeks'),
      noteWithTranscript('n3', 15, 'sleeping badly', 'add amlodipine'),
    ];
    const out = detectTopicMentionedUnaddressed(notes);
    const sleep = out.find((p) => p.detail.topic === 'sleep');
    expect(sleep).toBeDefined();
    expect(sleep!.observedInNoteIds).toEqual(['n1', 'n2', 'n3']);
    expect(sleep!.count).toBe(3);
    expect(sleep!.kind).toBe('topic_mentioned_unaddressed');
  });

  it('does not fire when the topic is addressed in the plan', () => {
    const notes = [
      noteWithTranscript('n1', 1, 'reports trouble with sleep', 'discuss sleep hygiene'),
      noteWithTranscript('n2', 8, 'sleep still poor', 'continue plan'),
      noteWithTranscript('n3', 15, 'sleeping badly', 'try melatonin per protocol'),
    ];
    const out = detectTopicMentionedUnaddressed(notes);
    expect(out.find((p) => p.detail.topic === 'sleep')).toBeUndefined();
  });

  it('does not fire when fewer than 3 notes mention the topic', () => {
    const notes = [
      noteWithTranscript('n1', 1, 'sleep poor', 'continue lisinopril'),
      noteWithTranscript('n2', 8, 'no concerns', 'continue'),
      noteWithTranscript('n3', 15, 'no concerns', 'continue'),
    ];
    const out = detectTopicMentionedUnaddressed(notes);
    expect(out.find((p) => p.detail.topic === 'sleep')).toBeUndefined();
  });

  it('is idempotent over the same input', () => {
    const notes = [
      noteWithTranscript('n1', 1, 'sleep poor', 'continue'),
      noteWithTranscript('n2', 8, 'sleep still poor', 'continue'),
      noteWithTranscript('n3', 15, 'sleeping badly', 'continue'),
    ];
    const a = detectTopicMentionedUnaddressed(notes);
    const b = detectTopicMentionedUnaddressed(notes);
    expect(a).toEqual(b);
  });

  it('handles empty / missing transcripts cleanly', () => {
    const notes = [
      { id: 'n1', signedAt: new Date(), transcriptClean: null, finalJson: null },
    ];
    expect(detectTopicMentionedUnaddressed(notes)).toEqual([]);
  });
});

describe('detectMeasureTrend', () => {
  it('fires when a measure has 3+ readings + a non-stable trend', () => {
    const brief = {
      objectiveMeasures: [
        {
          measure: 'Systolic BP',
          lastValue: '142',
          priorValues: ['148', '158'],
          trend: 'improving' as const,
          sourceNoteId: 'src_note',
          measureKey: 'bp',
          unit: 'mmHg',
        },
      ],
      generatedAt: '2026-05-22T12:00:00Z',
    } as never;
    const out = detectMeasureTrend(brief, 'brief_note');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('measure_trend');
    expect(out[0]!.detail.measure).toBe('Systolic BP');
    expect(out[0]!.detail.trend).toBe('improving');
    expect(out[0]!.observedInNoteIds).toContain('src_note');
    expect(out[0]!.observedInNoteIds).toContain('brief_note');
  });

  it('skips stable / unknown trends', () => {
    const brief = {
      objectiveMeasures: [
        {
          measure: 'Weight',
          lastValue: '207',
          priorValues: ['208', '210'],
          trend: 'stable' as const,
          sourceNoteId: 'src',
        },
      ],
      generatedAt: '2026-05-22T12:00:00Z',
    } as never;
    expect(detectMeasureTrend(brief, 'brief')).toEqual([]);
  });

  it('skips measures with <3 total readings', () => {
    const brief = {
      objectiveMeasures: [
        {
          measure: 'HR',
          lastValue: '72',
          priorValues: ['70'],
          trend: 'improving' as const,
          sourceNoteId: 'src',
        },
      ],
      generatedAt: '2026-05-22T12:00:00Z',
    } as never;
    expect(detectMeasureTrend(brief, 'brief')).toEqual([]);
  });

  it('returns empty when no brief is available', () => {
    expect(detectMeasureTrend(null, null)).toEqual([]);
  });
});

describe('detectRecertDueSoon', () => {
  const now = new Date('2026-05-22T00:00:00Z');

  it('fires when recertDueAt falls within the 14-day horizon', () => {
    const due = new Date(now.getTime() + 8 * ONE_DAY);
    const out = detectRecertDueSoon(
      [{ id: 'ep1', diagnosis: 'Right knee OA', recertDueAt: due }],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('recert_due_soon');
    expect(out[0]!.observedInEpisodeIds).toEqual(['ep1']);
    expect(out[0]!.detail.daysUntilDue).toBe(8);
  });

  it('skips episodes outside the horizon', () => {
    const farFuture = new Date(now.getTime() + 30 * ONE_DAY);
    expect(
      detectRecertDueSoon(
        [{ id: 'ep1', diagnosis: 'x', recertDueAt: farFuture }],
        now,
      ),
    ).toEqual([]);
  });

  it('skips episodes with no recertDueAt', () => {
    expect(
      detectRecertDueSoon([{ id: 'ep1', diagnosis: 'x', recertDueAt: null }], now),
    ).toEqual([]);
  });

  it('skips overdue episodes (past now)', () => {
    const past = new Date(now.getTime() - 1 * ONE_DAY);
    expect(
      detectRecertDueSoon([{ id: 'ep1', diagnosis: 'x', recertDueAt: past }], now),
    ).toEqual([]);
  });
});

describe('detectGoalStalled', () => {
  const now = new Date('2026-05-22T00:00:00Z');

  it('fires for an ACTIVE goal with no entry in 28+ days', () => {
    const stale = new Date(now.getTime() - 35 * ONE_DAY);
    const out = detectGoalStalled(
      [
        {
          id: 'ep1',
          goals: [
            {
              id: 'g1',
              goalText: 'LTG flexion to 120°',
              status: 'ACTIVE',
              progressEntries: [{ recordedAt: stale }],
            },
          ],
        },
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('goal_stalled');
    expect(out[0]!.observedInGoalIds).toEqual(['g1']);
    expect(out[0]!.detail.stalledDays).toBe(35);
  });

  it('fires for ACTIVE goals with no entries at all', () => {
    const out = detectGoalStalled(
      [
        {
          id: 'ep1',
          goals: [{ id: 'g1', goalText: 'STG goal', status: 'ACTIVE', progressEntries: [] }],
        },
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.detail.stalledDays).toBeNull();
  });

  it('skips fresh entries', () => {
    const fresh = new Date(now.getTime() - 10 * ONE_DAY);
    const out = detectGoalStalled(
      [
        {
          id: 'ep1',
          goals: [
            {
              id: 'g1',
              goalText: 'g',
              status: 'ACTIVE',
              progressEntries: [{ recordedAt: fresh }],
            },
          ],
        },
      ],
      now,
    );
    expect(out).toEqual([]);
  });

  it('skips non-ACTIVE goals', () => {
    expect(
      detectGoalStalled(
        [
          {
            id: 'ep1',
            goals: [
              { id: 'g1', goalText: 'g', status: 'MET', progressEntries: [] },
            ],
          },
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe('Zod schemas — projection shapes', () => {
  it('accepts a minimal caseAwarenessJson', () => {
    expect(
      CaseAwarenessJsonSchema.safeParse({ cases: [] }).success,
    ).toBe(true);
  });

  it('accepts a populated caseAwarenessJson entry', () => {
    expect(
      CaseAwarenessJsonSchema.safeParse({
        cases: [
          {
            id: 'cm_1',
            primaryIcd: 'M54.81',
            primaryIcdLabel: 'Cervicogenic headache',
            status: 'ACTIVE',
            lastViewerActivityAt: '2026-05-20T00:00:00Z',
            lastViewerDivisionActivityAt: '2026-05-20T00:00:00Z',
            lastActivityAt: '2026-05-20T00:00:00Z',
            routingConfidenceHistory: [
              {
                runId: 'run_1',
                confidence: 'HIGH',
                acceptedAction: 'accepted',
                at: '2026-05-20T00:00:00Z',
              },
            ],
            fhirMirror: null,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts observedPatternsJson with each kind', () => {
    const r = ObservedPatternsJsonSchema.safeParse({
      patterns: [
        {
          kind: 'topic_mentioned_unaddressed',
          label: 'Sleep mentioned in last 3 visits (unaddressed)',
          detail: { topic: 'sleep' },
          observedInNoteIds: ['n1', 'n2', 'n3'],
          count: 3,
          firstSeen: '2026-05-01T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
        {
          kind: 'recert_due_soon',
          label: 'Recert due in 8 days — Right knee OA',
          detail: { episodeId: 'ep1', daysUntilDue: 8 },
          observedInEpisodeIds: ['ep1'],
          observedInNoteIds: [],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts conversationFactsJson with note + follow-up sources', () => {
    expect(
      ConversationFactsJsonSchema.safeParse({
        facts: [
          {
            summary: 'last BP was 138/86',
            sourceNoteId: 'n_abc',
            citedAt: '2026-05-22T00:00:00Z',
          },
          {
            summary: 'morning walks committed',
            sourceFollowUpId: 'fu_abc',
            citedAt: '2026-05-22T00:00:00Z',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
