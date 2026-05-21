import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from './helpers';

const PID = 'seed-patient-rehab';
const EP_REHAB = 'seed-episode-seed-patient-rehab';
const EP_MED = 'seed-episode-ma-medical';
const EP_BH = 'seed-episode-ma-bh';

/** Additional Maria Alvarez visits — chronic medical, BH, and expanded depth. */
export const MARIA_ALVAREZ_EXTENDED: SeedVisitCorpus[] = [
  {
    noteId: 'seed-visit-ma-md-chronic',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'np.brown@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 28,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: Chronic disease management visit — hypertension, hypothyroidism, and post-operative recovery coordination.

HPI: Maria Alvarez is a 67-year-old female returning for comprehensive chronic care review, 4 weeks post right knee arthroscopy. She reports overall surgical recovery progressing per PT (flexion ~105° at last PT visit). Knee pain 4/10 with stairs, improved from pre-op baseline. No fever, wound concerns, or calf symptoms.

HTN: On amlodipine 5 mg daily — home BP log (14 readings): systolic 118–136, diastolic 72–84; average 126/78. Denies headache, chest pain, orthopnea, PND, palpitations. Compliant with medication.

Hypothyroidism: Levothyroxine 75 mcg daily — reports stable energy, no cold intolerance, hair loss, or constipation. Last TSH 6 months ago 2.4 — due for recheck.

Interval social history: Lives alone; son visits 2×/week for groceries and basement laundry. OT addressing kitchen IADLs with perching stool — "game changer" per patient. Mild low mood when alone weekends — interested in senior center program son found.

PMH: HTN, hypothyroidism, bilateral knee OA (R s/p partial meniscectomy + chondroplasty), cholecystectomy 2010.
PSH: As above.
Medications: amlodipine 5 mg daily, levothyroxine 75 mcg daily, acetaminophen PRN knee.
Allergies: Sulfa (rash).
Social: Retired teacher, never smoker, EtOH rare. Independent ADLs with adaptive equipment.

Review of systems — comprehensive:
Constitutional: (−) fever, (−) weight loss. HEENT: (−) vision change, (−) hearing loss. CV: (−) chest pain, (−) edema. Resp: (−) SOB, (−) cough. GI: (−) N/V, (−) abdominal pain. GU: (−) dysuria. MSK: (+) R knee stiffness AM ×20 min; (−) new joint swelling elsewhere. Neuro: (−) weakness, (−) falls. Psych: (+) occasional lonely mood weekends; (−) SI/HI.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 128/76 (L arm, seated, repeat 126/74), HR 68, RR 16, Temp 98.2°F, SpO2 97% RA, Ht 5'4", Wt 154 lb, BMI 26.4.

General: Pleasant, NAD, ambulates with single-point cane.
HEENT: PERRLA, oropharynx moist, thyroid non-enlarged, no nodules palpated.
Neck: Supple, no JVD, no carotid bruits.
CV: RRR, normal S1/S2, no murmurs.
Lungs: CTAB.
Abd: Soft, NT, ND, normoactive bowel sounds.
Ext: Trace bilateral ankle edema (baseline per patient), R knee mild effusion, incision sites healed, flexion active 108° today.
Neuro: A&O ×3, gait antalgic with cane, steady with SBA on exam table transfer.
Psych: Mood "okay," affect mildly constricted when discussing living alone — no SI/HI on C-SSRS screen.

Labs reviewed: BMP — Cr 0.9, K 4.1, eGFR >60. TSH drawn today — pending.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Essential hypertension — controlled on amlodipine 5 mg; home averages within goal <130/80.
2. Hypothyroidism — clinically euthyroid; TSH pending.
3. S/p R knee arthroscopy — recovering appropriately; continue PT/OT per rehab plan.
4. Social isolation / mild depressive symptoms — subclinical PHQ-2 score 2; warrants monitoring; patient open to BH referral for adjustment support.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `HTN: Continue amlodipine 5 mg. Home BP log monthly. Recheck BMP in 6 months.

Hypothyroidism: Continue levothyroxine 75 mcg. TSH result — adjust if out of range; call if TSH >4.5 or <0.4.

Knee: Continue PT/OT. Ortho f/u per surgical schedule. PCP wound check at 6 weeks (scheduled).

Social/BH: Refer to LCSW for brief supportive therapy re: post-op adjustment and social isolation — patient agreeable. Provided senior center brochure.

Preventive: Mammogram due — referral placed. Flu vaccine today (influenza — left deltoid, tolerated). Shingrix series discussed — patient will schedule.

Follow-up: 3 months chronic care, sooner for BP >140/90 sustained, mood worsening, or knee infection signs.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Maria, good to see you. This is our longer chronic-care visit — we will cover blood pressure, thyroid, the knee, and how you are doing at home.' },
        { speaker: 'PATIENT', text: 'That sounds good. The knee is better but stairs still hurt.' },
        { speaker: 'CLINICIAN', text: 'Tell me about your home blood pressure readings since surgery.' },
        { speaker: 'PATIENT', text: 'Most mornings it is one-twenty-something over seventies. I write it in the little book.' },
        { speaker: 'CLINICIAN', text: 'Excellent — that average is at goal. Any headaches, chest pain, or swelling in the legs?' },
        { speaker: 'PATIENT', text: 'No chest pain. Ankles puff a little at night but always have.' },
        { speaker: 'CLINICIAN', text: 'How is the thyroid pill going — energy, weight, cold sensitivity?' },
        { speaker: 'PATIENT', text: 'Fine, I think. Same dose for years.' },
        { speaker: 'CLINICIAN', text: 'We drew TSH today. I will call only if we need to adjust.' },
        { speaker: 'PATIENT', text: 'Okay.' },
        { speaker: 'CLINICIAN', text: 'Walk me through a typical day at home since surgery.' },
        { speaker: 'PATIENT', text: 'Walker in the apartment mornings. PT twice a week. Son comes Tuesdays and Saturdays.' },
        { speaker: 'CLINICIAN', text: 'What is hardest when you are alone?' },
        { speaker: 'PATIENT', text: 'Weekends feel long. I used to volunteer at the library — have not gone back.' },
        { speaker: 'CLINICIAN', text: 'Have you felt down or hopeless more days than not?' },
        { speaker: 'PATIENT', text: 'Some Sundays I cry a little. Not suicidal — just lonely.' },
        { speaker: 'CLINICIAN', text: 'Thank you for telling me. Would you talk with our behavioral health counselor for a few sessions?' },
        { speaker: 'PATIENT', text: 'Maybe — if it is not too much with therapy for the knee.' },
        { speaker: 'CLINICIAN', text: 'It can be short-term support. Your son mentioned a senior center — what do you think?' },
        { speaker: 'PATIENT', text: 'He printed a schedule. I might try the book club.' },
        { speaker: 'CLINICIAN', text: 'Let me examine the knee and incisions.' },
        { speaker: 'PATIENT', text: 'The portals look good, right?' },
        { speaker: 'CLINICIAN', text: 'Healed well. Flexion one-oh-eight today — PT notes show steady progress.' },
        { speaker: 'CLINICIAN', text: 'Heart and lungs sound normal. Blood pressure in office one-twenty-six over seventy-four.' },
        { speaker: 'PATIENT', text: 'Do I need any medicine changes?' },
        { speaker: 'CLINICIAN', text: 'Continue amlodipine and levothyroxine as-is pending TSH. Flu shot today if you are willing.' },
        { speaker: 'PATIENT', text: 'Yes, please.' },
        { speaker: 'CLINICIAN', text: 'Mammogram is due — I am placing the order. Any questions about ortho follow-up?' },
        { speaker: 'PATIENT', text: 'Orthopedics in two weeks. PT says I might drop the cane indoors soon.' },
        { speaker: 'CLINICIAN', text: 'Great milestone. Call if mood worsens, fever, calf pain, or BP runs high. See you in three months.' },
        { speaker: 'PATIENT', text: 'Thank you, doctor.' },
      ],
      38,
    ),
    handout: handout(
      'Blood pressure and thyroid are stable. Keep taking your usual medicines. Try the senior center or counseling if lonely weekends continue.',
      ['Amlodipine 5 mg daily — continue', 'Levothyroxine 75 mg daily — continue', 'Home BP log monthly', 'Continue PT and OT', 'Consider senior center book club', 'Follow up in 3 months'],
      ['BP over 140/90 for several days', 'Fever or red knee', 'Calf swelling', 'Thoughts of harming yourself'],
      ['Mood worsening or unable to cope at home', 'Emergency for chest pain or severe shortness of breath'],
    ),
  },

  {
    noteId: 'seed-visit-ma-bh-0',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 22,
    departmentKey: 'bh',
    episodeId: EP_BH,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `BH intake — referred by NP Brown for post-operative social isolation and mild depressive symptoms. Maria is 67F, 6 weeks s/p R knee arthroscopy, lives alone, son support 2×/week. Reports lonely weekends, decreased social engagement since surgery (stopped library volunteering), occasional tearfulness without suicidal intent. PHQ-9 today: 8 (mild). GAD-7: 5 (mild). Prior BH: none formal; grief counseling briefly after husband's death 2019 (6 sessions, helpful).

Goals: reconnect with community, manage mood while completing PT, prevent functional decline from isolation.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Neat casual attire, cane at side, groomed. Behavior: Cooperative, mild psychomotor slowing. Speech: Normal rate/volume, soft when discussing loneliness. Mood: "Lonely sometimes." Affect: Constricted, tearful briefly when describing weekends, congruent. Thought process: Linear, goal-directed. Thought content: No SI/HI/AVH. Cognition: A&O ×3. Insight/Judgment: Good — recognizes isolation as modifiable risk.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `C-SSRS: negative for ideation, intent, plan. PHQ-9: 8 (mild). Protective factors: son involved, engaged in PT/OT, future-oriented (grandchildren visit planned). Crisis line provided.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Psychoeducation: adjustment to recovery + social role changes. Behavioral activation: graded schedule — senior center book club trial, one phone call to friend weekly. Problem-solving: transportation barriers to senior center (son offered ride Saturdays). Grief psychoeducation — anniversary of husband's death approaching; normalized mixed emotions.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Biweekly supportive therapy ×6 sessions. Homework: activity schedule with one social + one pleasurable activity weekly. PHQ-9 each visit. Coordinate with OT re: community mobility when cane weaned.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `ROI signed for PCP (NP Brown). With permission, son aware of referral — supportive.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Maria, your nurse practitioner thought some support around recovery and being home might help. What brought you in today?' },
        { speaker: 'PATIENT', text: 'I am doing better with the knee but weekends are empty since I stopped the library.' },
        { speaker: 'CLINICIAN', text: 'Tell me about life at home during the week versus the weekend.' },
        { speaker: 'PATIENT', text: 'PT keeps me busy Tuesday and Thursday. Son comes twice. Sunday I mostly watch TV.' },
        { speaker: 'CLINICIAN', text: 'When you say empty, do you feel sad, anxious, or both?' },
        { speaker: 'PATIENT', text: 'Sad. I cry sometimes. Not like when my husband died, but lonely.' },
        { speaker: 'CLINICIAN', text: 'Any thoughts of not wanting to live or hurting yourself?' },
        { speaker: 'PATIENT', text: 'No. I want to see my grandchildren next month.' },
        { speaker: 'CLINICIAN', text: 'Good. Your screening score is mild depression — very treatable with small activity changes.' },
        { speaker: 'PATIENT', text: 'I do not want pills if I can avoid it.' },
        { speaker: 'CLINICIAN', text: 'This is talk therapy and scheduling pleasant activities — no medication from me.' },
        { speaker: 'CLINICIAN', text: 'Your son found a senior center book club — is that realistic?' },
        { speaker: 'PATIENT', text: 'Maybe. I am nervous with the cane.' },
        { speaker: 'CLINICIAN', text: 'We can time it when PT clears more walking or he drives you.' },
        { speaker: 'PATIENT', text: 'He offered Saturdays.' },
        { speaker: 'CLINICIAN', text: 'Let us plan one social activity and one phone call to a friend each week minimum.' },
        { speaker: 'PATIENT', text: 'My friend Rosa from the library — I have not called her.' },
        { speaker: 'CLINICIAN', text: 'Homework: call Rosa before our next session. How does every other week sound?' },
        { speaker: 'PATIENT', text: 'That works.' },
      ],
      32,
    ),
    handout: handout(
      'Feeling lonely during recovery is common. Schedule one social activity and one friendly call each week.',
      ['Call one friend this week', 'Try senior center book club when ready', 'Biweekly counseling', 'Use 988 if thoughts of self-harm emerge'],
      ['Persistent hopelessness', 'Thoughts of suicide'],
      ['988 crisis line', 'Call therapist if mood sharply worsens'],
    ),
  },

  {
    noteId: 'seed-visit-ma-bh-1',
    patientId: PID,
    patientFirstName: 'Maria',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 8,
    departmentKey: 'bh',
    episodeId: EP_BH,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 2. Attended book club with son — enjoyed discussion, "felt like myself for an hour." Called Rosa twice. PHQ-9: 6 (mild, down from 8). PT progressing — trialing cane-free indoors. Anniversary of husband's death last week — tearful but used coping card.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Bright sweater, no cane indoors today. Behavior: Engaged, smiles when describing book club. Mood: "Better." Affect: Broader range, euthymic moments. No SI/HI.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `PHQ-9: 6. No SI/HI. Safety plan reviewed.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Reinforced behavioral activation success. Cognitive reframe on "burden to son" — evidence for mutual benefit of visits. Planned independent taxi to book club when cane weaned.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue biweekly ×4 more. Homework: book club solo trial when PT clears outdoor ambulation. PHQ-9 visit 4.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Update to NP Brown — PHQ-9 improving, no med indicated.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'How was book club?' },
        { speaker: 'PATIENT', text: 'Wonderful. We discussed a mystery novel. I laughed.' },
        { speaker: 'CLINICIAN', text: 'Did you call Rosa?' },
        { speaker: 'PATIENT', text: 'Twice! She is coming to visit next week.' },
        { speaker: 'CLINICIAN', text: 'PHQ-9 is six today — trending down. How was the anniversary of your husband\'s passing?' },
        { speaker: 'PATIENT', text: 'Hard day. I used the coping card — photos and breathing.' },
        { speaker: 'CLINICIAN', text: 'That is exactly what it is for. Next goal — getting to book club on your own when PT clears the cane outdoors.' },
        { speaker: 'PATIENT', text: 'PT says maybe two weeks.' },
      ],
      30,
    ),
    handout: handout(
      'You are reconnecting with community — keep it up. Use your coping card on hard anniversaries.',
      ['Continue book club', 'Call Rosa weekly', 'Biweekly therapy', 'Trial solo transport when PT clears'],
      ['Return of daily hopelessness', 'Suicidal thoughts'],
      ['988 if crisis'],
    ),
  },
];

export { EP_MED as MARIA_EP_MED, EP_BH as MARIA_EP_BH, EP_REHAB as MARIA_EP_REHAB };
