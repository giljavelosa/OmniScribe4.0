import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from '../helpers';

const ORG_ID = 'seed-cascadia-clinic';
const SITE_MAIN = 'seed-cascadia-site-main';
const SITE_REHAB = 'seed-cascadia-site-rehab';

const PID = 'seed-cascadia-patient-priya';
const EP_MED = 'seed-cascadia-episode-priya-medical';
const EP_CERVICAL = 'seed-cascadia-episode-priya-cervical';
const EP_WRIST = 'seed-cascadia-episode-priya-wrist';
const EP_BH = 'seed-cascadia-episode-priya-bh';

/** Priya — headline 30-minute migraine consultation. */
const PRIYA_HEADLINE: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-pd-md-headline',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Priya',
  clinicianEmail: 'md.harper@cascadia.local',
  division: Division.MEDICAL,
  templateId: 'seed-tmpl-medical-soap',
  signedDaysAgo: 12,
  departmentKey: 'medical',
  episodeId: EP_MED,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Chief complaint: Comprehensive migraine consultation — escalating headache frequency and disability over 6 months.

HPI: Priya Desai is a 41-year-old female software engineer presenting for an extended migraine review. Reports 12+ migraine days per month over the past 6 months (was 4–6 days/month for the prior 5 years). Migraines are unilateral (most often right temporal-frontal), pulsating, 7–9/10 at peak, with photophobia, phonophobia, and nausea. Visual aura preceding 50% of attacks (15–20 min of fortification spectra in left visual field). Attacks last 6–24 hours if untreated; sumatriptan 50 mg has been variably effective (resolves attack in 60% of uses). Has used 8–10 doses/month for past 3 months — meets medication-overuse threshold for triptan use.

Triggers identified: poor sleep, prolonged screen time without breaks (frequent in current sprint cycle), red wine, and menstruation onset. Sleep onset latency 45–75 min nightly with intrusive worry about deadlines. Concurrent neck and trapezius tightness — referred to PT 3 weeks ago for cervicogenic headache component.

Perimenopausal symptom interval: hot flashes 4–5×/day past 4 months, sleep disruption from night sweats 3 nights/week, irregular cycles (last 4 cycles 21–38 days). Mood lability premenstrually. Negative pregnancy test today (per patient self-report; offered confirm).

PMH: Migraine with aura, GAD (in BH care with Tasha Bennett), R wrist tendinopathy (in OT with Hannah Fischer), no DM, no HTN, no cardiac risk factors, never smoker.
PSH: None.
Medications: Sumatriptan 50 mg PRN, naproxen 500 mg PRN (adds to MOH risk), magnesium oxide 400 mg daily, riboflavin 400 mg daily.
Allergies: NKDA.
Social: Married, two children ages 8 and 12, software engineer at startup, sedentary work, screens 9–10 hr/day. EtOH 2–3 glasses wine/week (mostly weekends).
Family hx: mother migraine (resolved post-menopause), father HTN, no aneurysm or stroke before age 50.

ROS — comprehensive: Constitutional (−) fevers, (−) weight changes. HEENT (+) photophobia and phonophobia during attacks; (−) jaw claudication; (−) temporal scalp tenderness between attacks. CV (−) chest pain (important — relevant to triptan use). Resp (−) dyspnea. Neuro (+) visual aura with attacks; (−) prolonged neuro deficits, (−) confusion, (−) speech changes. Psych (+) anxiety; (−) SI/HI. GU (+) cycle irregularity, (+) hot flashes, (−) abnormal bleeding. MSK (+) cervical and trap tightness; (+) right wrist pain typing.

Red flags reviewed: SNOOP4 — no systemic features, no neuro deficits, no sudden onset, no pattern change suggestive of secondary, no positional/Valsalva, no papilledema, no progressive course beyond increased frequency. No imaging indication.`,
    },
    {
      id: 'objective',
      label: 'Objective',
      content: `Vitals: BP 116/72, HR 70, BMI 23.8, Wt 138 lb, Temp 98.2°F, SpO2 99% RA.

