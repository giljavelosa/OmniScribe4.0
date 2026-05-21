import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from '../helpers';
import { ACME_ORG_ID, ACME_SITE_MAIN, ACME_SITE_NORTH } from './rachel-kim';

const RK = 'seed-acme-patient';
const EP_RK_MED = 'seed-acme-episode-medical';
const EP_RK_REHAB = 'seed-acme-episode-rk-rehab';
const EP_RK_BH = 'seed-acme-episode-rk-bh';

const RH = 'seed-acme-patient-rehab';
const EP_RH_REHAB = 'seed-acme-episode-rehab';
const EP_RH_MED = 'seed-acme-episode-rh-medical';

const ES = 'seed-acme-patient-bh';
const EP_ES_BH = 'seed-acme-episode-bh';
const EP_ES_MED = 'seed-acme-episode-es-medical';

/** Additional Acme patient visits — multi-episode depth across Rachel, Robert, Elena. */
export const ACME_EXTENDED_VISITS: SeedVisitCorpus[] = [
  // ── Rachel Kim — comprehensive diabetes follow-up (38 min) ───────────────
  {
    noteId: 'seed-acme-visit-rk-md-3',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: RK,
    patientFirstName: 'Rachel',
    clinicianEmail: 'clinician@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 7,
    departmentKey: 'medical',
    episodeId: EP_RK_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: Comprehensive diabetes management visit with annual complication screening.

HPI: Rachel Kim, 46F, T2DM diagnosed 3 months ago, returns for extended follow-up. On metformin 1000 mg BID + semaglutide 0.5 mg weekly + atorvastatin 40 mg. Reports excellent adherence. Home fasting glucose log (21 readings): 102–128, average 112. No hypoglycemia. Semaglutide nausea resolved after dose increase. Weight down 18 lb total — energy improved, clothes looser.

Foot symptoms: occasional tingling right great toe ×2 weeks — intermittent, resolves with movement. No ulcers, no wounds. Vision: annual eye exam scheduled next week.

Exercise: walks 35 min 5×/week since diagnosis. Started walking program led to right heel pain (see concurrent PT episode).

Psychosocial: diagnosis stress largely resolved with BH sessions; sleep 7 hrs. Family supportive.

PMH: T2DM, hyperlipidemia, overweight (improving).
Meds: metformin, semaglutide, atorvastatin.
Allergies: NKDA.

ROS: Polyuria/polydipsia resolved. Feet (+) intermittent paresthesia R great toe. CV/Resp/GI otherwise negative.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 118/74, HR 72, BMI 27.2, Wt 160 lb, Temp 98.4°F, SpO2 99% RA.

General: NAD, pleasant.
HEENT: PERRLA, oropharynx clear.
CV: RRR, no edema.
Lungs: CTAB.
Feet — detailed exam: skin intact bilaterally, no ulcers/callus formation, pulses DP/PT 2+ bilaterally, cap refill <2 sec, monofilament 10g — 8/10 sites intact (misses R great toe tip and L 5th toe — retest confirmed). Vibratory sense 128 Hz tuning fork — slightly diminished R great toe vs hallux on L. Ankle reflexes 1+ bilaterally.
Neuro: rest of exam non-focal.

Labs: A1c 7.1% (prior 8.2%), LDL 98 (on statin, was 138), Cr 0.7, eGFR >90, urine microalbumin/creatinine ratio 18 mg/g (normal <30).`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. T2DM — A1c 7.1%, at individualized goal; excellent response to metformin + GLP-1 RA + lifestyle.
2. Early diabetic peripheral neuropathy — possible, based on monofilament/vibration findings; may be position-related vs true neuropathy — recheck after glycemic stability maintained 6 months.
3. Hyperlipidemia — LDL at goal on atorvastatin 40 mg.
4. Overweight — BMI improved with 18 lb loss; continue current regimen.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `DM: Continue metformin 1000 mg BID + semaglutide 0.5 mg weekly. Maintain glucose log weekly ×4 weeks then spot-check.

Neuropathy screen: repeat monofilament exam 6 months. Foot care education — daily visual inspect, moisture between toes, proper footwear. Refer to podiatry if any skin break.

Statin: continue atorvastatin 40 mg. Lipids annually.

Eye: confirm ophthalmology appointment — report required.

BH: continue as needed — PHQ/GAD stable per patient.

Follow-up: 3 months with A1c + BMP. Call for fasting glucose <70 repeatedly, foot wound, or vision changes.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Rachel, we blocked extra time today for a full diabetes review. How have the last three months felt?' },
        { speaker: 'PATIENT', text: 'Night and day from diagnosis. Energy is back and the scale moved.' },
        { speaker: 'CLINICIAN', text: 'Walk me through your morning glucose readings.' },
        { speaker: 'PATIENT', text: 'Mostly low hundreds — I log in the app.' },
        { speaker: 'CLINICIAN', text: 'Average one-twelve — excellent. Any lows below seventy?' },
        { speaker: 'PATIENT', text: 'Never.' },
        { speaker: 'CLINICIAN', text: 'Semaglutide at zero point five milligrams — nausea?' },
        { speaker: 'PATIENT', text: 'Gone after the first week on this dose.' },
        { speaker: 'CLINICIAN', text: 'Tell me about the toe tingling you mentioned on the intake form.' },
        { speaker: 'PATIENT', text: 'Right big toe, sometimes when I sit cross-legged. Goes away when I walk.' },
        { speaker: 'CLINICIAN', text: 'I will do a careful foot exam and monofilament test.' },
        { speaker: 'PATIENT', text: 'Is that neuropathy already?' },
        { speaker: 'CLINICIAN', text: 'Too early to say for sure — A1c was high for months. We caught it quickly.' },
        { speaker: 'CLINICIAN', text: 'Look at the bottom of your feet daily — mirror on the floor helps.' },
        { speaker: 'PATIENT', text: 'I started after diabetes class.' },
        { speaker: 'CLINICIAN', text: 'Monofilament — you missed two spots today. Vibration slightly reduced right great toe. Retest in six months with better control.' },
        { speaker: 'PATIENT', text: 'That scares me a little.' },
        { speaker: 'CLINICIAN', text: 'Reason to stay on top of shoes, glucose, and the walking program — not a reason to panic.' },
        { speaker: 'CLINICIAN', text: 'LDL is ninety-eight on the statin — at goal. Kidney microalbumin normal.' },
        { speaker: 'PATIENT', text: 'Eye doctor is next Tuesday.' },
        { speaker: 'CLINICIAN', text: 'Send me the report. Any mood concerns since diagnosis?' },
        { speaker: 'PATIENT', text: 'Counseling helped. I am not as terrified.' },
        { speaker: 'CLINICIAN', text: 'Heel pain with walking — you started PT at North campus?' },
        { speaker: 'PATIENT', text: 'Yes, plantar fasciitis they said. Stretches are helping.' },
        { speaker: 'CLINICIAN', text: 'Good — keep both programs. Same meds, follow up three months with A1c.' },
        { speaker: 'PATIENT', text: 'Thank you for the longer visit — I had a lot of questions.' },
      ],
      40,
    ),
    handout: handout(
      'Diabetes is well controlled. Check feet daily. Continue all medicines and eye appointment.',
      ['Metformin and semaglutide — continue', 'Atorvastatin nightly', 'Daily foot inspection', 'Eye exam next week — send report', 'A1c recheck in 3 months'],
      ['Foot wound or ulcer', 'Repeated glucose under 70', 'Sudden vision loss'],
      ['Foot infection signs — call same day', 'Emergency for chest pain'],
    ),
  },

  // ── Rachel Kim — plantar fasciitis PT eval ───────────────────────────────
  {
    noteId: 'seed-acme-visit-rk-pt-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_NORTH,
    patientId: RK,
    patientFirstName: 'Rachel',
    clinicianEmail: 'pt.nguyen@acme.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 20,
    departmentKey: 'rehab',
    episodeId: EP_RK_REHAB,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `PT eval — right plantar heel pain. Rachel, 46F with T2DM, increased walking to 35 min/day after diagnosis — developed insidious R medial heel pain worst with first steps AM and after sitting. Pain 6/10 AM, 3/10 after warm-up. Wearing old sneakers. Goal: continue walking program without heel pain.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Observation: antalgic gait first 10 steps, toe-walking tendency AM.
Palpation: tenderness medial calcaneal tubercity R.
ROM: ankle DF 8° knee extended (tight gastroc), 15° knee flexed.
Special: windlass test positive R.
Footwear: inadequate arch support — counseled.
Single-leg heel raise: 8 R (pain-limited), 12 L.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Gastroc/soleus stretching 3×30 sec, towel scrunches, intrinsic foot doming, night splint fitted.
Gait: cadence adjustment, avoid barefoot at home.
Patient education: supportive shoes, ice after walks.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Pain 4/10 post-stretching. Understands night splint use 6 hrs/sleep.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG: walk 35 min pain-free — baseline not met.
STG: first-step pain ≤3/10 — baseline 6/10.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `PT 1×/week ×6 weeks. HEP: stretches, doming, night splint. Coordinate with endocrinology — maintain activity for DM.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Heel pain started when you increased walking after the diabetes diagnosis?' },
        { speaker: 'PATIENT', text: 'Yes — first steps in the morning are brutal.' },
        { speaker: 'CLINICIAN', text: 'Classic plantar fasciitis pattern. Let us check ankle flexibility.' },
        { speaker: 'PATIENT', text: 'I have been wearing old tennis shoes.' },
        { speaker: 'CLINICIAN', text: 'Shoes matter — we will discuss options. Night splint tonight for six hours.' },
        { speaker: 'PATIENT', text: 'I cannot stop walking — my doctor wants exercise for blood sugar.' },
        { speaker: 'CLINICIAN', text: 'We keep you walking with stretches and support — not rest completely.' },
      ],
      32,
    ),
    handout: handout(
      'Heel pain is common when starting a walking program. Stretch calves, wear supportive shoes, use night splint.',
      ['Calf stretches 3× daily', 'Night splint 6 hours', 'Supportive shoes — replace old sneakers', 'Ice 10 min after walks'],
      ['Unable to bear weight', 'Foot redness or fever'],
      ['Cannot walk at all — call PT line'],
    ),
  },

  {
    noteId: 'seed-acme-visit-rk-pt-1',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_NORTH,
    patientId: RK,
    patientFirstName: 'Rachel',
    clinicianEmail: 'pt.nguyen@acme.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 6,
    departmentKey: 'rehab',
    episodeId: EP_RK_REHAB,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 3. First-step pain 3/10 (improved). Night splint 5 nights/week. New shoes purchased. Walking 30 min without flare.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Ankle DF 12° knee extended. Heel raise 12 R. Windlass mild discomfort only.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Eccentric heel drops from step 3×10, single-leg balance, continued stretching.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Optimistic — "morning hobble" reduced.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `STG first-step pain nearly met. LTG progressing.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `3 more visits. Progress to 35 min walks next week if pain stable.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Morning pain down to three out of ten — nice work with the splint.' },
        { speaker: 'PATIENT', text: 'New shoes helped too.' },
        { speaker: 'CLINICIAN', text: 'Adding eccentric heel drops today — key for plantar fasciitis.' },
      ],
      30,
    ),
    handout: handout(
      'Heel pain improving. Continue splint, stretches, and new shoes.',
      ['Heel drops 10 reps daily', 'Night splint', 'Walk 30 min — increase per PT'],
      ['Sharp heel pain returning above 6/10'],
      ['Call if unable to walk'],
    ),
  },

  // ── Rachel Kim — BH adjustment session ───────────────────────────────────
  {
    noteId: 'seed-acme-visit-rk-bh-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: RK,
    patientFirstName: 'Rachel',
    clinicianEmail: 'lcsw.taylor@acme.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 60,
    departmentKey: 'bh',
    episodeId: EP_RK_BH,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `BH brief therapy — adjustment disorder with anxious mood following T2DM diagnosis. Rachel reports initial panic about complications, guilt about "letting herself go," catastrophizing about daughter's future. PHQ-9: 7. GAD-7: 11. No SI.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Cooperative, anxious affect when discussing long-term complications, otherwise euthymic. Linear thought process.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `No SI/HI. C-SSRS negative.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `CBT: cognitive restructuring of "diabetes equals inevitable blindness" — evidence review. Diabetes distress scale completed — moderate. Motivational interviewing for lifestyle engagement.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `4 sessions brief therapy — completed series; patient discharged to as-needed with portal message option.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Shared GAD-7 improvement with Dr. Reed.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'When you got the diabetes diagnosis, what went through your mind?' },
        { speaker: 'PATIENT', text: 'That I would end up like my uncle who lost his foot.' },
        { speaker: 'CLINICIAN', text: 'That image is powerful — let us examine how likely that is with early treatment.' },
        { speaker: 'PATIENT', text: 'My A1c is coming down now but I was terrified for weeks.' },
        { speaker: 'CLINICIAN', text: 'Reason to be concerned, not reason to assume the worst case.' },
      ],
      31,
    ),
    handout: handout(
      'Diagnosis distress is normal. Focus on daily actions — meds, walking, follow-ups — not worst-case images.',
      ['Challenge catastrophic thoughts', 'Use diabetes distress scale monthly', 'Message therapist if needed'],
      ['Hopelessness', 'Suicidal thoughts'],
      ['988 if crisis'],
    ),
  },

  // ── Robert Hayes — medical establish care (37 min) ───────────────────────
  {
    noteId: 'seed-acme-visit-rh-md-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: RH,
    patientFirstName: 'Robert',
    clinicianEmail: 'clinician@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 50,
    departmentKey: 'medical',
    episodeId: EP_RH_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: New patient visit — hypertension, prediabetes screening, and coordination with active PT.

HPI: Robert Hayes, 62M, landscaper semi-retired, referred internally from PT for BP elevation noted at rehab intake (148/92). Reports occasional morning headaches, no chest pain. Family hx: father stroke age 70, mother T2DM. Diet: regular meals but high carb (toast/jam breakfast, sandwich lunch). Walks 20 min daily with PT program.

Prediabetes: fasting glucose 112 at employer screening 4 months ago — never followed up.

PMH: Mechanical LBP (active PT), hyperlipidemia unknown status.
Meds: ibuprofen PRN back pain.
Allergies: NKDA.
Social: Married, occasional EtOH 4–5/week, never smoker.

ROS: CV (+) occasional HA; endocrine (+) thirst mild; otherwise negative.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 146/90 (repeat 142/88), HR 78, BMI 28.9, Wt 198 lb, Temp 98.2°F.
General: NAD.
CV: RRR, no murmurs. Lungs: CTAB.
Labs today: A1c 6.1%, FPG 118, LDL 142, HDL 38, TG 168, Cr 0.9, K 4.2.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Essential hypertension — Stage 2 on multiple readings; start pharmacotherapy.
2. Prediabetes — A1c 6.1%; lifestyle + consider metformin if progression.
3. Hyperlipidemia — LDL above goal given ASCVD risk factors.
4. Mechanical LBP — continue PT; NSAID use monitor.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Start lisinopril 10 mg daily. Home BP log ×2 weeks.
Lifestyle: Mediterranean diet handout, reduce EtOH to ≤2 drinks/day, continue PT walking.
Statin: atorvastatin 20 mg nightly.
Prediabetes: repeat A1c 6 months; diabetes prevention program referral.
Follow-up 4 weeks BP, 3 months labs.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Robert, PT flagged elevated blood pressure. Tell me about your health history.' },
        { speaker: 'PATIENT', text: 'Back pain brought me to PT. I have not seen a doctor in a few years.' },
        { speaker: 'CLINICIAN', text: 'Any headaches, chest pain, or vision changes?' },
        { speaker: 'PATIENT', text: 'Morning headache sometimes. No chest pain.' },
        { speaker: 'CLINICIAN', text: 'Today one-forty-two over eighty-eight — high. Father had a stroke?' },
        { speaker: 'PATIENT', text: 'Yes, in his seventies.' },
        { speaker: 'CLINICIAN', text: 'Labs show A1c six point one — prediabetes range.' },
        { speaker: 'PATIENT', text: 'My mother had diabetes too.' },
        { speaker: 'CLINICIAN', text: 'We can often reverse that trajectory with diet and activity — you are already walking with PT.' },
        { speaker: 'CLINICIAN', text: 'I recommend lisinopril ten milligrams and a statin for cholesterol.' },
        { speaker: 'PATIENT', text: 'Will it interfere with my back exercises?' },
        { speaker: 'CLINICIAN', text: 'No — keep PT. Limit ibuprofen if possible — affects kidneys with blood pressure meds.' },
        { speaker: 'PATIENT', text: 'How often do I need to come back?' },
        { speaker: 'CLINICIAN', text: 'Four weeks for blood pressure check. Log readings at home twice daily.' },
      ],
      37,
    ),
    handout: handout(
      'Blood pressure and prediabetes need attention. Start lisinopril and statin as directed. Keep PT exercises.',
      ['Lisinopril 10 mg daily', 'Atorvastatin 20 mg nightly', 'Home BP log twice daily', 'Continue PT', 'Follow up 4 weeks'],
      ['Face swelling', 'BP over 180/120', 'Chest pain'],
      ['Stroke symptoms — call 911'],
    ),
  },

  {
    noteId: 'seed-acme-visit-rh-md-1',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: RH,
    patientFirstName: 'Robert',
    clinicianEmail: 'np.acme@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 15,
    departmentKey: 'medical',
    episodeId: EP_RH_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `4-week HTN follow-up. Lisinopril tolerated — no cough. Home BP avg 132/82. Back pain improved per PT (Oswestry 18%). Lost 3 lb. EtOH reduced to 2 drinks/week.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `BP 130/80. HR 74. Weight 195 lb.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `HTN — improving, near goal. Prediabetes — lifestyle progressing. Hyperlipidemia — on statin, LDL pending.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue lisinopril 10 mg + statin. BMP 2 weeks post-initiation — reviewed today normal. A1c 5 months.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Home blood pressures averaging one-thirty-two over eighty-two — good response.' },
        { speaker: 'PATIENT', text: 'No cough from the lisinopril. Back feels better too.' },
        { speaker: 'CLINICIAN', text: 'Stay the course. Recheck A1c in five months.' },
      ],
      30,
    ),
    handout: handout(
      'Blood pressure improving. Continue medicines and PT.',
      ['Lisinopril 10 mg daily', 'Atorvastatin nightly', 'Home BP log weekly'],
      ['Angioedema', 'Severe headache'],
      ['Call for warning symptoms'],
    ),
  },

  // ── Elena Santos — initial PCP depression screen (36 min) ────────────────
  {
    noteId: 'seed-acme-visit-es-md-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: ES,
    patientFirstName: 'Elena',
    clinicianEmail: 'clinician@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 42,
    departmentKey: 'medical',
    episodeId: EP_ES_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: "I cannot shake this sadness" — wellness visit with behavioral screening.

HPI: Elena Santos, 34F software QA analyst, presents for annual exam but chief concern is 3-month depressive episode after divorce finalized. Anhedonia, hypersomnia weekends (10+ hrs), poor concentration affecting sprint deadlines, 12-lb weight gain. Passive death wishes without plan — "would not mind not waking up" — denies intent. No prior psychiatric dx. No manic history.

Sleep: 6 hrs weeknights, 10–11 hrs weekends. Appetite increased — carb craving.
Substance: EtOH 1–2 glasses wine 4×/week since divorce (up from 1×/week).
Family hx: aunt MDD.

PMH: None. Meds: None. Allergies: NKDA.

ROS: Psych (+) as above; constitutional (+) fatigue; remainder negative.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 116/70, HR 72, BMI 26.8, Wt 158 lb (+12 from last year).
General: Psychomotor slowing mild, constricted affect, tearful at times.
PHQ-9: 18 (moderately severe). GAD-7: 8.
Exam otherwise unremarkable — thyroid palpation normal, no focal neuro deficits.
Labs: TSH 2.0, CMP wnl, CBC wnl.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Major depressive disorder, moderate — PHQ-9 18; functional impairment at work; passive SI without plan — moderate risk, safety plan indicated.
2. Health maintenance — labs normal, no medical contributor to depression.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `BH referral urgent — LCSW intake within 1 week (scheduled). Discussed SSRI — patient agreeable to escitalopram 10 mg after BH intake if still PHQ-9 ≥15 at 2 weeks therapy OR sooner if worsening.

Safety: crisis line, means restriction (firearms at brother's — confirmed), sister support contact.

Follow-up 2 weeks — reassess PHQ-9, SI. Start escitalopram at visit if indicated — started at subsequent visit per record.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Elena, you wrote on the form that sadness will not lift. Tell me more.' },
        { speaker: 'PATIENT', text: 'Since the divorce finalized I drag through work. Weekends I sleep all day.' },
        { speaker: 'CLINICIAN', text: 'Have you had thoughts of not wanting to live?' },
        { speaker: 'PATIENT', text: 'Sometimes I think I would not mind not waking up. I would not do anything.' },
        { speaker: 'CLINICIAN', text: 'I am glad you told me. We will make a safety plan today.' },
        { speaker: 'PATIENT', text: 'I do not have guns — my brother stores them.' },
        { speaker: 'CLINICIAN', text: 'PHQ-9 is eighteen — moderately severe depression. This is treatable.' },
        { speaker: 'PATIENT', text: 'I never thought I needed a therapist.' },
        { speaker: 'CLINICIAN', text: 'Therapy plus possibly medication — we refer to Jordan Taylor this week.' },
        { speaker: 'CLINICIAN', text: 'Any manic episodes — little sleep but tons of energy?' },
        { speaker: 'PATIENT', text: 'No, just the opposite.' },
        { speaker: 'CLINICIAN', text: 'Labs normal — thyroid not causing this.' },
        { speaker: 'PATIENT', text: 'Wine intake went up — four nights a week now.' },
        { speaker: 'CLINICIAN', text: 'Alcohol worsens depression — goal two or fewer drinks weekly.' },
        { speaker: 'CLINICIAN', text: 'Sister Maria on your emergency contact — can she know about the safety plan?' },
        { speaker: 'PATIENT', text: 'Yes, with my permission.' },
        { speaker: 'CLINICIAN', text: 'Call nine-eight-eight before acting on any self-harm thought. Follow up two weeks.' },
      ],
      36,
    ),
    handout: handout(
      'Depression is a medical condition — not a weakness. Start therapy this week. Limit alcohol. Use crisis line if thoughts worsen.',
      ['BH intake within 1 week', 'Safety plan — call 988 before self-harm', 'Limit alcohol to ≤2 drinks/week', 'Follow up 2 weeks'],
      ['Suicidal plan or intent', 'Unable to function at work'],
      ['988 immediately if intent to harm self'],
    ),
  },
];

export {
  EP_RK_REHAB,
  EP_RK_BH,
  EP_RH_MED,
  EP_ES_MED,
};
