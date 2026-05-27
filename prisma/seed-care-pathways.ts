/**
 * Sprint 0.19 / Tier 12 — Care Pathway library starter corpus.
 *
 * Five platform-default pathways covering the most common cross-cutting
 * conditions: T2DM, HTN, depression (PHQ-9 stepped care), low back pain,
 * and knee osteoarthritis. Each pathway has 4-6 ordered steps with
 * `requiredElementsJson` checklists the compare-to-pathway sub-LLM
 * uses to flag documentation gaps.
 *
 * Seeded per-org via `seedCarePathwaysForOrg(prisma, orgId)`. Idempotent
 * (skips if a pathway with the same (orgId, primaryIcd, version) already
 * exists). Safe to re-run.
 *
 * Evidence sources are paraphrased high-level references — not direct
 * quotations. Orgs are expected to override / customize per their own
 * protocols.
 */

import type { PrismaClient } from '@prisma/client';
import { Division } from '@prisma/client';

type PathwayDefinition = {
  name: string;
  primaryIcd: string;
  primaryIcdLabel: string;
  division: Division;
  evidenceSource: string;
  steps: Array<{
    ordinal: number;
    title: string;
    description: string;
    requiredElements: string[];
  }>;
};

const STARTER_PATHWAYS: PathwayDefinition[] = [
  // ---- T2DM (E11.9) ----
  {
    name: 'Type 2 Diabetes — adult stepped care',
    primaryIcd: 'E11.9',
    primaryIcdLabel: 'Type 2 diabetes mellitus without complications',
    division: Division.MEDICAL,
    evidenceSource: 'ADA Standards of Care (general)',
    steps: [
      {
        ordinal: 1,
        title: 'Baseline assessment + labs',
        description:
          'A1c, fasting lipid panel, eGFR + UACR, foot exam, BP. Establish baseline weight, smoking status, and physical-activity baseline.',
        requiredElements: ['A1c documented', 'BP documented', 'foot exam documented', 'eGFR or kidney panel documented'],
      },
      {
        ordinal: 2,
        title: 'Lifestyle counseling + DSMES referral',
        description:
          'Nutrition + activity counseling at diagnosis; refer to Diabetes Self-Management Education and Support (DSMES).',
        requiredElements: ['lifestyle counseling documented', 'DSMES referral status documented'],
      },
      {
        ordinal: 3,
        title: 'Initiate metformin (if not contraindicated)',
        description:
          'First-line: metformin titrated to tolerance. Document renal function check before initiating. If contraindicated, document the contraindication + alternative.',
        requiredElements: ['metformin initiation or contraindication documented'],
      },
      {
        ordinal: 4,
        title: 'A1c follow-up at 3 months',
        description:
          'Recheck A1c at ~3 months. If above goal, intensify (add 2nd agent — GLP-1, SGLT2, etc. — per comorbidities).',
        requiredElements: ['follow-up A1c documented', 'intensification plan if above goal'],
      },
      {
        ordinal: 5,
        title: 'Annual screenings + comorbid risk',
        description:
          'Annual dilated eye exam, foot exam, lipid panel, UACR, and ASCVD risk assessment. Vaccinations: pneumococcal, influenza, hepatitis B per CDC guidance.',
        requiredElements: [
          'annual eye exam status documented',
          'annual foot exam documented',
          'lipid panel within 12 months',
          'ASCVD risk discussed',
        ],
      },
    ],
  },
  // ---- HTN (I10) ----
  {
    name: 'Essential hypertension — adult management',
    primaryIcd: 'I10',
    primaryIcdLabel: 'Essential (primary) hypertension',
    division: Division.MEDICAL,
    evidenceSource: 'ACC/AHA general guidance',
    steps: [
      {
        ordinal: 1,
        title: 'Confirm with home or out-of-office readings',
        description:
          'Confirm elevated office BP with home BP monitoring or ABPM before initiating long-term therapy.',
        requiredElements: ['home or repeat-office BP readings documented'],
      },
      {
        ordinal: 2,
        title: 'Risk stratification + baseline labs',
        description:
          'BMP, lipid panel, urinalysis, EKG. Calculate 10-year ASCVD risk. Assess for end-organ damage.',
        requiredElements: ['baseline BMP + lipids documented', 'ASCVD risk documented'],
      },
      {
        ordinal: 3,
        title: 'Lifestyle counseling',
        description:
          'DASH diet, sodium <1500 mg/day, regular aerobic activity, weight management, alcohol moderation, smoking cessation.',
        requiredElements: ['lifestyle counseling documented'],
      },
      {
        ordinal: 4,
        title: 'Initiate pharmacotherapy if indicated',
        description:
          'For stage-1 HTN with high CV risk or stage-2 HTN: first-line ACEi/ARB, thiazide, or CCB. Document choice + rationale.',
        requiredElements: ['medication initiation or non-pharm plan documented'],
      },
      {
        ordinal: 5,
        title: 'Recheck at 4 weeks; titrate to goal',
        description:
          'Recheck BP + assess tolerance; titrate or add agent until at goal (<130/80 for most adults).',
        requiredElements: ['follow-up BP documented', 'titration or maintenance plan documented'],
      },
    ],
  },
  // ---- Major depressive disorder (F32.9) — PHQ-9 stepped care ----
  {
    name: 'Depression — PHQ-9 stepped care',
    primaryIcd: 'F32.9',
    primaryIcdLabel: 'Major depressive disorder, single episode, unspecified',
    division: Division.BEHAVIORAL_HEALTH,
    evidenceSource: 'USPSTF + collaborative care evidence',
    steps: [
      {
        ordinal: 1,
        title: 'PHQ-9 baseline + safety assessment',
        description:
          'Document PHQ-9 baseline score. If item-9 positive (suicidality), perform safety assessment + document plan before any other step.',
        requiredElements: ['PHQ-9 score documented', 'suicide-risk assessment documented if item-9 positive'],
      },
      {
        ordinal: 2,
        title: 'Psychoeducation + treatment-option discussion',
        description:
          'Educate on diagnosis + the evidence-based options (psychotherapy, medication, combination). Shared decision-making documented.',
        requiredElements: ['psychoeducation documented', 'patient preference documented'],
      },
      {
        ordinal: 3,
        title: 'Initiate first-line treatment',
        description:
          'For mild-moderate: psychotherapy (CBT, IPT) or SSRI. For moderate-severe: combination. Document choice + side-effect counseling.',
        requiredElements: ['treatment initiation documented', 'side-effect counseling documented if medication'],
      },
      {
        ordinal: 4,
        title: 'Re-measure PHQ-9 at 4-6 weeks',
        description:
          'Re-measure PHQ-9. Response = ≥50% reduction; remission = PHQ-9 <5. If not responding, intensify (dose, switch, augment, or add therapy).',
        requiredElements: ['follow-up PHQ-9 documented', 'response/non-response assessment documented'],
      },
      {
        ordinal: 5,
        title: 'Maintain for 6-12 months after remission',
        description:
          'For first episode, continue treatment 6-12 months after remission to reduce relapse risk. For recurrent episodes, longer maintenance.',
        requiredElements: ['maintenance plan documented'],
      },
    ],
  },
  // ---- Low back pain (M54.50) ----
  {
    name: 'Low back pain — acute / subacute management',
    primaryIcd: 'M54.50',
    primaryIcdLabel: 'Low back pain, unspecified',
    division: Division.REHAB,
    evidenceSource: 'ACP guideline + APTA clinical practice',
    steps: [
      {
        ordinal: 1,
        title: 'Red-flag screen',
        description:
          'Screen for cauda equina, fracture, infection, malignancy, inflammatory arthritis. Document negative red-flag screen or referral path if positive.',
        requiredElements: ['red-flag screen documented'],
      },
      {
        ordinal: 2,
        title: 'Functional baseline',
        description:
          'Document pain (NPRS), function (Oswestry or modified Oswestry), and activity limitations. Establish patient-meaningful goals.',
        requiredElements: ['pain score documented', 'function score documented', 'goal documented'],
      },
      {
        ordinal: 3,
        title: 'Non-pharmacologic first-line',
        description:
          'For acute: superficial heat, massage, acupuncture, spinal manipulation. For subacute/chronic: exercise, multidisciplinary rehab, mindfulness-based stress reduction, CBT, progressive relaxation, low-level laser therapy.',
        requiredElements: ['non-pharm intervention documented'],
      },
      {
        ordinal: 4,
        title: 'Reassess at 2-4 weeks',
        description:
          'Re-measure pain + function. If improving, continue. If not improving, consider imaging only if red flags emerge or persistent severe symptoms.',
        requiredElements: ['follow-up pain + function documented'],
      },
      {
        ordinal: 5,
        title: 'Avoid early imaging + opioids',
        description:
          'Document rationale for any imaging within 6 weeks. Avoid opioids; if used, document indication + limited duration.',
        requiredElements: ['imaging decision documented', 'opioid decision documented'],
      },
    ],
  },
  // ---- Knee OA (M17.10) ----
  {
    name: 'Knee osteoarthritis — non-operative management',
    primaryIcd: 'M17.10',
    primaryIcdLabel: 'Unilateral primary osteoarthritis of unspecified knee',
    division: Division.REHAB,
    evidenceSource: 'OARSI / AAOS general guidance',
    steps: [
      {
        ordinal: 1,
        title: 'Functional + symptom assessment',
        description:
          'Document pain (NPRS), KOOS or WOMAC, ROM, MMT, gait observation, activity limitations.',
        requiredElements: ['pain score documented', 'function measure documented (KOOS/WOMAC)', 'ROM documented'],
      },
      {
        ordinal: 2,
        title: 'Patient education + weight management',
        description:
          'Educate on disease course; encourage activity modification + weight loss if BMI elevated.',
        requiredElements: ['education documented', 'weight discussion documented'],
      },
      {
        ordinal: 3,
        title: 'Land-based exercise program',
        description:
          'Quadriceps strengthening, neuromuscular training, aerobic conditioning. 2-3 sessions/week with supervised + home program.',
        requiredElements: ['exercise prescription documented', 'home program documented'],
      },
      {
        ordinal: 4,
        title: 'Adjuncts (as needed)',
        description:
          'Topical NSAIDs first-line for pharm; oral NSAIDs short-term if needed. Consider bracing, manual therapy, modalities per response.',
        requiredElements: ['adjunct or none documented'],
      },
      {
        ordinal: 5,
        title: 'Reassess at 6 weeks',
        description:
          'Re-measure pain + function. If no meaningful improvement, escalate (injection consult, surgical eval).',
        requiredElements: ['follow-up reassessment documented'],
      },
    ],
  },
];

export async function seedCarePathwaysForOrg(prisma: PrismaClient, orgId: string): Promise<void> {
  for (const pathway of STARTER_PATHWAYS) {
    // Idempotency check: skip if a pathway with the same key already exists
    // for this org. (Org admins are free to add custom versions; we don't
    // overwrite.)
    const existing = await prisma.carePathway.findFirst({
      where: { orgId, primaryIcd: pathway.primaryIcd, version: 'v1', isDeleted: false },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.carePathway.create({
      data: {
        orgId,
        name: pathway.name,
        primaryIcd: pathway.primaryIcd,
        primaryIcdLabel: pathway.primaryIcdLabel,
        division: pathway.division,
        evidenceSource: pathway.evidenceSource,
        version: 'v1',
        steps: {
          create: pathway.steps.map((s) => ({
            ordinal: s.ordinal,
            title: s.title,
            description: s.description,
            requiredElementsJson: s.requiredElements,
          })),
        },
      },
    });
  }
}