General: Pleasant, NAD, slightly pale. Today is a non-headache day (last attack 4 days ago).
HEENT: PERRLA, EOMI, no scleral injection, fundi without papilledema (briefly visualized non-dilated), no temporal scalp tenderness, no TMJ click, oropharynx clear, no thyromegaly.
Neck: Forward head posture, marked upper trap tightness bilateral R > L, suboccipital tenderness right > left, cervical flexion 50° (limited by tightness), rotation R 65° / L 70°, extension 50° with mild reproduction of headache near end-range (positive cervical flexion-rotation suggesting C1-C2 involvement).
Right wrist: tenderness over 2nd dorsal compartment, mild swelling, Finkelstein negative, resisted thumb extension reproduces pain (consistent with EPL tendinopathy/extensor strain).
CV: RRR, no murmurs.
Lungs: CTAB.
Neuro: CN II–XII intact, motor 5/5 throughout, sensation intact, reflexes 2+ symmetric, gait normal, Romberg negative, finger-to-nose intact.
Psych: euthymic, no acute distress today.

In-office screens: PHQ-9 6, GAD-7 9, MIDAS score 26 (severe disability — 11+ is severe).
Headache log review: 14 headache days last 28-day cycle (was 6 in baseline year 1). Triptan doses: 9 in last 28 days.
Labs reviewed (recent): TSH 2.1, CBC wnl, BMP wnl, vitamin D 32. FSH/LH not yet checked — order today.`,
    },
    {
      id: 'assessment',
      label: 'Assessment',
      content: `1. Chronic migraine (15+ headache days/month meets ICHD-3 threshold next cycle if continues — currently 14 — at high-frequency episodic) with aura — escalation likely multifactorial: medication overuse (triptan ≥10 days/month threshold), sleep disruption, perimenopausal hormonal shift, occupational ergonomics, cervical mechanical contribution.

2. Probable medication-overuse component — triptan use 9–10 days/month for 3 months. Detoxification + transition to preventive therapy indicated.

3. Cervicogenic contribution — positive flexion-rotation, suboccipital tenderness, prolonged screen time. Active in PT (separate episode).

4. Generalized anxiety disorder — GAD-7 9, in BH care (active episode).

5. Perimenopausal symptoms — irregular cycles, hot flashes, night sweats. FSH/LH today; estrogen-containing therapy contraindicated given migraine with aura (stroke risk).

