import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from './helpers';
import { MARIA_ALVAREZ_EXTENDED } from './maria-alvarez-extended';

const PID = 'seed-patient-rehab';
const EP = 'seed-episode-seed-patient-rehab';
const EP_MED = 'seed-episode-ma-medical';

const MARIA_CORE: SeedVisitCorpus[] = [
  {
    noteId: 'seed-visit-ma-md-0',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'clinician@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-acute',
    signedDaysAgo: 49,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'chief_complaint',
        label: 'Chief Complaint',
        content: 'Pre-operative medical clearance for right knee arthroscopy.',
      },
      {
        id: 'hpi',
        label: 'History of Present Illness',
        content: `Maria Alvarez is a 67-year-old female with symptomatic right knee osteoarthritis refractory to conservative management (NSAIDs, intra-articular steroid ×2, PT 6 weeks with partial benefit). Orthopedics recommends diagnostic arthroscopy with possible debridement. Presents for medical clearance.

Knee symptoms: pain 6/10 daily, worse with stairs and prolonged standing; stiffness AM ×30 min. Ambulates with occasional cane outdoors. No systemic symptoms, no knee instability giving-way episodes.

PMH: HTN (amlodipine 5 mg), hypothyroidism (levothyroxine 75 mcg), OA bilateral knees (R > L).
PSH: Cholecystectomy 2010.
Meds: amlodipine 5 mg, levothyroxine 75 mcg, acetaminophen PRN.
Allergies: Sulfa (rash).
Social: Lives alone in apartment; son nearby. Retired teacher. Never smoker.`,
      },
      {
        id: 'exam',
        label: 'Physical Exam',
        content: `Vitals: BP 132/78, HR 68, RR 16, Temp 98.1°F, SpO2 97% RA.
General: Pleasant, NAD.
CV: RRR, no murmurs. RCRI 0 (age >70 adds 1 point → total 1, low perioperative risk).
Lungs: CTAB.
Right knee: Varus alignment mild, effusion small, ROM flex 95° ext 0°, tender medial joint line, stable ligaments.
Labs reviewed: CBC wnl, BMP wnl, A1c 5.8%, INR N/A (not on anticoagulation).`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Pre-operative clearance — low cardiac risk (RCRI 1); medically optimized for arthroscopy.
2. Right knee OA — surgical candidate per ortho.
3. HTN — controlled.
4. Hypothyroidism — stable on current dose.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Cleared for arthroscopy with standard monitoring. Continue home meds day of surgery except hold amlodipine morning of procedure per anesthesia protocol.

Peri-op: DVT prophylaxis per ortho protocol. PT post-op as scheduled.

Follow-up: PCP 6-week post-op wound check (ortho co-managed).`,
      },
      {
        id: 'patient_education',
        label: 'Patient Education',
        content: `Reviewed surgical risks/benefits (already discussed with ortho). Instructed on holding amlodipine morning of surgery, continuing levothyroxine. Provided post-op red-flag sheet.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Maria, orthopedics asked us to clear you for knee surgery. How is the knee feeling day to day?' },
        { speaker: 'PATIENT', text: 'Pain most days, especially stairs. The shots helped a little but not enough.' },
        { speaker: 'CLINICIAN', text: 'Walk me through your medical history — heart, lungs, thyroid.' },
        { speaker: 'PATIENT', text: 'Blood pressure pill and thyroid pill daily. Gallbladder out years ago.' },
        { speaker: 'CLINICIAN', text: 'Any chest pain with exertion, shortness of breath, or recent hospitalizations?' },
        { speaker: 'PATIENT', text: 'No — I climb stairs slowly but no chest pain.' },
        { speaker: 'CLINICIAN', text: 'Sulfa allergy — rash. We will note that for anesthesia.' },
        { speaker: 'CLINICIAN', text: 'Your heart and lung exam look good. Labs are fine. I am clearing you from a medical standpoint.' },
        { speaker: 'PATIENT', text: 'Do I stop any medicines before surgery?' },
        { speaker: 'CLINICIAN', text: 'Skip the amlodipine the morning of surgery — anesthesia will tell you when to stop eating. Keep thyroid pill as usual unless they say otherwise.' },
        { speaker: 'CLINICIAN', text: 'Revised cardiac risk index is low — one point for age. Standard monitoring is appropriate.' },
        { speaker: 'PATIENT', text: 'I live alone — worried about recovery.' },
        { speaker: 'CLINICIAN', text: 'Orthopedics and PT will plan that. OT can help with kitchen tasks after surgery.' },
        { speaker: 'PATIENT', text: 'My son can stay the first night.' },
        { speaker: 'CLINICIAN', text: 'Good support. Watch for infection and blood clot signs — sheet in the handout.' },
        { speaker: 'PATIENT', text: 'When do I see you again?' },
        { speaker: 'CLINICIAN', text: 'Six weeks post-op for wound check unless ortho needs us sooner.' },
      ],
      34,
    ),
    handout: handout(
      'You are cleared for knee surgery. Follow ortho pre-op instructions. Skip blood pressure pill the morning of surgery only.',
      ['Continue levothyroxine unless anesthesia says stop', 'Hold amlodipine morning of surgery', 'Follow ortho fasting instructions', 'Post-op PT as scheduled'],
      ['Chest pain before surgery', 'Fever before surgery'],
      ['Questions about medications before surgery'],
    ),
  },

  {
    noteId: 'seed-visit-ma-pt-0',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 38,
    departmentKey: 'rehab',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `PT eval — 2 weeks s/p right knee arthroscopy (partial medial meniscectomy, chondroplasty). Referred by ortho. Pain 5/10 at rest, 7/10 with weight-bearing pivot. Uses walker at home transitioning to cane. Goals: independent community ambulation, return to grocery shopping without assist device.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Incision healed — ortho cleared for PT. ROM: flex 85° (goal 120°), ext lag 5°. Effusion moderate.
MMT: quads 3+/5, hamstrings 4/5.
Gait: antalgic, step-through incomplete, walker-dependent 50 ft.
TUG: 22 sec (elevated fall risk >13.5).
Special: no joint warmth today.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Edema management: ankle pumps, quad sets, elevation instruction.
ROM: heel slides 3×10, passive flexion stretch.
Gait: parallel bars ×20 ft, two-point pattern with walker.
Modalities: cryotherapy post-exercise 15 min.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Fatigued but motivated. Pain 6/10 post-session. Extension lag unchanged.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG flexion 120° — baseline 85°.
STG ext lag 0° — baseline 5° lag.
STG TUG <18 sec — baseline 22 sec.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `PT 2×/week × 8 weeks. HEP: ankle pumps, quad sets, heel slides 3×/day. Wean walker → cane when TUG <18 and quad ≥4/5.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Two weeks out from surgery — walk me through a typical day at home.' },
      { speaker: 'PATIENT', text: 'I use the walker in the apartment. Stairs are scary — one step at a time.' },
      { speaker: 'CLINICIAN', text: 'Flexion is eighty-five degrees today. We need to get that bending back and strengthen the quad.' },
      { speaker: 'PATIENT', text: 'When can I go to the store alone?' },
      { speaker: 'CLINICIAN', text: 'Goal is cane in about four weeks if progress stays steady.' },
    ],
    handout: handout(
      'Early recovery after knee surgery — move the ankle and knee gently as instructed. Ice after exercises.',
      ['Ankle pumps hourly while awake', 'Quad sets 10 reps 4× daily', 'Heel slides 10 reps 3× daily', 'Ice 15 min after exercises'],
      ['Fever', 'Knee hot and very swollen', 'Calf pain'],
      ['Sudden inability to bear weight', 'Signs of blood clot'],
    ),
  },

  {
    noteId: 'seed-visit-ma-pt-1',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 18,
    departmentKey: 'rehab',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 8/16. Ambulating with single-point cane indoors and short community distances. Right knee pain 4/10 stairs, 2/10 level surfaces. Confidence improved — went to pharmacy with son but did not enter alone. HEP daily compliance ~80%.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `ROM: flex 105° (+20° since eval), ext 0° (lag resolved).
MMT: quads 4/5, hamstrings 4+/5.
Balance: single-leg stance R 12 sec, L 18 sec.
TUG: 14.2 sec (was 22 at eval, 16.8 visit 5).
Gait: mild antalgic R, cane L hand, step-over-step stairs with rail and SBA.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Strengthening: mini-squats to chair 3×10, 6" step-ups 3×8, TKE with band 3×15.
Gait/stairs: step-over-step sequencing, cane progression discussion.
NMES quads 10 min.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `No effusion increase. Pain 3/10 post. Demonstrated stair technique with min cueing.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG flex 120° — 105° (partially met).
STG independent stairs with cane — partially met (SBA today).
TUG <14 sec — nearly met (14.2).`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue 2×/week. Progress step height, add lateral step-ups. HEP: TKE, step-ups, heel slides. Target cane discharge visit 12 if TUG <12.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Maria, how is the knee on stairs this week?' },
      { speaker: 'PATIENT', text: 'Still a four out of ten on stairs but flat ground is much easier.' },
      { speaker: 'CLINICIAN', text: 'One-oh-five flexion — twenty degrees gained since we started. Excellent.' },
      { speaker: 'PATIENT', text: 'I feel steadier with the cane in my left hand.' },
      { speaker: 'CLINICIAN', text: 'We will practice stairs again and add step height next visit.' },
    ],
    handout: handout(
      'Knee bending and walking are improving. Keep home exercises and use cane on stairs.',
      ['TKE 15 reps 3× daily', 'Step-ups 8 reps', 'Heel slides', 'Cane + rail on stairs'],
      ['Increased swelling', 'Knee giving way'],
      ['Fall or inability to bear weight'],
    ),
  },

  {
    noteId: 'seed-visit-ma-pt-2',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 6,
    departmentKey: 'rehab',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 11/16. Pain 3/10 stairs, 1/10 level. Went grocery shopping with cane — 20 min without rest break. Ready to trial without cane indoors.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `ROM: flex 118° (near LTG), ext 0°.
MMT: quads 4+/5.
TUG: 12.1 sec — now below fall-risk threshold.
Gait: reciprocal, mild antalgic without device 100 ft.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Advanced strengthening: lateral step-ups 8", leg press 2×12 light, balance on foam.
Gait: cane-free indoor ambulation 200 ft ×2.
Functional: simulated grocery reach/lift 5 lb.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Confident without cane indoors. Pain 2/10 post.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG flex 120° — 118°, essentially met.
STG community ambulation — met with cane.
Next: cane discharge, single-leg balance >15 sec.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `2×/week × 3 more visits then discharge planning. Trial outdoor ambulation without cane next visit if TUG stable. HEP progression sheet provided.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'You made it through the grocery store — how did that feel?' },
      { speaker: 'PATIENT', text: 'Tired but I did it! Cane helped.' },
      { speaker: 'CLINICIAN', text: 'Timed up-and-go is twelve seconds now. We can try without the cane indoors today.' },
      { speaker: 'PATIENT', text: 'That would feel like real progress.' },
    ],
    handout: handout(
      'You are close to your knee goals. Practice walking indoors without the cane as directed.',
      ['Continue HEP daily', 'Trial cane-free indoors', 'Use cane outdoors until cleared', '2 more weeks of PT'],
      ['Giving way', 'Sharp increase in pain'],
      ['Fall — call immediately'],
    ),
  },

  {
    noteId: 'seed-visit-ma-ot-0',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'ot.lee@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 25,
    departmentKey: 'rehab',
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `OT eval — referred concurrently with PT for IADL deficits s/p knee surgery. Difficulty with meal prep, laundry (stairs to basement), bathing (low tub). Lives alone — concerned about safety. Goal: cook for grandchildren visit in 6 weeks.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Klein-Baker IADL: 18/24 (moderate impairment — meal prep, housekeeping, shopping).
Kitchen eval: standing tolerance 12 min before pain/rest; unable to reach upper cabinets without step stool (unsafe).
Bathroom: tub transfer with grab bar — slow, 1 rest break.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Home safety assessment (simulated): recommended perching stool, reacher, long-handled sponge, non-slip mat.
ADL training: seated meal prep demo, laundry basket slide vs carry.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Engaged; motivated by grandchildren visit.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG independent light meal prep — baseline not met.
STG use energy conservation — introduced.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `OT 1×/week × 4 weeks. Order perching stool + reacher. Re-assess IADL at visit 4.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'What daily tasks are hardest since the surgery?' },
      { speaker: 'PATIENT', text: 'Cooking — I cannot stand long at the counter. And laundry in the basement is impossible.' },
      { speaker: 'CLINICIAN', text: 'We will set up seated prep and look at equipment to reduce bending and reaching.' },
    ],
    handout: handout(
      'Use seated prep and pacing for kitchen tasks. Equipment can make daily chores safer.',
      ['Sit for chopping and mixing', 'Slide laundry basket vs carry', 'Use reacher for high shelves'],
      ['Dizziness when standing', 'Falls'],
      ['Cannot manage at home safely'],
    ),
  },

  {
    noteId: 'seed-visit-ma-ot-1',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'ot.lee@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 11,
    departmentKey: 'rehab',
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `OT visit 3. Perching stool delivered — using daily. Prepared simple soup seated with 1 break (18 min total, improved from 22 min). Still avoids basement laundry — son helps weekly.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Meal prep simulation: 18 min, 1 rest break. Upper cabinet reach with reacher — independent.
IADL re-score projected +4 points at discharge.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Advanced kitchen: joint protection for lifting pots, push vs pull strategies.
Trial jar opener, review tub transfer with grab bar + bench if needed later.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Successfully prepared soup; proud of progress toward grandchildren visit.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG meal prep — partially met.
STG energy conservation — met.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `2 more OT visits. Practice full simple meal next session. Discharge when IADL ≥21/24.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'How is the perching stool working?' },
      { speaker: 'PATIENT', text: 'Game changer — I made soup yesterday mostly sitting.' },
      { speaker: 'CLINICIAN', text: 'Eighteen minutes with one break — that is real progress toward cooking for your grandchildren.' },
    ],
    handout: handout(
      'Keep using the stool and reacher. Practice full simple meals with breaks as needed.',
      ['Perching stool at counter', 'Reacher for high items', 'Break every 15–20 minutes standing'],
      ['Increased knee pain after tasks'],
      ['Near-falls in kitchen or bathroom'],
    ),
  },

  {
    noteId: 'seed-visit-ma-md-1',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'clinician@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-acute',
    signedDaysAgo: 4,
    departmentKey: 'medical',
    episodeId: EP_MED,
    isLateEntry: true,
    lateEntryDaysGap: 3,
    sections: [
      {
        id: 'chief_complaint',
        label: 'Chief Complaint',
        content: 'Post-operative follow-up — right knee arthroscopy, 6 weeks post-op.',
      },
      {
        id: 'hpi',
        label: 'History of Present Illness',
        content: `Maria returns for routine 6-week post-op evaluation (note signed 3 days after visit — late entry due to schedule). S/p partial medial meniscectomy + chondroplasty. Previously noted mild medial warmth at week 4 — resolved. Currently in PT 2×/week + OT 1×/week. Ambulating with cane; progressing toward cane-free indoors per PT.

Denies fever, chills, wound drainage, increased pain, calf swelling, or chest symptoms.`,
      },
      {
        id: 'exam',
        label: 'Physical Exam',
        content: `Vitals: BP 128/74, HR 70, Temp 98.0°F.
Right knee: 3 portal sites well-healed, no erythema/warmth/effusion. Flexion active 115° (per PT note). Stable to varus/valgus stress. Lachman/anterior drawer negative. Distal NV intact.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. S/p R knee arthroscopy — uncomplicated recovery week 6; wound healed; ROM improving per PT.
2. HTN — controlled.
3. Hypothyroidism — stable.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue PT/OT per rehab plan. Ortho f/u already scheduled week 8. PCP routine 3 months. Activity as tolerated — no restrictions beyond PT guidance. Return for infection signs, fall, or uncontrolled pain.`,
      },
      {
        id: 'patient_education',
        label: 'Patient Education',
        content: `Reviewed infection red flags, DVT symptoms, realistic recovery timeline (3–6 months for maximal improvement). Encouraged adherence to HEP.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Six weeks from surgery — how is the knee?' },
      { speaker: 'PATIENT', text: 'Much better. Warmth is gone and PT says I am almost at a full bend.' },
      { speaker: 'CLINICIAN', text: 'Incisions look healed. Keep with physical and occupational therapy.' },
    ],
    handout: handout(
      'Knee is healing well at 6 weeks. Continue therapy. Watch for infection signs.',
      ['Continue PT and OT', 'Keep incisions clean and dry', 'Follow ortho appointment', 'Complete home exercises'],
      ['Fever', 'Redness or drainage from incisions', 'Calf swelling'],
      ['Fall with inability to walk', 'Severe knee pain and swelling'],
    ),
  },
];

export const MARIA_ALVAREZ_VISITS: SeedVisitCorpus[] = [
  ...MARIA_CORE,
  ...MARIA_ALVAREZ_EXTENDED,
];
