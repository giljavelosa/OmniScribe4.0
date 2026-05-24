/**
 * Unit 48 PR3 — IntentAwareBriefCard rendering tests.
 *
 * Coverage:
 *   - Renders spine sections (GoalLedger + MedicalNecessityScaffold)
 *     when intent === REHAB_PROGRESS_NOTE and spine data is present.
 *   - Renders graceful empty banners when spine data is missing.
 *   - Pre-PR3 fixture content with no intent renders WITHOUT spine
 *     content (the spineSlot stays null on BriefCard) — back-compat.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EncounterIntent } from '@prisma/client';

import { IntentAwareBriefCard } from '@/components/brief/intent-aware-brief-card';
import { BriefCard } from '@/components/brief/brief-card';
import type { PriorContextBriefContent } from '@/types/brief';

const NOW_MS = new Date('2026-05-26T12:00:00Z').getTime();

function basePreContent(): PriorContextBriefContent {
  return {
    patientOneLine: '68F, R shoulder',
    episodeContext: {
      episodeId: 'ep_1',
      label: 'R shoulder',
      visitNumber: 10,
      plannedVisits: 12,
    },
    lastVisit: {
      noteId: 'nt_1',
      date: '2026-04-22',
      daysAgo: 34,
      clinicianName: 'Dr. Smith',
      noteType: 'progress',
      templateName: 'PT Progress',
    },
    chiefConcern: 'R shoulder pain post-fall.',
    priorAssessment: 'Improving slowly.',
    trajectory: { summary: 'Pain ↓', direction: 'improving' },
    objectiveMeasures: [],
    interventionsPerformed: ['GH mob'],
    homeProgram: 'Band rows 3×10',
    educationGiven: [],
    carryForwardPlan: ['Progress to red bands'],
    topActiveGoals: [],
    watch: {
      recentMedChanges: [],
      recentResults: [],
      precautions: [],
      redFlagsFromPriorNote: [],
    },
    sourceNoteIds: ['nt_1'],
    generatedAt: '2026-04-22T17:00:00.000Z',
    generatorVersion: 'llm-v1-intent-rehab-progress',
    openFollowUps: [],
  };
}

describe('IntentAwareBriefCard — REHAB_PROGRESS_NOTE', () => {
  it('renders GoalLedger when content.goalLedger is present', () => {
    const content = {
      ...basePreContent(),
      intent: EncounterIntent.REHAB_PROGRESS_NOTE,
      goalLedger: [
        {
          goalText: 'AROM flex to 150°',
          goalType: 'LTG' as const,
          status: 'ACTIVE' as const,
          delta: '95° → 125°',
          sourceNoteId: 'nt_1',
        },
        {
          goalText: 'Pain ≤ 2/10',
          goalType: 'STG' as const,
          status: 'PARTIALLY_MET' as const,
          delta: '7 → 4',
          sourceNoteId: 'nt_1',
        },
      ],
      medicalNecessity: {
        remainingLimitations: 'Cannot lift > 5 lbs.',
        whySkilledCare: 'Manual mob still required.',
        pocJustification: 'On track for 4 more weeks.',
      },
    } as PriorContextBriefContent;
    render(
      <IntentAwareBriefCard
        content={content}
        patientName="Maria González"
        intent={EncounterIntent.REHAB_PROGRESS_NOTE}
        nowMs={NOW_MS}
      />,
    );
    expect(screen.getByTestId('intent-aware-spine')).toBeInTheDocument();
    expect(screen.getByTestId('goal-ledger')).toBeInTheDocument();
    expect(screen.getAllByTestId('goal-ledger-row')).toHaveLength(2);
    expect(screen.getByTestId('medical-necessity-scaffold')).toBeInTheDocument();
    expect(screen.getAllByTestId('medical-necessity-field')).toHaveLength(3);
  });

  it('renders graceful empty banners when spine data is missing', () => {
    // LLM dropped both spine fields — renderer must not crash.
    const content = {
      ...basePreContent(),
      intent: EncounterIntent.REHAB_PROGRESS_NOTE,
    } as PriorContextBriefContent;
    render(
      <IntentAwareBriefCard
        content={content}
        patientName="Maria G."
        intent={EncounterIntent.REHAB_PROGRESS_NOTE}
        nowMs={NOW_MS}
      />,
    );
    // The spine container still renders (intent IS supported), but
    // the inner sections show their unavailable banners.
    expect(screen.getByTestId('intent-aware-spine')).toBeInTheDocument();
    expect(screen.getByText(/Goal ledger unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Medical-necessity scaffold unavailable/)).toBeInTheDocument();
  });
});

// =============================================================================
// Back-compat — pre-PR3 BriefCard (no spineSlot) must render the same
// stuff without the intent-aware spine container.
// =============================================================================

describe('BriefCard — pre-PR3 back-compat (no spineSlot)', () => {
  it('does NOT render the intent-aware spine container when spineSlot is omitted', () => {
    render(
      <BriefCard
        content={basePreContent()}
        patientName="Maria G."
        nowMs={NOW_MS}
      />,
    );
    expect(screen.queryByTestId('intent-aware-spine')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-ledger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('medical-necessity-scaffold')).not.toBeInTheDocument();
  });

  it('renders identical core sections (Why / Last clinical impression / Trajectory) with vs. without spineSlot', () => {
    // The spineSlot prop is purely additive — when undefined, the
    // card's other sections render unchanged. This is the
    // byte-for-byte-behavior assertion that backs Decision 11.
    const { container: withoutSlot } = render(
      <BriefCard
        content={basePreContent()}
        patientName="Maria G."
        nowMs={NOW_MS}
      />,
    );
    const withoutSlotHtml = withoutSlot.innerHTML;

    // Same content + same patient + `spineSlot={null}` (explicit null)
    // — equivalent to omitting. DOM should be byte-identical.
    const { container: withNullSlot } = render(
      <BriefCard
        content={basePreContent()}
        patientName="Maria G."
        nowMs={NOW_MS}
        spineSlot={null}
      />,
    );
    expect(withNullSlot.innerHTML).toBe(withoutSlotHtml);
  });
});