6. Right wrist extensor tendinopathy — repetitive strain, in OT (active episode).`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Migraine — preventive therapy:
- Start propranolol LA 60 mg daily (titrate up to 120 mg over 4 weeks if tolerated). Counseled on contraindications, exercise tolerance, dose timing.
- Continue magnesium oxide 400 mg daily and riboflavin 400 mg daily.
- Limit triptan to ≤6 days/month strictly — switch to NSAIDs alternating (avoid both same day) — but cap NSAID at ≤6 days/month also.
- Headache diary daily.

Acute therapy:
- Sumatriptan 100 mg (increase from 50) for the most disabling attacks; rescue with prochlorperazine 10 mg if no relief in 2 hours.

Lifestyle:
- Sleep: target 7–8 hr, fixed wake time, no screens 1 hr before bed; coordinate with BH for CBT-I.
- Hydration ≥2 L/day, regular meal timing.
- Identify and limit red wine on PMS days.
- Screen breaks: 20-20-20 rule, ergonomic check (also addressed in OT/PT).

Perimenopausal:
- Order FSH, LH, estradiol today.
- Avoid estrogen-containing contraceptives (migraine with aura — stroke contraindication). Vaginal estrogen acceptable if needed for GU symptoms; SSRIs/SNRIs, gabapentin, or oxybutynin acceptable for vasomotor symptoms.

Coordination:
- Continue cervical PT with Dr. Morales — share migraine plan.
- Continue OT for wrist with Dr. Fischer.
- Continue weekly BH with Tasha Bennett — discuss CBT-I component.

Follow-up:
- 4 weeks for propranolol titration response, BP/HR check.
- Repeat MIDAS in 12 weeks. Goal MIDAS <11, headache days ≤4/month.
- Sooner for any thunderclap headache, neuro deficit, severe BP changes, or persistent aura without headache lasting >60 min.

Patient education:
- Reviewed SNOOP4 red flags (sudden, neuro, onset >50, pattern change, positional/Valsalva, papilledema, progressive). Reviewed propranolol side effects (fatigue, exercise intolerance, vivid dreams). Reviewed why estrogen contraception is unsafe with aura.`,
    },
  ],
  transcript: timedTranscript(
    [
      { speaker: 'CLINICIAN', text: 'Priya, your migraine days have doubled in six months. Tell me what changed.' },
      { speaker: 'PATIENT', text: 'Sprint deadlines, sleep got worse, and my cycles have been all over the map.' },
      { speaker: 'CLINICIAN', text: 'Your MIDAS score is twenty-six — that is severe disability. How many sumatriptans last month?' },
      { speaker: 'PATIENT', text: 'Nine I think. Sometimes ten.' },
      { speaker: 'CLINICIAN', text: 'That is at the threshold for medication overuse — using triptans more than ten days a month can actually drive headache frequency up.' },
      { speaker: 'PATIENT', text: 'I had no idea. I am taking them to function.' },
      { speaker: 'CLINICIAN', text: 'I know — and we are going to break that cycle by starting a daily preventive. Propranolol is my first choice for you.' },
      { speaker: 'PATIENT', text: 'Will it slow me down? I run twice a week.' },
      { speaker: 'CLINICIAN', text: 'Some exercise tolerance reduction is possible. We start at sixty milligrams long-acting once daily and see how you feel for a week.' },
      { speaker: 'CLINICIAN', text: 'Tell me about the auras.' },
      { speaker: 'PATIENT', text: 'Zigzag lights in my left visual field, fifteen minutes, then the headache hits.' },
      { speaker: 'CLINICIAN', text: 'Classic visual aura. That matters because estrogen-based birth control is off the table for you — small but real stroke risk with aura migraine.' },
      { speaker: 'PATIENT', text: 'My cycle has been weird so I had wondered.' },
      { speaker: 'CLINICIAN', text: 'We will check FSH and LH today to see where you are perimenopausally. If you need vasomotor symptom relief, several non-estrogen options are safe.' },
      { speaker: 'PATIENT', text: 'OK.' },
      { speaker: 'CLINICIAN', text: 'Cervical exam today positive for flexion-rotation — your physical therapist is treating that. Keep that going.' },
      { speaker: 'PATIENT', text: 'Three sessions in. The trap tightness is better.' },
      { speaker: 'CLINICIAN', text: 'And the wrist — Hannah is treating that with OT.' },
      { speaker: 'PATIENT', text: 'Yes — the typing posture changes are helping.' },
      { speaker: 'CLINICIAN', text: 'The anxiety and sleep piece needs work too. Sleep latency seventy-five minutes and stress at work — that drives migraines.' },
      { speaker: 'PATIENT', text: 'Tasha and I have started CBT-I.' },
      { speaker: 'CLINICIAN', text: 'Good — coordinate that fully. I will keep your acute meds: sumatriptan one hundred milligrams for the bad ones, capped at six days a month.' },
      { speaker: 'PATIENT', text: 'What if I run out of options on a really bad day?' },
      { speaker: 'CLINICIAN', text: 'I am giving you prochlorperazine ten milligrams as rescue if the triptan does not break it in two hours.' },
      { speaker: 'CLINICIAN', text: 'Headache diary daily — note triggers, sleep, period, treatments. Bring it back in four weeks for our titration check.' },
      { speaker: 'PATIENT', text: 'Will I see a benefit that fast?' },
      { speaker: 'CLINICIAN', text: 'Some patients see a difference in two weeks. Full preventive effect takes eight to twelve weeks.' },
      { speaker: 'CLINICIAN', text: 'Red flags — call immediately for thunderclap headache, weakness or numbness that lasts beyond an hour, sudden severe vision change, fever with stiff neck.' },
      { speaker: 'PATIENT', text: 'Got it. Thank you for the longer visit.' },
    ],
    34,
  ),
  handout: handout(
    'Migraines have escalated due to several stacked triggers. We are starting a daily preventive medicine and limiting how often you take rescue medications.',
    [
      'Propranolol LA 60 mg every morning (will titrate)',
      'Sumatriptan 100 mg for severe attacks — no more than 6 days/month',
      'Prochlorperazine 10 mg as rescue if triptan does not break attack in 2 hours',
      'Magnesium 400 mg + riboflavin 400 mg daily — continue',
      'Headache diary every day',
      'Fixed wake time, no screens 1 hour before bed',
      'Limit red wine — known trigger',
      'Continue cervical PT, wrist OT, weekly BH',
      'Follow up in 4 weeks',
    ],
    [
      'Sudden severe headache (worst of life)',
      'Weakness or numbness lasting more than 1 hour',
      'Sudden vision loss',
      'Aura without headache lasting more than 60 minutes',
      'Fever with neck stiffness',
      'Chest pain or shortness of breath after triptan',
    ],
    [
      'Any red flag symptom — call 911 or come to ER',
      'Severe side effects of new medicine',
      'Headache pattern that changes character',
    ],
  ),
};

