import { Division } from '@prisma/client';
import { handout, type SeedVisitCorpus } from '../helpers';

export const ACME_ORG_ID = 'seed-acme-clinic';
export const ACME_SITE_MAIN = 'seed-acme-site';
export const ACME_SITE_NORTH = 'seed-acme-site-north';

const PID = 'seed-acme-patient';
const EP = 'seed-acme-episode-medical';

/** Rachel Kim — Type 2 diabetes management (Acme primary medical patient). */
export const RACHEL_KIM_VISITS: SeedVisitCorpus[] = [
  {
    noteId: 'seed-acme-visit-rk-md-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Rachel',
    clinicianEmail: 'clinician@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 90,
    departmentKey: 'medical',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: Elevated fasting glucose on annual wellness labs.

HPI: Rachel Kim, 46F, referred after fasting glucose 186 mg/dL and A1c 8.2% on routine screening. Reports increased thirst and nocturia ×3 months, fatigue, 12-lb unintentional weight loss over 6 months. No DKA symptoms. Family hx: mother T2DM, father CAD.

PMH: None prior chronic dx. PSH: C-section 2012.
Meds: None prior to today.
Allergies: NKDA.
Social: Accountant, sedentary work, diet high in refined carbs. Never smoker. EtOH occasional.

ROS: Polyuria/polydipsia (+). Vision (−) acute changes. CV (−) chest pain.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 128/82, HR 74, BMI 29.4, Wt 178 lb, Temp 98.3°F, SpO2 99% RA.
General: NAD.
HEENT: PERRLA. Oropharynx moist.
CV/Lungs/Abd: Unremarkable.
Ext: No edema. Monofilament 10g — intact bilaterally (5/5 sites each foot).
Labs today: A1c 8.2%, FPG 186, CMP wnl, lipids — TC 212, LDL 138, HDL 42, TG 190.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Type 2 diabetes mellitus — newly diagnosed, symptomatic hyperglycemia, A1c 8.2%.
2. Overweight — BMI 29.4, lifestyle contributor.
3. Hyperlipidemia — LDL above goal for DM (target <70 on high-intensity statin per guidelines).`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Start metformin 500 mg PO BID ×1 week → 1000 mg BID if tolerated. Diabetes education referral. Glucometer + log fasting glucose daily.

Start atorvastatin 40 mg nightly. Lifestyle: Mediterranean-style diet, 150 min/week walking.

Follow-up 4 weeks — review logs, titrate metformin, repeat BMP. Eye exam referral. Consider GLP-1 if A1c not improving by 3 months.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Rachel, your labs show diabetes. Walk me through what you have been noticing.' },
      { speaker: 'PATIENT', text: 'Thirsty all the time, up at night to use the bathroom, tired by afternoon.' },
      { speaker: 'CLINICIAN', text: 'Your A1c is eight point two — that confirms type two diabetes. We will start metformin and a statin today.' },
      { speaker: 'PATIENT', text: 'Is this because of weight? My mom had diabetes too.' },
      { speaker: 'CLINICIAN', text: 'Family history matters, yes. Diet and activity also play a role — we will address all of it together.' },
    ],
    handout: handout(
      'You have type 2 diabetes. Take metformin with meals as directed. Check fasting blood sugar each morning and write it down.',
      ['Metformin 500 mg twice daily — increase per doctor instructions', 'Check fasting glucose every morning', 'Walk 30 minutes most days', 'Diabetes education class scheduled', 'Follow up in 4 weeks'],
      ['Vomiting unable to keep fluids down', 'Confusion or fruity breath', 'Blood sugar over 400'],
      ['Any DKA symptoms', 'Severe stomach pain on metformin'],
    ),
  },
  {
    noteId: 'seed-acme-visit-rk-md-1',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Rachel',
    clinicianEmail: 'clinician@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 45,
    departmentKey: 'medical',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `4-week DM follow-up. Metformin 1000 mg BID tolerated — mild GI upset week 1 resolved. Home fasting glucose 110–145 (avg 128). Reports improved energy, nocturia reduced to 1×/night. Lost 4 lb. Attended diabetes education — counting carbs.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 124/78, BMI 28.7, Wt 174 lb.
Foot exam: no ulcers, monofilament intact.
Labs: BMP — Cr 0.8, eGFR >90. No lactic acidosis symptoms.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `T2DM — improving on metformin monotherapy; fasting glucoses trending down but A1c likely still above goal.
Hyperlipidemia — on atorvastatin 40 mg.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue metformin 1000 mg BID + atorvastatin 40 mg. A1c recheck in 8 weeks. If A1c ≥7.5%, add GLP-1 RA (discussed — patient prefers injection if needed). Continue glucometer log.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Morning sugars are mostly 110 to 145 — good direction.' },
      { speaker: 'PATIENT', text: 'Metformin was rough the first week but fine now.' },
      { speaker: 'CLINICIAN', text: 'We recheck A1c in two months. If still high we can add a weekly injection option.' },
    ],
    handout: handout(
      'Diabetes is improving. Keep taking metformin and logging morning glucose.',
      ['Metformin 1000 mg twice daily', 'Morning glucose log', 'A1c lab in 8 weeks'],
      ['Persistent vomiting', 'Blood sugar over 400'],
      ['Severe dehydration'],
    ),
  },
  {
    noteId: 'seed-acme-visit-rk-md-2',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Rachel',
    clinicianEmail: 'np.acme@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 14,
    departmentKey: 'medical',
    episodeId: EP,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `A1c follow-up. Result 7.1% (down from 8.2%). Fasting glucose avg 118. Started semaglutide 0.25 mg weekly ×4 weeks — mild nausea week 2, improving. Appetite reduced — total weight loss 18 lb since diagnosis. No hypoglycemia.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 122/76, BMI 27.2, Wt 160 lb.
Exam: unremarkable. Foot exam normal.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `T2DM — A1c 7.1%, at goal <7.5% on metformin + semaglutide. Weight loss beneficial.
Hyperlipidemia — LDL recheck pending this visit.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Increase semaglutide to 0.5 mg weekly per titration schedule. Continue metformin + statin. Repeat A1c + lipids 3 months. Annual eye exam due — referral renewed.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'A1c is seven point one — you hit goal. How is the weekly injection?' },
      { speaker: 'PATIENT', text: 'Nausea was bad briefly but much better. I am down eighteen pounds total.' },
      { speaker: 'CLINICIAN', text: 'We will increase the dose to zero point five milligrams weekly.' },
    ],
    handout: handout(
      'Great progress on diabetes. Increase semaglutide to 0.5 mg once weekly as directed.',
      ['Semaglutide 0.5 mg weekly', 'Continue metformin and statin', 'A1c recheck in 3 months'],
      ['Severe persistent vomiting', 'Signs of pancreatitis — severe abdominal pain'],
      ['Blood sugar under 70 repeatedly'],
    ),
  },
];
