import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from './helpers';

const PID = 'seed-patient-medical';
const EP_MED = 'seed-episode-seed-patient-medical';
const EP_REHAB = 'seed-episode-jp-rehab';
const EP_KNEE = 'seed-episode-jp-knee';
const EP_BH = 'seed-episode-jp-bh';

export const JAMES_PARK_VISITS: SeedVisitCorpus[] = [
  // ── Initial hypertension visit ───────────────────────────────────────────
  {
    noteId: 'seed-visit-jp-md-0',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'clinician@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 56,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: Elevated blood pressure at employer health screening.

HPI: James Park is a 54-year-old male presenting after workplace screening BP 158/96. Asymptomatic — denies chest pain, dyspnea, palpitations, headache, vision changes, or syncope. No prior formal HTN diagnosis. Has not checked BP at home before today. Reports high-sodium diet (frequent fast food, ~2–3×/week). Exercises intermittently (walks 1–2×/week). Never smoker. EtOH: 2–3 beers/week. Family hx: father with MI at age 62, mother with HTN.

PMH: Hyperlipidemia (untreated — declined statin 2023), no known DM, no CKD.
PSH: Appendectomy age 22.
Medications: None regular (occasional ibuprofen for headaches).
Allergies: NKDA.
Social: Married, works in logistics management, sedentary job with high stress recently due to company reorganization.

Review of systems: Constitutional (−) fevers, (−) weight loss. CV (−) chest pain, (−) orthopnea. Neuro (−) weakness, (−) vision changes. All other systems reviewed and negative except as noted.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 156/94 (L arm, seated, repeat 154/92), HR 76, RR 16, Temp 98.4°F, SpO2 99% RA, Ht 5'10", Wt 201 lb, BMI 28.8.

General: Well-appearing male in NAD.
HEENT: PERRLA, EOMI, oropharynx clear, no thyromegaly.
Neck: Supple, no JVD, no carotid bruits.
CV: RRR, normal S1/S2, no murmurs/rubs/gallops.
Lungs: CTAB, no wheezes/rales.
Abd: Soft, NT, ND, no HSM.
Ext: No edema, pulses 2+ bilaterally.
Neuro: CN II–XII intact, strength 5/5 throughout.

Labs (ordered today, reviewed): BMP pending. Fasting lipid panel ordered. ECG: normal sinus rhythm, no LVH by voltage criteria.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Essential hypertension, newly diagnosed (Stage 2 on screening) — asymptomatic, no end-organ damage on today's exam. ASCVD risk elevated given age, BP, lipids pending, family hx.
2. Overweight (BMI 28.8) — contributing factor; lifestyle counseling indicated.
3. Hyperlipidemia, untreated — recheck fasting lipids; likely need statin if LDL above goal per ASCVD calculator.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `HTN: Start lisinopril 10 mg PO daily. Home BP monitor provided; log AM + PM readings for 2 weeks. DASH diet handout + sodium restriction (<2300 mg/day). Goal BP <130/80 given elevated ASCVD risk.

Labs: BMP in 2 weeks (check K/Cr after ACE-I start), fasting lipid panel, A1c.

Follow-up: Return in 4 weeks for BP recheck and lab review. Call sooner for angioedema, syncope, persistent headache, or BP >180/120.

Lifestyle: Increase walking to 150 min/week. Reduce fast food. Consider stress management — offered BH referral if work stress persists (patient deferred today).

Hyperlipidemia: Will address at follow-up once lipids return.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'James, your screening blood pressure was in the high range. How have you been feeling?' },
        { speaker: 'PATIENT', text: 'Honestly fine — no headaches, no chest pain. I was surprised they flagged it.' },
        { speaker: 'CLINICIAN', text: 'That is common with high blood pressure. Any family history of heart disease or stroke?' },
        { speaker: 'PATIENT', text: 'My dad had a heart attack in his sixties. My mom takes blood pressure pills.' },
        { speaker: 'CLINICIAN', text: 'Today in office you are 156 over 94. Given your age and family history, I recommend starting medication and tracking at home.' },
        { speaker: 'PATIENT', text: 'I was hoping diet alone would be enough.' },
        { speaker: 'CLINICIAN', text: 'We will do both — lisinopril ten milligrams daily plus sodium reduction and walking. Lifestyle alone often is not enough at this level.' },
        { speaker: 'CLINICIAN', text: 'Tell me about a typical day of eating.' },
        { speaker: 'PATIENT', text: 'Fast food two or three times a week because of work. Lots of takeout on travel days.' },
        { speaker: 'CLINICIAN', text: 'Sodium adds up quickly there. We will aim under twenty-three hundred milligrams daily.' },
        { speaker: 'PATIENT', text: 'Do I need an EKG or heart ultrasound?' },
        { speaker: 'CLINICIAN', text: 'EKG today is normal. Echo not indicated yet without symptoms or end-organ damage.' },
        { speaker: 'CLINICIAN', text: 'I am ordering kidney function labs and a cholesterol panel. Come back in four weeks.' },
        { speaker: 'PATIENT', text: 'What should I watch for on the new pill?' },
        { speaker: 'CLINICIAN', text: 'Most people tolerate it well. Call if you get facial swelling, fainting, or a severe headache.' },
        { speaker: 'PATIENT', text: 'Work has been stressful — could that raise blood pressure?' },
        { speaker: 'CLINICIAN', text: 'Stress contributes. If it persists we can discuss counseling — optional today.' },
        { speaker: 'PATIENT', text: 'Let me try the pill and walking first.' },
        { speaker: 'CLINICIAN', text: 'Reasonable. Home monitor instructions are in the handout — log morning and evening.' },
        { speaker: 'PATIENT', text: 'How soon should numbers come down?' },
        { speaker: 'CLINICIAN', text: 'Often two to four weeks for a meaningful drop. Do not stop the pill if you feel fine.' },
        { speaker: 'CLINICIAN', text: 'Any alcohol or tobacco?' },
        { speaker: 'PATIENT', text: 'Two or three beers on weekends. Never smoked.' },
        { speaker: 'CLINICIAN', text: 'Keep alcohol moderate. Walk thirty minutes most days — start where you are.' },
        { speaker: 'PATIENT', text: 'Thank you — I am ready to take this seriously.' },
      ],
      35,
    ),
    handout: handout(
      'You have high blood pressure. Start lisinopril 10 mg every morning. Check blood pressure at home twice daily. Eat less salt and walk most days of the week.',
      ['Lisinopril 10 mg every morning', 'Home BP log — morning and evening', 'Limit salt; follow DASH diet tips', 'Walk 30 minutes most days', 'Return in 4 weeks'],
      ['Face or lip swelling', 'Fainting', 'Severe headache', 'BP over 180/120'],
      ['Any warning signs above', 'Questions about side effects'],
    ),
  },

  // ── HTN follow-up with headaches ─────────────────────────────────────────
  {
    noteId: 'seed-visit-jp-md-1',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'np.brown@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 21,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Follow-up HTN. James returns reporting headache 3–4×/week, predominantly morning, frontal, non-throbbing, 4–5/10, resolves by mid-morning. Denies photophobia, phonophobia, nausea, aura, or neurologic symptoms. Vision stable.

Home BP log (14 days, 28 readings): systolic 142–152, diastolic 88–94; average 148/92. Compliant with lisinopril 10 mg daily — no missed doses per pill count and patient report. No cough, angioedema, or dizziness.

Interval history: Work stress continues after departmental reorganization; sleep 6–7 hrs/night. Started PT for right shoulder (separate episode). BH intake scheduled. Diet: reduced fast food to 1×/week; walks 3×/week ~25 min.

PMH/PSH/Meds/Allergies: unchanged except lisinopril 10 mg daily.
ROS: CV (−) chest pain. Neuro (−) weakness, (−) numbness. Remainder negative.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 148/92 → repeat 146/90 (manual, same arm), HR 78, RR 16, Temp 98.2°F, SpO2 98% RA, Wt 198 lb (−3 lb).

General: Alert, NAD.
HEENT: PERRLA, EOMI, no papilledema (fundoscopic exam deferred — no acute indication), no sinus tenderness.
Neck: Supple, no JVD.
CV: RRR, no murmurs.
Lungs: Clear.
Abd: Soft, NT.
Ext: No edema.
Neuro: CN II–XII intact, no focal deficits, gait normal.

Labs reviewed: BMP (2 weeks ago) — Cr 0.9, K 4.2 (wnl on ACE-I). Lipids: TC 218, LDL 142, HDL 48, TG 165 — statin discussion deferred to next visit.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Essential hypertension — suboptimal control on lisinopril 10 mg (avg home BP 148/92, above goal <130/80).
2. Tension-type headache — pattern consistent with uncontrolled HTN + stress; no red flags on exam today.
3. Hyperlipidemia — LDL 142, above goal for primary prevention; lifestyle improved, statin to discuss next visit.
4. Overweight — improved (BMI 28.4, −3 lb); continue lifestyle measures.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Increase lisinopril to 20 mg PO daily. Continue home BP log × 2 weeks. Low-sodium diet reinforced.

Headache: Return precautions reviewed (thunderclap, vision loss, fever/neck stiffness). If headaches persist after BP at goal × 4 weeks, consider dedicated headache eval.

Statin: Discuss rosuvastatin 10 mg at next visit if LDL remains >130.

Follow-up: 2 weeks for BP recheck (may add HCTZ 12.5 mg if not at goal). Full visit in 3 months for lipid recheck.

Coordination: Aware of PT for shoulder and pending BH — supportive of multimodal stress management.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Good morning James. You have been on lisinopril about a month — how are things going?' },
      { speaker: 'PATIENT', text: 'Better in some ways — I lost a few pounds — but I am getting headaches most mornings and my home BP is still high.' },
      { speaker: 'CLINICIAN', text: 'Walk me through the headaches — location, severity, anything that triggers them?' },
      { speaker: 'PATIENT', text: 'Front of the head, maybe a five out of ten, usually when I wake up. Gone by lunch. No vision problems.' },
      { speaker: 'CLINICIAN', text: 'Your log shows an average of 148 over 92. That is better than before medication but not at goal yet.' },
      { speaker: 'PATIENT', text: 'Should we increase the dose?' },
      { speaker: 'CLINICIAN', text: 'Yes — I want to move you to twenty milligrams daily and recheck in two weeks. Morning headaches often improve once pressure is controlled.' },
      { speaker: 'CLINICIAN', text: 'Your kidney labs looked fine on the current dose. Any cough or swelling?' },
      { speaker: 'PATIENT', text: 'No, no side effects.' },
      { speaker: 'CLINICIAN', text: 'Call immediately for sudden worst headache of your life or vision changes. Otherwise see you in two weeks.' },
    ],
    handout: handout(
      'Your blood pressure is improving but still too high. Increase lisinopril to 20 mg each morning. Keep logging readings twice daily.',
      ['Lisinopril 20 mg every morning starting today', 'BP log twice daily for 2 weeks', 'Continue low-salt diet and walking', 'Return in 2 weeks'],
      ['Sudden severe headache', 'Vision loss or double vision', 'Facial swelling', 'BP consistently above 180/120'],
      ['Any warning signs', 'Side effects that concern you'],
    ),
  },

  // ── BP recheck — at goal ─────────────────────────────────────────────────
  {
    noteId: 'seed-visit-jp-md-2',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'np.brown@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 5,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `2-week follow-up after lisinopril increase to 20 mg. Headaches reduced to 1×/week, mild. Home BP log: avg 128/82 (range 122–134 / 78–86). Compliant with medication. No cough, dizziness, or edema. Continues PT 2×/week for shoulder — reports improvement. Attended 2 BH sessions — finds CBT helpful for work stress. Sleep improved to 7–8 hrs.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 128/80, HR 72, Wt 197 lb.
General: NAD.
CV: RRR, no murmurs.
Lungs: Clear.
Ext: No edema.
Neuro: Non-focal.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Essential hypertension — at goal on lisinopril 20 mg (avg home 128/82, office 128/80).
2. Tension-type headache — improved with BP control.
3. Hyperlipidemia — LDL 142 on prior panel; statin still indicated — start today.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue lisinopril 20 mg daily. Start rosuvastatin 10 mg PO nightly. Repeat BMP + lipids in 3 months.

Home BP: Continue weekly checks (2×/week sufficient now at goal).

Follow-up: 3 months routine, sooner PRN. Continue PT/BH as scheduled.

Patient educated on statin muscle pain warning — stop and call if severe myalgias.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Your blood pressure log looks excellent — averaging 128 over 82.' },
      { speaker: 'PATIENT', text: 'Headaches are mostly gone. Only had one mild one this week.' },
      { speaker: 'CLINICIAN', text: 'Great response to the dose increase. Today we will add a cholesterol medication — your LDL was 142.' },
      { speaker: 'PATIENT', text: 'Okay — rosuvastatin, you said? At bedtime?' },
      { speaker: 'CLINICIAN', text: 'Ten milligrams at night. Call if you get severe muscle pain. See you in three months.' },
    ],
    handout: handout(
      'Blood pressure is now in a good range. Keep taking lisinopril 20 mg. Start rosuvastatin 10 mg at bedtime for cholesterol.',
      ['Lisinopril 20 mg every morning — continue', 'Rosuvastatin 10 mg every night — new', 'Check BP twice weekly', 'Return in 3 months'],
      ['Severe muscle pain or weakness', 'Dark urine', 'Sudden severe headache'],
      ['Muscle pain that limits daily activity', 'Any concerns about new medications'],
    ),
  },

  // ── PT evaluation — shoulder ───────────────────────────────────────────
  {
    noteId: 'seed-visit-jp-pt-0',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 35,
    departmentKey: 'rehab',
    episodeId: EP_REHAB,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Initial PT eval. James reports 4-week hx right shoulder pain after lifting boxed office supplies overhead at work. Pain 7/10 at worst with reaching, 3/10 at rest. Night pain when lying on R side. No trauma, no neck radiation, no numbness/tingling in hand. Tried ibuprofen with partial relief. Goal: return to overhead work tasks without pain.

Prior treatment: None. PMH: HTN (on lisinopril).`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Observation: Mild forward head, protracted scapulae.
ROM (goniometer): Flexion 115° (painful arc 80–120°), abduction 110°, ER at 90° abduction 35°, IR to T12.
MMT: Supraspinatus 3+/5, infraspinatus 4-/5, middle trap 4/5.
Special tests: Empty-can (+), Hawkins-Kennedy (+), Neer (+). Drop-arm (−).
Palpation: TTP supraspinatus tendon, upper trap.
Functional: Unable to reach top shelf without pain; dressing overhead difficult.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Patient education: rotator cuff strain/heavy strain mechanism, activity modification (avoid overhead lifting >5 lb × 2 weeks).
Manual: grade II GH joint mobs, soft-tissue to upper trap.
Exercise (instructed): pendulum 2×30 sec, AAROM wand flexion 2×10, scapular retraction 2×10.
Modalities: moist heat 10 min.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Tolerated eval well. Pain 5/10 post-treatment (from 7/10 pre). Verbalized understanding of HEP and precautions.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG established: Pain-free overhead reach to 160° within 8 weeks.
STG (2 weeks): Active flexion ≥120° with pain ≤5/10.
STG (4 weeks): ER strength 4+/5, sleep on R side without waking.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `PT 2×/week × 8 weeks. HEP daily: pendulum, wand, scapular sets. Progress to band ER week 3 if ROM permits. Reassess at visit 4. Physician referral on file — no imaging indicated today.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Tell me exactly what happened with your shoulder.' },
      { speaker: 'PATIENT', text: 'I was moving supply boxes overhead at the warehouse office — felt a pull in the front of the shoulder.' },
      { speaker: 'CLINICIAN', text: 'Show me how high you can lift the arm now.' },
      { speaker: 'PATIENT', text: 'About here — sharp pain around shoulder height.' },
      { speaker: 'CLINICIAN', text: 'Tests suggest rotator cuff strain rather than a tear. We will work on range and scapular control.' },
      { speaker: 'PATIENT', text: 'How long until I can lift at work again?' },
      { speaker: 'CLINICIAN', text: 'Roughly six to eight weeks if you stay consistent with therapy and home exercises.' },
    ],
    handout: handout(
      'You strained the rotator cuff in your right shoulder. Avoid heavy overhead lifting for now. Do your home exercises daily.',
      ['Pendulum swings 2× daily', 'Wand exercises 2× daily', 'Scapular squeezes 2×10', 'No lifting overhead >5 lb for 2 weeks', 'PT twice weekly'],
      ['Sudden inability to lift arm', 'Numbness in hand', 'Pain above 8/10 not improving'],
      ['Sharp pain with new weakness', 'Questions about work restrictions'],
    ),
  },

  // ── PT progress — shoulder (expanded) ────────────────────────────────────
  {
    noteId: 'seed-visit-jp-pt-1',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 14,
    departmentKey: 'rehab',
    episodeId: EP_REHAB,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 5 of 16. Pain 6/10 overhead (improved from 8/10 visit 1), 2/10 at rest. Sleeping on R side 2–3 nights/week now vs never at intake. HEP compliance 5/7 days. Work: modified duty — no overhead lifting; employer accommodating.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `ROM: Flexion 140° (was 115° intake, 120° visit 3), abduction 130°, ER 90/45° (improved from 35°).
MMT: Supraspinatus 4-/5 (was 3+/5), infraspinatus 4/5.
Special tests: Empty-can mildly (+), Hawkins (+) only at end-range.
Painful arc diminished — now 110–130° vs 80–120° at intake.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Manual: STM upper trap/levator, grade II–III GH mobs.
Ther ex: scapular retraction 3×15, ER band 3×12 (yellow band), wall slides 3×10, prone Y 2×10.
Modalities: moist heat 10 min.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Good tolerance. Pain 4/10 post-tx. Improved scapular control with minimal verbal cueing.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG (pain-free overhead 160°): partially met — 140° flexion, pain at end-range only.
STG flexion ≥120°: MET.
STG ER 4+/5: in progress (4/5 today).`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue 2×/week × 4 more weeks. Progress to green band ER. Add prone T/W next visit. Reassess visit 8 for discharge planning vs extension.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'How has the shoulder been since last time?' },
      { speaker: 'PATIENT', text: 'Better — overhead still hurts but more like a six instead of an eight.' },
      { speaker: 'CLINICIAN', text: 'Flexion is one-forty today. We will add resisted external rotation with the band.' },
      { speaker: 'PATIENT', text: 'I have been doing the home program most days.' },
      { speaker: 'CLINICIAN', text: 'That shows — keep it up. Pain down to four after treatment today.' },
    ],
    handout: handout(
      'Shoulder mobility is improving. Continue daily exercises and avoid heavy overhead lifting until cleared.',
      ['Band ER 12 reps daily', 'Scapular squeezes 15 reps twice daily', 'Wall slides 10 reps', 'PT twice weekly'],
      ['Sharp pain during exercises', 'New numbness in arm'],
      ['Pain above 8/10', 'Cannot sleep due to shoulder pain'],
    ),
  },

  // ── BH intake ────────────────────────────────────────────────────────────
  {
    noteId: 'seed-visit-jp-bh-0',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 21,
    departmentKey: 'bh',
    episodeId: EP_BH,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Intake session. James self-referred (also PCP-suggested) for work-related stress after departmental reorganization 8 weeks ago. Reports persistent worry about job security, difficulty "turning off" after work, irritability at home, sleep latency 60–90 min. Denies panic attacks, substance use, or prior BH treatment.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Casual business attire, groomed. Behavior: Cooperative, psychomotor mild agitation (leg bounce). Speech: Normal rate/volume. Mood: "On edge." Affect: Anxious, congruent, full range. Thought process: Linear, some circumstantiality around work topics. Thought content: No SI/HI/AVH. Cognition: A&O ×4, concentration fair. Insight/Judgment: Good/fair.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `C-SSRS: negative across all domains. GAD-7: 12 (moderate). PHQ-9: 8 (mild). No SI/HI, plan, means, or intent. Protective factors: married, employed, engaged in care, no prior attempts. Safety plan reviewed — patient agrees to call crisis line or 988 if distress escalates.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Psychoeducation: stress response, CBT model (thoughts-feelings-behaviors). Introduced thought record worksheet. Sleep hygiene basics (consistent wake time, stimulus control). 4-7-8 breathing demo — patient practiced ×3 cycles.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Weekly CBT × 12 weeks (adjust per progress). Homework: thought record ×2, sleep log, breathing 2×/day. Re-administer GAD-7/PHQ-9 at visit 4. Coordinate with PCP re: HTN/stress interplay — patient consents to share GAD-7 trend.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Patient declined spousal session today; open to future. Will notify PCP of BH engagement with signed ROI.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'What made you decide to come in now?' },
      { speaker: 'PATIENT', text: 'Work has been chaotic since the reorg. I lie awake replaying conversations worried I will be cut.' },
      { speaker: 'CLINICIAN', text: 'When you get that email from your manager, what is the first thought?' },
      { speaker: 'PATIENT', text: 'That I am on the list — even when there is no evidence.' },
      { speaker: 'CLINICIAN', text: 'We will work on catching those thoughts and testing them against facts. I also want to track sleep.' },
      { speaker: 'PATIENT', text: 'My wife says I am snappy — I do not want stress to spill over at home.' },
      { speaker: 'CLINICIAN', text: 'Understandable. Weekly sessions, and I will teach you a breathing technique today.' },
    ],
    handout: handout(
      'Stress after big work changes is common and treatable. Track worried thoughts and practice breathing twice daily.',
      ['Thought record twice this week', 'Same wake time every day', '4-7-8 breathing twice daily', 'Weekly therapy appointments'],
      ['Thoughts of harming yourself', 'Unable to function at work for a week'],
      ['Any suicidal thoughts — call 988', 'Panic that will not settle'],
    ),
  },

  // ── BH session — progress ────────────────────────────────────────────────
  {
    noteId: 'seed-visit-jp-bh-1',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 7,
    departmentKey: 'bh',
    episodeId: EP_BH,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 4. James reports continued work stress but improved coping — used thought record when manager scheduled extra meetings. Sleep onset improved to 30–45 min with CBT-I techniques. Still ruminates 2–3 nights/week. Less irritable at home per patient and spouse.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Casual, groomed. Behavior: Cooperative, less psychomotor agitation than intake. Mood: "Stressed but coping better." Affect: Mildly anxious, congruent, reactive. Speech: Normal. Thought process: Linear, goal-directed. Thought content: No SI/HI. Cognition: Alert, oriented ×4. Insight/Judgment: Good.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `Denies SI/HI. GAD-7 today: 8 (down from 12 at intake). PHQ-9: 7 (down from 8). Safety plan reviewed — still valid.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `CBT: cognitive restructuring of catastrophizing re: job loss; reviewed completed thought records — identified "probability overestimation" pattern. Behavioral activation: scheduled 2 pleasant activities (walk with spouse, basketball with friend). Sleep: reinforced stimulus control — no phones in bed.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue weekly CBT. Homework: thought record 3×/week, behavioral activation log. Re-screen GAD-7 visit 6. Coordinate with PCP — BP improved per patient (sees NP this week).`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `ROI to PCP for GAD-7 trend — patient signed. No family session requested.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'How has this week been with the work changes?' },
      { speaker: 'PATIENT', text: 'Still stressful, but I used the thought record when they added meetings. Helped me not spiral.' },
      { speaker: 'CLINICIAN', text: 'Your GAD-7 dropped from twelve to eight — meaningful progress.' },
      { speaker: 'PATIENT', text: 'Sleep is better too — usually under an hour to fall asleep now.' },
      { speaker: 'CLINICIAN', text: 'Let us plan two enjoyable activities this week — you mentioned walking with Sarah.' },
      { speaker: 'PATIENT', text: 'Yeah, we did that Sunday. I want to keep that up.' },
    ],
    handout: handout(
      'You are making progress managing work stress. Keep using thought records and schedule pleasant activities.',
      ['Thought record 3 times this week', 'One pleasant activity daily', 'No phones in bed', 'Continue weekly therapy'],
      ['Thoughts of self-harm', 'Panic lasting over 20 minutes'],
      ['988 if suicidal thoughts', 'Call if anxiety becomes unmanageable'],
    ),
  },

  // ── James Park — PT evaluation, LEFT KNEE (OA) ──────────────────────────
  // Concurrent with shoulder PT — shows two active REHAB episodes on the
  // same chart so the "By episode" view has two distinct REHAB buckets.
  {
    noteId: 'seed-visit-jp-knee-0',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 32,
    departmentKey: 'rehab',
    episodeId: EP_KNEE,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Initial PT evaluation — left knee pain. James reports 6-month gradual onset of left knee pain, worse with prolonged walking (>20 min), stairs, and rising from low chairs. Rates pain 6/10 with stairs, 3/10 at rest. No acute injury. Outside X-ray: moderate medial compartment OA, joint space narrowing. Goals: walk 30 min without pain, return to recreational basketball with son on flat surfaces.

PMH: HTN (lisinopril + rosuvastatin), R rotator cuff strain (concurrent PT). No prior knee surgery. BMI 28.4. Allergies: NKDA.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Observation: mild varus alignment L knee, antalgic gait pattern favoring L side with increased lateral trunk lean.
ROM: L knee flexion 115° (limited by pain, end-feel firm), extension 0°.
MMT: quad 4/5, hip abductor 3+/5, glute med 4-/5 (key deficit).
Special: medial joint line tenderness ++, valgus stress test (−), Lachman (−), McMurray (−).
Functional: stair descent 6/10 pain, single-leg squat L reveals dynamic valgus, TUG 13.8 sec.
KOOS-PS (Knee injury and Osteoarthritis Outcome Score): 48/100 (moderate dysfunction).`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Patient education: OA mechanism, load management, joint protection (avoid high-impact loading until pain controlled).
Therapeutic exercise: seated quad sets 3×15, terminal knee extension 3×12, side-lying hip abduction 3×12.
Manual: grade II–III tibiofemoral joint mobs (anterior glide), patellar mobilization superior/inferior.
Modalities: moist heat 10 min pre-treatment.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Tolerated eval well. Pain 4/10 post-treatment (from 6/10). Demonstrates good body mechanics with verbal cuing on stair descent. HEP instructions reviewed and verbalized.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG established: Pain ≤2/10 stairs + TUG <12 sec within 8 weeks.
STG (2 weeks): hip abductor MMT ≥4/5; stair pain ≤4/10.
STG (4 weeks): KOOS-PS ≥65; level walking 20 min without pain.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `PT 2×/week × 8 weeks. HEP: quad sets, TKE, hip abduction, heel slides — 2×daily. Activity modification: pool walking or cycling preferred over pavement running. Reassess KOOS-PS at week 4. Coordinate with PCP re: NSAID trial if pain limits progress by visit 4.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'James, tell me what the left knee has been doing lately.' },
      { speaker: 'PATIENT', text: 'Getting worse over the past six months. Stairs are the worst — left knee aches all the way down.' },
      { speaker: 'CLINICIAN', text: 'X-ray shows moderate arthritis in the medial compartment. The good news is PT typically makes a meaningful difference with OA knee.' },
      { speaker: 'PATIENT', text: 'I am already doing shoulder PT with you — is it okay to do both?' },
      { speaker: 'CLINICIAN', text: 'Absolutely — we can combine sessions. The hip strengthening we do for the knee also helps your shoulder posture.' },
      { speaker: 'PATIENT', text: 'My son and I used to shoot hoops — I want to get back to that.' },
      { speaker: 'CLINICIAN', text: 'That is a reasonable goal on a flat court once pain is under control. We will get there.' },
    ],
    handout: handout(
      'Your left knee has arthritis. Targeted exercises can reduce pain significantly. Do your exercises twice daily and avoid high-impact activity for now.',
      ['Quad sets: 15 reps twice daily', 'Terminal knee extensions: 12 reps twice daily', 'Hip abduction side-lying: 12 reps each side', 'PT twice weekly', 'Walk on flat surfaces; avoid stairs when not needed'],
      ['Sudden severe knee swelling or locking', 'Pain above 8/10 during exercises', 'New giving-way episodes'],
      ['Sudden inability to bear weight', 'Signs of joint infection — fever with hot swollen knee'],
    ),
  },

  // ── James Park — Knee PT visit 4 (progress) ─────────────────────────────
  {
    noteId: 'seed-visit-jp-knee-1',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 18,
    departmentKey: 'rehab',
    episodeId: EP_KNEE,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 4/16. Left knee pain 4/10 stairs (was 6/10 at eval), 1/10 level. HEP compliance ~6/7 days — skipped once due to shoulder session fatigue. Walked 25 min with dog on flat trail — manageable. Reports noticing "knee wobbles less going down stairs."`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `ROM: L knee flexion 120° (was 115°), ext 0°.
MMT: quad 4/5, hip abductor 4-/5 (improved from 3+/5).
TUG: 12.4 sec (was 13.8 sec at eval).
Single-leg squat: dynamic valgus reduced — now mild only at fatigue (3rd rep).
Gait: reduced antalgic deviation on L, trunk lean improved.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Progression: TKE with resistance band 3×15, wall squats holding 10 sec 3×8, lateral band walks 3×15.
Manual: grade III tibiofemoral AP mobs, patellar glides.
Neuromuscular: step-down eccentric 3×8 (6" step).`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Tolerated progression without pain flare. Pain 3/10 with step-down (improved from 6/10 on eval stairs). Performed 3 reps of single-leg squat with cues.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `STG hip abductor ≥4/5 — MET (4-/5 today, progressing).
STG stair pain ≤4/10 — MET (4/10 today).
LTG TUG <12 sec — in progress (12.4 today, was 13.8).
KOOS-PS reassessment due next visit (week 4).`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue 2×/week. Add mini-squat with resistance band next visit. KOOS-PS at visit 5. Discussed cycling as cross-training — James confirmed access to stationary bike at work gym. NSAID trial deferred — progressing well without.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'How is the left knee feeling compared to two weeks ago?' },
      { speaker: 'PATIENT', text: 'Stairs are easier — maybe a four instead of a six. I walked the dog for twenty-five minutes with no problem.' },
      { speaker: 'CLINICIAN', text: 'Hip strength improved nicely. Let us add step-downs today and some band resistance.' },
      { speaker: 'PATIENT', text: 'I have a stationary bike at the office gym — should I be using that?' },
      { speaker: 'CLINICIAN', text: 'Yes — cycling is excellent for knee OA. Start with twenty minutes, low resistance, seat high enough so knee only bends to about ninety degrees.' },
    ],
    handout: handout(
      'Knee is responding well to therapy. Add stationary cycling as extra exercise if available.',
      ['Band TKE: 15 reps twice daily', 'Wall squat hold: 8 reps', 'Hip abduction: 15 reps twice daily', 'Stationary bike 20 min, low resistance — daily if possible', 'PT twice weekly'],
      ['Knee swelling that does not settle overnight', 'Sharp pain during bike — stop and call'],
      ['Sudden increase in swelling or locking'],
    ),
  },

  // ── James Park — Knee PT visit 8 (mid-point re-evaluation) ──────────────
  {
    noteId: 'seed-visit-jp-knee-2',
    patientId: PID,
    patientFirstName: 'James',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 4,
    departmentKey: 'rehab',
    episodeId: EP_KNEE,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 8/16 — formal mid-point re-evaluation. Left knee pain 2/10 stairs, 0–1/10 level. Shot baskets with son for 15 min on flat court — mild ache afterward, resolved overnight. Cycling 20 min 4×/week at the office. Shoulder PT progressing concurrently.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `ROM: L knee flexion 130° (was 115° at eval), ext 0°.
MMT: quad 4+/5, hip abductor 4+/5.
TUG: 11.1 sec — below fall-risk threshold, approaching LTG <12.
Single-leg squat: dynamic valgus absent × 5 reps.
Gait: symmetrical cadence, no trunk lean.
KOOS-PS: 74/100 (was 48 at eval — 26-point improvement, exceeds 12-point MCID).`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Advanced strengthening: Bulgarian split squat 3×8 BW, lateral step-ups 8" 3×10, single-leg press light resistance 2×12.
Agility: lateral shuffle 3×20 ft (introduced — basketball prep).
Manual: patellar mobilization maintenance.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Excellent tolerance. Pain 1/10 post-session. Patient motivated by basketball milestone — subjectively reports "feels like a different knee."`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG pain ≤2/10 stairs — MET (2/10 today).
LTG TUG <12 sec — MET (11.1 sec).
KOOS-PS improvement 26 points — exceeds MCID, clinically meaningful.
Remaining focus: stair confidence at speed, return to recreational basketball.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue PT 2×/week × 4 more visits then discharge planning. Progress agility drills toward basketball movements. Begin discharge HEP with maintenance program. Coordinate with PCP at next medical visit to update knee status.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Mid-point check-in — how is the knee at eight visits?' },
      { speaker: 'PATIENT', text: 'Two out of ten on stairs. I played basketball with my son last week — fifteen minutes. Felt great.' },
      { speaker: 'CLINICIAN', text: 'KOOS score went from forty-eight to seventy-four — that is a twenty-six point jump. You exceeded the benchmark for meaningful improvement.' },
      { speaker: 'PATIENT', text: 'The cycling really helped I think.' },
      { speaker: 'CLINICIAN', text: 'Absolutely — it built the quad strength without loading the joint. We will add lateral agility drills today to prep you for the court.' },
    ],
    handout: handout(
      'Left knee is much better — your score improved by 26 points. Keep exercising to maintain your gains.',
      ['Continue HEP: TKE, split squat, hip abduction', 'Cycling 20 min daily', 'Basketball on flat court — up to 30 min with warm-up', '4 more PT visits before discharge', 'Update PCP at next visit'],
      ['Sharp knee pain with new activities', 'Significant swelling after basketball'],
      ['Locking or giving way', 'Pain above 5/10 that does not settle in 24 hours'],
    ),
  },
];