/** Priya — cervical PT evaluation. */
const PRIYA_CERVICAL_EVAL: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-pd-pt-cervical-0',
  orgId: ORG_ID,
  siteId: SITE_REHAB,
  patientId: PID,
  patientFirstName: 'Priya',
  clinicianEmail: 'pt.morales@cascadia.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 33,
  departmentKey: 'rehab',
  episodeId: EP_CERVICAL,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Initial PT eval — cervicogenic headache referral. Priya, 41F software engineer, reports 6 months gradual neck/upper trap tightness and headaches she now identifies as two distinct types: classic migraine with aura (treated with PCP) and a tension/cervicogenic pattern triggered by long screen days. Goal: reduce non-migraine headache contribution and tolerate full work day at desk without headache. Currently 12 headache days/month total; estimates ~40% of those are cervical-driven.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Posture: forward head 60° (CRA via photo), shoulders protracted, thoracic kyphosis mild.
ROM: cervical flexion 50°, extension 50°, R rotation 65°, L rotation 70°, R sidebend 35°.
Special: cervical flexion-rotation test positive R (limited to 35° vs 45° L) — suggests C1-C2 hypomobility. Suboccipital tenderness right > left. Spurling negative. Upper limb tension test negative.
DNF (deep neck flexor) endurance: 12 sec (target 30+).
HDI (Henry Ford Headache Disability Inventory): 48% (severe).
Trap palpation: tight bands bilaterally R > L.
Workstation: dual 27" monitors, laptop on couch evenings.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Manual: grade III upper cervical mobilization C0-C2, suboccipital release.
Soft tissue: upper trap and levator scapulae STM 5 min each.
Therapeutic exercise: chin tuck supine 3×10, scapular retraction 3×12, prone Y 2×8.
Patient education: ergonomic adjustments (monitor at eye level, frequent micro-breaks every 30 min), trigger awareness — distinguish migraine vs cervicogenic patterns, posture cuing.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated well. Trap tension subjectively reduced post-treatment. No headache provoked. HEP demonstrated and verbalized.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG (12 weeks): HDI <20%, full work day pain-free at desk — baseline 48%.
STG (4 weeks): DNF endurance ≥20 sec, headache days reduced by 30%.
STG (8 weeks): cervical flexion-rotation symmetric.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `PT 1×/week × 8 weeks then maintenance. HEP daily. Coordinate with PCP migraine plan and OT wrist treatment. Provided ergonomics handout and screen-break timer recommendation.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Tell me how the screen day goes for you, Priya.' },
    { speaker: 'PATIENT', text: 'Bad days I do not get up except for water. Neck is a brick by three PM.' },
    { speaker: 'CLINICIAN', text: 'Your flexion-rotation test on the right is limited — that is a hallmark for upper cervical contribution to headache.' },
    { speaker: 'PATIENT', text: 'I assumed all my headaches were the migraines.' },
    { speaker: 'CLINICIAN', text: 'Some are. Some are mechanical and we can change those. Hourly chin tucks, scapular retractions twice a day, monitor at eye level.' },
    { speaker: 'PATIENT', text: 'I work on the couch a lot.' },
    { speaker: 'CLINICIAN', text: 'Couch work has to stop on long days. Eight weeks of weekly PT and I expect a meaningful change.' },
  ],
  handout: handout(
    'Some of your headaches come from the neck. Posture and home exercises will reduce these.',
    ['Chin tuck supine 10 reps three times daily', 'Scapular retraction 12 reps twice daily', 'Monitor at eye level — no laptop on couch', 'Stand or stretch every 30 minutes', 'PT weekly for 8 weeks'],
    ['Headache pattern that changes', 'New arm numbness or weakness'],
    ['Numbness or weakness — call PT and PCP'],
  ),
};

/** Priya — cervical PT progress visit 5. */
const PRIYA_CERVICAL_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-pd-pt-cervical-1',
  orgId: ORG_ID,
  siteId: SITE_REHAB,
  patientId: PID,
  patientFirstName: 'Priya',
  clinicianEmail: 'pt.morales@cascadia.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 4,
  departmentKey: 'rehab',
  episodeId: EP_CERVICAL,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Visit 5/8. Reports estimated cervicogenic headache days down from 5/month to 2/month. Migraine days unchanged at this point — preventive medication just started 12 days ago. Desk tolerance now ~90 min before noticeable trap tension (was 30 min). HEP daily, hourly chin tuck reminder set on Slack.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `ROM: flexion 60°, R rotation 75° (was 65°). Flexion-rotation test less restricted (40° R vs 45° L).
