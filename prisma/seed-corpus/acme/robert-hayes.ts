import { Division } from '@prisma/client';
import { handout, type SeedVisitCorpus } from '../helpers';
import { ACME_ORG_ID, ACME_SITE_NORTH } from './rachel-kim';

const PID = 'seed-acme-patient-rehab';
const EP = 'seed-acme-episode-rehab';

/** Robert Hayes — chronic low back pain, Acme North Rehab. */
export const ROBERT_HAYES_VISITS: SeedVisitCorpus[] = [
  {
    noteId: 'seed-acme-visit-rh-pt-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_NORTH,
    patientId: PID,
    patientFirstName: 'Robert',
    clinicianEmail: 'pt.nguyen@acme.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 42,
    departmentKey: 'rehab',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `PT eval — 62M with 4-month hx mechanical low back pain after lifting landscaping stones. Pain 6/10 daily, 8/10 with prolonged sitting >45 min. Radiates to R buttock, not below knee. No bowel/bladder changes. Prior MRI L4-L5 bulge (outside records reviewed). Goal: return to gardening without pain.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `ROM: Lumbar flexion 60° (limited by pain), ext 15°. SLR R 70° (+ buttock), L 80°.
MMT: hip abductors 4/5, extensors 4+/5.
Special: FABER (−), centralization with repeated extension ×10.
Posture: increased lumbar lordosis, antalgic lean R.
Oswestry: 38% (moderate disability).`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `McKenzie directional preference assessment — extension bias identified.
Manual: lumbar mobilization grade III central PA glides.
Ther ex: prone press-ups 2×10, bird-dog 2×8, clamshells 2×12.
Modalities: heat 10 min.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Pain 4/10 post-extension exercises (from 6/10). Understands HEP.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG: Oswestry <20% — baseline 38%.
STG: Pain ≤4/10 with sitting 60 min — not met.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `PT 2×/week ×8 weeks at Acme North. HEP: press-ups, bird-dog, walking 20 min daily. Avoid prolonged flexion loading.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Tell me when the back pain started and what makes it worse.' },
      { speaker: 'PATIENT', text: 'Moving mulch bags in April. Sitting at my desk kills me after an hour.' },
      { speaker: 'CLINICIAN', text: 'Extension movements centralize your pain — that is a good sign for mechanical back pain.' },
      { speaker: 'PATIENT', text: 'I need to get back to my garden this summer.' },
    ],
    handout: handout(
      'Your back pain responds to extension exercises. Do press-ups and walking daily. Avoid long slumped sitting.',
      ['Press-ups 10 reps twice daily', 'Bird-dog 8 reps each side', 'Walk 20 minutes daily', 'PT twice weekly at North campus'],
      ['Leg weakness', 'Numbness in groin', 'Loss of bladder control'],
      ['Any red-flag symptoms — call immediately'],
    ),
  },
  {
    noteId: 'seed-acme-visit-rh-pt-1',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_NORTH,
    patientId: PID,
    patientFirstName: 'Robert',
    clinicianEmail: 'pt.nguyen@acme.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 28,
    departmentKey: 'rehab',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 4. Pain 4/10 avg, 6/10 after long drive. HEP 6/7 days. Using lumbar roll at desk — helps.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Flexion 70°, ext 20°. Oswestry 28% (improved from 38%).
Single-leg stance 15 sec bilaterally.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Progression: press-ups 3×12, dead bug 3×10, band walks 2×15.
Core stabilization on reformer 10 min.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Tolerated well. Pain 3/10 post.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `Oswestry improving. Sitting tolerance ~50 min.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue 2×/week. Add light resistance training next visit.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Oswestry down ten points — how is sitting at work?' },
      { speaker: 'PATIENT', text: 'Lumbar roll helps. Still stiff after a long commute.' },
    ],
    handout: handout(
      'Back improving — keep core exercises and use lumbar support when sitting.',
      ['Continue HEP daily', 'Lumbar roll at desk', 'PT twice weekly'],
      ['New leg numbness', 'Worsening pain down the leg'],
      ['Red-flag symptoms'],
    ),
  },
  {
    noteId: 'seed-acme-visit-rh-pt-2',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_NORTH,
    patientId: PID,
    patientFirstName: 'Robert',
    clinicianEmail: 'pt.nguyen@acme.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 10,
    departmentKey: 'rehab',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 8. Pain 2–3/10. Gardened 30 min Saturday with breaks — mild soreness after, resolved overnight. Sitting tolerance 90 min.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Flexion 80°, ext 25°. Oswestry 18% — LTG nearly met.
Lift simulation 20 lb from squat — proper mechanics, no pain.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Functional training: squat/lift mechanics, rake simulation, walking on uneven surface.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Confident with gardening pacing strategies.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG Oswestry <20% — MET at 18%.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `2 more visits then discharge with HEP maintenance. Flare plan reviewed.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'You hit your disability score goal. Tell me about gardening Saturday.' },
      { speaker: 'PATIENT', text: 'Thirty minutes with breaks — little soreness but nothing like before.' },
      { speaker: 'CLINICIAN', text: 'Two more sessions and we transition you to independent maintenance.' },
    ],
    handout: handout(
      'You met your back pain goals. Keep exercising and use pacing when gardening.',
      ['Maintenance HEP 3× weekly', 'Pace gardening with breaks', '2 final PT visits'],
      ['Return of leg numbness', 'Pain above 7/10 for more than 3 days'],
      ['Call if symptoms regress'],
    ),
  },
];