DNF endurance: 24 sec (was 12).
Forward head 50° (improved from 60°).
HDI: 26% (was 48% — 22-point drop).
Suboccipital tenderness improved bilaterally.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Manual: continued upper cervical mobs.
Strengthening: prone press-up holds 3×30 sec, theraband rows 3×12, prone Y 3×10.
Functional simulation: 45-min seated task with posture checks q15 — no headache provoked.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Encouraged. Trap pressure-pain threshold improved. No headache during or after session.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `STG DNF ≥20 sec — MET.
STG 30% headache day reduction — partial (40% reduction in cervical-type headaches).
LTG HDI <20% — in progress (26%).`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue weekly × 3 then maintenance. Begin standing-desk intervals 10 min/hr. Stay coordinated with PCP migraine titration.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'HDI dropped twenty-two points — nice work.' },
    { speaker: 'PATIENT', text: 'The Slack reminder is a game changer. I do the chin tuck every hour.' },
    { speaker: 'CLINICIAN', text: 'Ten-minute standing intervals each hour starting this week. Three more visits then transition to maintenance HEP.' },
  ],
  handout: handout(
    'Neck program is working. Add standing desk intervals 10 minutes per hour.',
    ['Continue HEP daily', 'Standing 10 min each hour', 'Three more PT visits then maintenance'],
    ['Return of daily headaches', 'New arm symptoms'],
    ['Call if neurologic symptoms emerge'],
  ),
};

/** Priya — wrist OT eval. */
const PRIYA_WRIST_OT: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-pd-ot-wrist-0',
  orgId: ORG_ID,
  siteId: SITE_REHAB,
  patientId: PID,
  patientFirstName: 'Priya',
  clinicianEmail: 'ot.fischer@cascadia.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 22,
  departmentKey: 'rehab',
  episodeId: EP_WRIST,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `OT eval — right wrist extensor tendinopathy after a sprint cycle of unusually heavy typing/coding. Pain 6/10 with prolonged typing, 4/10 lifting coffee cup, 1/10 at rest. No numbness/tingling. Goal: pain-free typing 2+ hours and continued cooking/childcare without flares.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Palpation: tenderness 2nd dorsal compartment R wrist, mild swelling.
ROM: wrist extension 50° (vs 65° L), flexion 70° symmetric.
MMT: wrist extension 4-/5 R, 5/5 L.
Grip: R 22 kg, L 32 kg (R 69% of L — significant deficit).
Special: Finkelstein negative, resisted thumb extension reproduces pain (consistent with EPL component).
Workstation eval: regular keyboard, no wrist support, mouse on right requiring frequent reach.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Education: tendinopathy mechanism, load management. Splinting: cock-up wrist splint nights and during peak typing only.
Eccentric loading: wrist extension eccentrics 3×15 with 1 lb (introduced).
Workstation: ergonomic keyboard with negative tilt, vertical mouse trial, wrist neutral position cuing.
Activity modification: 20 min typing / 5 min stretch micro-breaks.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated session well. Pain 3/10 post. Verbalized understanding and committed to vertical mouse trial.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG (8 weeks): pain-free typing ≥2 hr, grip R ≥80% of L.
STG (3 weeks): pain ≤3/10 with typing, grip R ≥26 kg.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `OT 1×/week × 6 weeks. HEP: eccentrics, stretches, splint. Coordinate with PT cervical episode and PCP migraine plan.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Tell me when the wrist pain started.' },
    { speaker: 'PATIENT', text: 'A long sprint cycle two months ago — I typed twelve-hour days for two weeks.' },
    { speaker: 'CLINICIAN', text: 'Tendinopathy responds well to eccentric loading and ergonomic changes. Vertical mouse, wrist neutral, twenty-on five-off micro-break rule.' },
    { speaker: 'PATIENT', text: 'My job is mostly typing — I cannot stop.' },
    { speaker: 'CLINICIAN', text: 'You will not have to. Splint nights and peak typing only — no all-day splint. Eccentric exercise daily.' },
  ],
  handout: handout(
    'Wrist tendinopathy responds to ergonomic changes and a specific exercise. Wear the splint at night and during heavy typing days.',
    ['Cock-up wrist splint nights and peak typing days', 'Eccentric wrist extension 15 reps daily with 1 lb', '20 min typing / 5 min break rule', 'Try vertical mouse', 'OT weekly for 6 weeks'],
    ['Numbness or tingling in fingers', 'Pain that does not improve in 4 weeks'],
    ['New numbness — call OT and PCP'],
  ),
};

/** Priya — BH session 6 (GAD + insomnia / CBT-I). */
const PRIYA_BH_SESSION: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-pd-bh-0',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Priya',
  clinicianEmail: 'lcsw.bennett@cascadia.local',
  division: Division.BEHAVIORAL_HEALTH,
  templateId: 'seed-tmpl-bh-session',
  signedDaysAgo: 8,
  departmentKey: 'bh',
  episodeId: EP_BH,
  sections: [
    {
      id: 'presenting_concern',
      label: 'Presenting Concern',
      content: `Session 6 of 12. Chief focus: GAD with chronic insomnia. Priya reports sleep onset latency reduced from 75 min to ~40 min using CBT-I stimulus control. Continues to ruminate about deadlines and parenting. Migraine headache days remain elevated though preventive medicine just started. Reports interaction between anxiety, screens, and headache she now sees clearly. PHQ-9: 5. GAD-7: 9.`,
    },
    {
      id: 'mental_status',
      label: 'Mental Status Exam',
      content: `Appearance: groomed, professional dress. Behavior: cooperative, slightly anxious. Speech: normal rate. Mood: "Tired but functional." Affect: mildly anxious, congruent. Thought process: linear. Thought content: no SI/HI/AVH. Cognition: alert × 4. Insight/judgment: good.`,
    },
    {
      id: 'risk_assessment',
      label: 'Risk Assessment',
      content: `C-SSRS negative. GAD-7 9 (moderate, down from 14 intake). PHQ-9 5. No SI/HI. Crisis resources reviewed.`,
    },
    {
      id: 'interventions',
      label: 'Interventions',
      content: `CBT-I: continued stimulus control + sleep restriction (TIB 7.5 hr, current sleep efficiency 78% — target ≥85%). Cognitive restructuring around catastrophic deadline thoughts; thought record reviewed. Coordinated migraine-stress interaction discussion — patient identified screen rumination at night as both anxiety and migraine trigger. Introduced 30-min "worry window" before dinner.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Weekly CBT × 4 more, then biweekly. Homework: sleep diary, worry window practice 5/7 days, thought record on high-anxiety days. Re-assess GAD-7 at session 8. Coordination ROI to PCP and PT confirmed for headache plan.`,
    },
    {
      id: 'collateral',
      label: 'Collateral / Coordination',
      content: `Shared GAD-7 trend with Dr. Harper.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Sleep latency dropped to forty minutes — that is real movement.' },
    { speaker: 'PATIENT', text: 'I get out of bed when I cannot sleep, like you said. I read in the kitchen.' },
    { speaker: 'CLINICIAN', text: 'And the worry window?' },
    { speaker: 'PATIENT', text: 'Five out of seven days last week. Helps to write the worries down before dinner instead of at midnight.' },
    { speaker: 'CLINICIAN', text: 'Let us review the thought record from Tuesday — the deadline catastrophizing.' },
    { speaker: 'PATIENT', text: 'I wrote that the launch would fail and I would be fired. The reality is the launch was delayed by two days and nothing happened.' },
    { speaker: 'CLINICIAN', text: 'Excellent work. Continue weekly four more, then we go to every other week.' },
  ],
  handout: handout(
    'Sleep is improving with CBT-I. Keep the worry window before dinner — not at bedtime.',
    ['Sleep diary nightly', 'Worry window 30 min before dinner', 'Thought record on high anxiety days', 'Continue weekly therapy'],
    ['Sleep onset back over an hour for a week', 'Suicidal thoughts'],
    ['988 if crisis', 'Call this office for sustained worsening'],
  ),
};

export const PRIYA_DESAI_VISITS: SeedVisitCorpus[] = [
  PRIYA_HEADLINE,
  PRIYA_CERVICAL_EVAL,
  PRIYA_CERVICAL_PROGRESS,
  PRIYA_WRIST_OT,
  PRIYA_BH_SESSION,
];