import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from '../helpers';

const ORG_ID = 'seed-cascadia-clinic';
const SITE_MAIN = 'seed-cascadia-site-main';
const SITE_REHAB = 'seed-cascadia-site-rehab';

const PID = 'seed-cascadia-patient-marcus';
const EP_MED = 'seed-cascadia-episode-marcus-medical';
const EP_KNEE = 'seed-cascadia-episode-marcus-knee';
const EP_SHOULDER = 'seed-cascadia-episode-marcus-shoulder';
const EP_BH = 'seed-cascadia-episode-marcus-bh';

/** Marcus Thompson — headline 30-minute T2DM + CKD visit (deep sections + transcript). */
const MARCUS_HEADLINE: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-mt-md-headline',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Marcus',
  clinicianEmail: 'md.harper@cascadia.local',
  division: Division.MEDICAL,
  templateId: 'seed-tmpl-medical-soap',
  signedDaysAgo: 9,
  departmentKey: 'medical',
  episodeId: EP_MED,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Chief complaint: Comprehensive diabetes + CKD management visit, 8 weeks post right total knee arthroplasty.

HPI: Marcus Thompson is a 58-year-old male with longstanding T2DM (12 years) complicated by stage 3a CKD (most recent eGFR 51), presenting for an extended chronic-care review. Returns 8 weeks after right TKA — surgery uncomplicated; ortho cleared for full PT progression at week 6. Active in PT for both right knee and right shoulder.

Diabetes interval history: On metformin 1000 mg BID and empagliflozin 10 mg daily (started 4 months ago for renal protection + glycemic control). A1c trended 8.4 → 7.8 → 7.6 over the past 9 months. Home fasting glucose log (21 readings in past 3 weeks): range 96–142 mg/dL, average 118. Two episodes of mild hypoglycemia (high 60s) on PT exercise days — counseled on pre-exercise carb. No DKA symptoms. Tolerates empagliflozin well — denies UTI, perineal symptoms, volume depletion. Denies polyuria/polydipsia at current level.

CKD interval history: Last BMP eGFR 51 (was 48 prior to empagliflozin start — modest improvement consistent with hemodynamic effect). Urine albumin/creatinine ratio 110 mg/g (was 180 — improving). BP at home log avg 134/82 — slightly above renal goal of <130/80. On lisinopril 20 mg daily.

Surgical recovery / shoulder: Right knee per orthopedic and PT — flexion 108°, ambulating short distances without device, single-point cane outdoors. Pain 3/10 with stairs, 1/10 at rest. Right shoulder: subacromial impingement diagnosed 4 months ago; flexion 145°, mild end-range pain; PT progressing in parallel.

Mood / coping: Reports persistent low mood since TKA — feels "behind on life," misses gardening, frustrated with cane. Started BH sessions with Tasha Bennett 4 weeks ago. PHQ-9 today self-reported around 9.

PMH: T2DM (12y), CKD stage 3a, essential HTN, hyperlipidemia, R knee OA s/p TKA, R subacromial impingement, BMI 31.
PSH: R TKA (8 weeks ago), appendectomy 1995.
Medications: metformin 1000 mg BID, empagliflozin 10 mg daily, lisinopril 20 mg daily, atorvastatin 40 mg nightly, acetaminophen 1000 mg TID PRN, aspirin 81 mg daily.
Allergies: penicillin (rash, age 30).
Social: Married, two adult children, retired postal worker, active gardener pre-TKA, never smoker, EtOH 1–2 drinks/week.
Family hx: father T2DM with CKD progressing to dialysis at age 72, mother CAD.

Review of systems — comprehensive: Constitutional (−) fevers, (−) unintended weight changes (down 4 lb post-op consistent with reduced appetite). HEENT (−) vision changes; last dilated eye exam 6 months ago — mild nonproliferative retinopathy noted, ophthalmology following. CV (−) chest pain, (−) orthopnea, (−) PND, (−) palpitations. Resp (−) dyspnea on exertion at current activity. GI (−) N/V, (−) abdominal pain. GU (−) dysuria, (+) one episode mild dark urine after long PT day — resolved with hydration. MSK (+) right knee post-op recovery as above; (+) right shoulder pain at end-range. Neuro (−) focal weakness, (−) numbness/tingling in feet (notable given DM). Psych (+) low mood, (−) SI/HI. Endocrine (+) two mild hypoglycemic episodes as noted.`,
    },
    {
      id: 'objective',
      label: 'Objective',
      content: `Vitals: BP 134/82 (L arm seated, repeat 132/80 manual), HR 74, RR 16, Temp 97.9°F, SpO2 98% RA, Ht 5'11", Wt 218 lb (−4 from pre-op), BMI 30.4.

General: Pleasant, NAD, ambulates with single-point cane, slight antalgic gait favoring right.
HEENT: PERRLA, no scleral icterus, oropharynx moist, no thyromegaly.
Neck: Supple, no JVD, no carotid bruits.
CV: RRR, normal S1/S2, no murmurs, rubs, or gallops. No peripheral edema today (was trace edema 4 weeks ago).
Lungs: CTAB, no wheezes/rales/rhonchi.
Abd: Soft, non-tender, non-distended, no HSM, normoactive bowel sounds.
Right knee: Three portal sites and TKA incision well-healed, no erythema, no warmth, no effusion. Flexion 108° active, extension 0° (lag resolved per PT). Stable to varus/valgus stress. Distal NV intact, capillary refill <2 sec.
Right shoulder: Forward flexion 145° active (mild end-range pain), abduction 130°, ER at 90° abduction 55°. Hawkins-Kennedy mildly positive at end-range, drop-arm negative. No deltoid atrophy.
Feet: Skin intact bilaterally, no ulcers/calluses/fungal changes. Pulses DP/PT 2+ bilaterally. Monofilament 10g 10/10 sites bilaterally. Vibratory 128 Hz tuning fork — symmetric, slightly diminished bilaterally at great toes (chronic DM). Ankle reflexes 1+.
Neuro: CN II–XII intact, gait antalgic but symmetric arm swing, Romberg negative, finger-to-nose intact.
Psych: Mood mildly low, affect congruent, no SI/HI verbalized today (re-asked given PHQ-9 9).

Labs reviewed (today's draw):
- A1c 7.6% (was 7.8% 3 months ago)
- BMP: Na 138, K 4.4, Cl 102, CO2 24, BUN 26, Cr 1.4, eGFR 51 (stable from 50 last visit)
- Urine ACR 110 mg/g (was 180 — improving)
- Lipid panel: TC 168, LDL 84, HDL 42, TG 162 (LDL at goal on atorvastatin 40)
- LFTs wnl, vitamin D 28 (mildly low)
- PHQ-9 in office today: 9

In-office screens: PHQ-9 9 (mild), GAD-7 6 (mild). Foot exam as documented above. BP cuff-validated R/L within 4 mmHg.`,
    },
    {
      id: 'assessment',
      label: 'Assessment',
      content: `1. Type 2 diabetes mellitus, longstanding (12y), with established mild nonproliferative retinopathy and stage 3a CKD — A1c 7.6%, individualized goal <7.5% appropriate given hypoglycemia risk on PT days; trending in correct direction with metformin + empagliflozin. Two mild hypoglycemic events on exercise days require carb timing adjustment.

2. Chronic kidney disease, stage 3a (eGFR 51) — stable, with improving albuminuria on combination ACE-I + SGLT2 (ACR 180→110). BP slightly above renal goal — needs gentle additional control.

3. Essential hypertension — home avg 134/82, office 132/80; above renal goal of <130/80. Compliant on lisinopril 20 mg.

4. Hyperlipidemia — LDL 84 on atorvastatin 40 mg, at goal for very high CV risk (DM + CKD).

5. Status post right total knee arthroplasty, 8 weeks — uncomplicated; PT progressing well; on track.

6. Right subacromial impingement — improving with PT; conservative management indicated.

7. Adjustment disorder with depressed mood — PHQ-9 9, in active BH care; no SI/HI today; protective factors strong (family, engaged in care).

8. Vitamin D insufficiency (28) — mild; supplementation reasonable.

9. Mild nonproliferative diabetic retinopathy — followed by ophthalmology, due back at 6-month interval.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Diabetes / Glycemia:
- Continue metformin 1000 mg BID and empagliflozin 10 mg daily.
- Hypoglycemia mitigation: 15g carb 30 min before PT sessions on exercise days; 4 oz juice on hand. Recheck home glucose pre/post first 3 PT sessions; report any value <70.
- Repeat A1c in 3 months. Consider GLP-1 RA (semaglutide) at next visit if A1c remains ≥7.5% AND weight loss desired AND tolerating GI side effects acceptable.
- Continue daily foot self-inspection.

CKD / Renal protection:
- Continue lisinopril 20 mg daily, empagliflozin 10 mg daily.
- Add hydrochlorothiazide 12.5 mg daily for additional BP control toward <130/80 renal goal — patient counseled on volume status, dehydration risk on hot days, electrolyte monitoring.
- Repeat BMP + UACR in 6 weeks (after HCTZ start).
- Renal-protective diet education provided; sodium <2300 mg/day, moderate protein.

CV / Lipids:
- Continue atorvastatin 40 mg nightly. Lipid panel annually.
- Continue ASA 81 mg daily for primary prevention given DM + CKD risk profile.

MSK / Surgical recovery:
- Continue PT 2×/week for both right knee TKA and right shoulder. Coordinated with Dr. Morales (PT).
- Next ortho follow-up in 4 weeks (week 12 post-TKA).

Behavioral health:
- Continue weekly CBT with Tasha Bennett. PHQ-9 9 today consistent with adjustment disorder responding to therapy. Re-assess at 8-week BH visit; if PHQ-9 ≥10 or new anhedonia/SI, consider SSRI (sertraline) — patient open if needed.

Vitamin D:
- Start cholecalciferol 2000 IU daily. Recheck 25-OH vitamin D in 3 months.

Surveillance:
- Ophthalmology follow-up at next 6-month interval (already scheduled).
- Dental cleaning every 6 months (DM oral health).

Follow-up:
- 6 weeks for BMP + UACR + BP recheck.
- 3 months full diabetes review with A1c, lipids, weight.
- Sooner for hypoglycemia <60 mg/dL, BP >160/100, new dyspnea or edema, knee infection signs, suicidal ideation.

Patient education:
- Reviewed renal-protective diet, hypoglycemia recognition + treatment, sick-day rules (hold metformin + empagliflozin if dehydrated/ill), TKA infection red flags, shoulder PT precautions.`,
    },
  ],
  transcript: timedTranscript(
    [
      { speaker: 'CLINICIAN', text: 'Marcus, we blocked extra time today for a full diabetes and kidney review eight weeks after your knee replacement. Walk me through how everything has been since the surgery.' },
      { speaker: 'PATIENT', text: 'Recovery is steady. PT pushes me twice a week. I am tired by evening and a little down — my wife noticed it more than I did at first.' },
      { speaker: 'CLINICIAN', text: 'I am glad you started seeing Tasha for the mood piece. Before we get to that, your A1c today is seven point six — down from eight four nine months ago. Tell me about home glucose readings.' },
      { speaker: 'PATIENT', text: 'Mostly between one hundred and one forty in the morning. But two times after PT I dropped into the high sixties.' },
      { speaker: 'CLINICIAN', text: 'Those low readings are important. Empagliflozin and exercise can stack. We will start you on a fifteen-gram carb thirty minutes before each PT session. Bring juice in your bag.' },
      { speaker: 'PATIENT', text: 'I felt shaky and sweaty both times. My PT had me sit down and gave me crackers.' },
      { speaker: 'CLINICIAN', text: 'Smart of him. Anything below seventy I want you to call us, not just treat at home. Did you ever lose consciousness or feel confused?' },
      { speaker: 'PATIENT', text: 'No, just shaky.' },
      { speaker: 'CLINICIAN', text: 'Good. Your kidney function — eGFR fifty-one — is stable, and your urine protein is improving. The combination of lisinopril and empagliflozin is doing what it should.' },
      { speaker: 'PATIENT', text: 'My dad ended up on dialysis. That is what scares me most.' },
      { speaker: 'CLINICIAN', text: 'I hear that. Your numbers are not on that path, and we are aggressive about keeping them that way. That is also why your home blood pressure of one thirty-four over eighty-two needs to come down a little — renal goal is under one thirty over eighty.' },
      { speaker: 'PATIENT', text: 'I take the lisinopril every morning.' },
      { speaker: 'CLINICIAN', text: 'I know. We are going to add a low-dose water pill — hydrochlorothiazide twelve and a half milligrams — to bring it the rest of the way. With empagliflozin and a thiazide together you have to watch hydration on hot days. Do not skip water with PT sessions.' },
      { speaker: 'PATIENT', text: 'How will I know if I am too dry?' },
      { speaker: 'CLINICIAN', text: 'Lightheadedness when standing, dark urine, cramping, very low urine output. If you are sick with vomiting or diarrhea, hold the metformin, the empagliflozin, the lisinopril, and the new water pill until you are eating and drinking again. We call those sick-day rules.' },
      { speaker: 'PATIENT', text: 'OK — write that down for me.' },
      { speaker: 'CLINICIAN', text: 'I will print the handout. Now feet — let me check sensation. Take your shoes off please.' },
      { speaker: 'CLINICIAN', text: 'All ten spots on the monofilament are intact bilaterally. Vibration is symmetric but slightly reduced at the big toes — chronic, not new. Pulses are good.' },
      { speaker: 'PATIENT', text: 'I check my feet every night since the diabetes class.' },
      { speaker: 'CLINICIAN', text: 'Keep that habit. You had retinopathy noted six months ago — when is your next eye appointment?' },
      { speaker: 'PATIENT', text: 'Next month. Same eye doctor.' },
      { speaker: 'CLINICIAN', text: 'Send me the report. Now your knee — eight weeks out, flexion one-oh-eight per PT. How is it feeling on stairs?' },
      { speaker: 'PATIENT', text: 'Stairs are about a three out of ten. Garden bench at home is harder.' },
      { speaker: 'CLINICIAN', text: 'You will get there. Shoulder?' },
      { speaker: 'PATIENT', text: 'Better. Reaching the top shelf still pinches but I can dress without pain now.' },
      { speaker: 'CLINICIAN', text: 'Good progress on both. Coordinated visits with Dr. Morales make a difference. Now — PHQ-nine today is nine. Tell me about the low mood.' },
      { speaker: 'PATIENT', text: 'I feel behind on life. I look at my garden and cannot kneel yet. My wife has been picking up the slack.' },
      { speaker: 'CLINICIAN', text: 'That is a meaningful loss while you recover. The fact that you are in therapy, taking your meds, doing PT — that is exactly the work. We hold off on adding an antidepressant for now and reassess at your next BH visit. Any thoughts of harming yourself?' },
      { speaker: 'PATIENT', text: 'No, never.' },
      { speaker: 'CLINICIAN', text: 'Thank you for being clear. Vitamin D is twenty-eight — mildly low. Start two thousand units daily. Recheck in three months.' },
      { speaker: 'PATIENT', text: 'OK. Anything else?' },
      { speaker: 'CLINICIAN', text: 'Continue metformin, empagliflozin, lisinopril, atorvastatin, aspirin. Add hydrochlorothiazide and vitamin D. Repeat labs in six weeks for kidney function, then full review in three months. Call sooner for sugar below sixty, blood pressure over one-sixty, new shortness of breath or swelling, knee redness or fever, or any thoughts of self-harm.' },
      { speaker: 'PATIENT', text: 'I appreciate the longer visit today. Lot to track.' },
      { speaker: 'CLINICIAN', text: 'You are doing the work. Same time in six weeks.' },
    ],
    32,
  ),
  handout: handout(
    'Diabetes and kidney function are improving. We are adding a low-dose water pill for blood pressure and vitamin D for low levels. Pre-treat low blood sugar before physical therapy.',
    [
      'Metformin 1000 mg twice daily — continue',
      'Empagliflozin 10 mg every morning — continue',
      'Lisinopril 20 mg every morning — continue',
      'Atorvastatin 40 mg nightly — continue',
      'Aspirin 81 mg daily — continue',
      'Add hydrochlorothiazide 12.5 mg every morning — new',
      'Add vitamin D 2000 IU daily — new',
      '15 g carbohydrate snack 30 minutes before each PT session',
      'Daily foot inspection — mirror on the floor',
      'Hold all blood pressure / diabetes / water pill if vomiting or diarrhea (sick-day rules)',
      'Lab recheck in 6 weeks; full follow-up in 3 months',
    ],
    [
      'Blood sugar under 60',
      'Blood pressure consistently over 160/100',
      'New chest pain or shortness of breath',
      'New swelling in legs',
      'Redness, fever, or drainage at knee incision',
      'Lightheadedness, dark urine, or cramps (dehydration)',
      'Any thoughts of self-harm — call 988 immediately',
    ],
    [
      'Any blood sugar reading under 60',
      'Severe dizziness when standing',
      'Sick day with vomiting or diarrhea more than 12 hours',
      'New depression or suicidal thoughts',
    ],
  ),
};

/** Marcus — initial PT evaluation, right knee TKA. */
const MARCUS_KNEE_EVAL: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-mt-pt-knee-0',
  orgId: ORG_ID,
  siteId: SITE_REHAB,
  patientId: PID,
  patientFirstName: 'Marcus',
  clinicianEmail: 'pt.morales@cascadia.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 48,
  departmentKey: 'rehab',
  episodeId: EP_KNEE,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Initial PT evaluation — 2 weeks post right total knee arthroplasty (cemented, posterior-stabilized). Referred by orthopedics. Marcus reports pain 5/10 at rest, 7/10 with weight-bearing transfers. Sleeps with leg elevated; ice packs every 2–3 hours. Walks with rolling walker indoors, requires SBA on stairs (one step at a time, leading with left). Goal: return to gardening (kneeling and prolonged standing) and walking the dog 30 minutes within 12 weeks.

Comorbidities relevant to rehab: T2DM (well controlled, monitors home glucose), stage 3a CKD, right shoulder impingement (separate concurrent rehab episode). Lives with wife in single-story home — no stairs to entry but bathroom on opposite side of bedroom.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Incision: TKA midline incision well-approximated, sutures removed, no erythema, no drainage. Three small portal sites all healed.
Effusion: moderate suprapatellar fullness, palpable warmth (expected at week 2).
ROM: right knee flexion 78° active / 84° passive (limited by pain + effusion), extension lag 8° (active), 0° (passive).
MMT: quad 3-/5 (poor activation), hamstrings 3+/5, hip abductors 4-/5.
Special: medial/lateral stability stable, no warmth concerning for infection.
Functional measures: TUG 18.4 seconds (high fall risk — threshold <13.5), 30-sec sit-to-stand: 4 reps with arm push-off, single-leg stance R 4 sec / L 22 sec.
KOOS-PS: 32/100 (severe dysfunction).
Gait observation: walker-dependent, decreased stance time on R, antalgic limp, no Trendelenburg.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Edema management: ankle pumps (3×20), elevation + compression demo with TED hose review.
Quad activation: NMES 10 min at quad with patient performing isometric quad sets (15 sec hold ×10).
ROM: assisted heel slides 3×10, prone hangs 2 min for extension, gentle terminal knee extension over rolled towel 3×10.
Gait training: bilateral support, parallel bars ×40 ft with focus on heel strike and weight shift onto R, two-point pattern with walker.
Patient education: weight-bearing precautions per ortho (full weight-bearing with assistive device as tolerated), pain timing pre-PT, when to ice (post-exercise + every 2 hr first 48 hr), DVT/PE warning signs, infection red flags (fever, warmth spreading proximally, drainage, increased redness), DM-specific exercise notes (15 g carb pre-session, hydration).`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated initial session well. Required 2 rest breaks. Pain 5/10 post-treatment (up from 4/10 starting — expected with first session). No adverse cardiopulmonary signs. Demonstrated NMES tolerance and verbalized understanding of HEP. Confirmed pre-session 15 g carb plan and brought juice in his bag. No hypoglycemia symptoms during or after session.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG (12 weeks): Right knee flexion ≥120°, full extension, return to gardening + 30-min walks without device — baseline today flexion 78°, ext lag 8°.
STG (4 weeks): Flexion ≥105°, extension lag <2°, TUG <14 sec.
STG (8 weeks): KOOS-PS ≥55, ambulation with single-point cane outdoors, stair climbing reciprocal pattern with rail.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `PT 2×/week × 12 weeks at Cascadia Riverside Therapy. HEP: ankle pumps hourly while awake, quad sets ×4/day, heel slides ×3/day, prone hangs 2× daily for 2 minutes. Progress to band TKE and mini-squats at week 4 if appropriate. Coordinate with concurrent shoulder PT (separate episode, same therapist). Ortho follow-up at week 6 for ROM check; communicate any flexion <90° at that time. NSAID precaution noted — use acetaminophen, no NSAIDs given CKD stage 3a.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Marcus, two weeks out from the knee replacement — walk me through how things are going at home.' },
    { speaker: 'PATIENT', text: 'Slow. The walker is fine but I am ready to be done with it.' },
    { speaker: 'CLINICIAN', text: 'Flexion today is seventy-eight degrees and you have an eight-degree extension lag. Both are normal week two but we have work to do. Have you been doing the ankle pumps and quad sets?' },
    { speaker: 'PATIENT', text: 'I do them when I think of it. The quad does not feel like it is firing.' },
    { speaker: 'CLINICIAN', text: 'That is what we will work on first — getting that quad to wake up. We will use electrical stim today and pair it with you contracting the muscle.' },
    { speaker: 'PATIENT', text: 'My doctor reminded me about the carb before exercise.' },
    { speaker: 'CLINICIAN', text: 'Good — and let me know any time you feel shaky or sweaty. I want a glucose check before and after our first three sessions to be safe.' },
    { speaker: 'PATIENT', text: 'I have my meter in my bag.' },
    { speaker: 'CLINICIAN', text: 'Twice a week for twelve weeks total. Home program four times a day. The HEP is what makes the difference between this knee and a stiff knee a year from now.' },
  ],
  handout: handout(
    'Two weeks after your knee replacement. Pain and stiffness are normal. Home exercises four times a day are the most important part of recovery.',
    [
      'Ankle pumps every hour while awake',
      'Quad sets — 4 sets of 15-second holds, four times a day',
      'Heel slides — 3 sets of 10, three times a day',
      'Prone hangs for extension — 2 minutes, twice daily',
      'Ice 20 minutes after exercises and every 2 hours first 48 hours',
      'PT twice weekly for 12 weeks',
    ],
    [
      'Calf swelling, redness, or pain (DVT)',
      'Sudden chest pain or shortness of breath (PE)',
      'Fever above 101 or chills',
      'Spreading redness, warmth, or drainage at incision',
      'Sudden inability to bear weight',
    ],
    [
      'Any DVT or PE warning signs — call ortho immediately',
      'Signs of infection — call within 24 hours',
      'Falls or sudden new pain',
    ],
  ),
};

/** Marcus — knee PT progress visit week 7. */
const MARCUS_KNEE_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-mt-pt-knee-1',
  orgId: ORG_ID,
  siteId: SITE_REHAB,
  patientId: PID,
  patientFirstName: 'Marcus',
  clinicianEmail: 'pt.morales@cascadia.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 14,
  departmentKey: 'rehab',
  episodeId: EP_KNEE,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Visit 12/24 (week 7 post-TKA). Pain 3/10 stairs, 1/10 level. Single-point cane outdoors only. Walked dog 15 minutes around the block — manageable. HEP compliance ~6/7 days. Two PT sessions ago experienced shaky feeling at minute 25 — glucose 64 mg/dL — treated with juice and resolved within 10 minutes. Adjusted pre-session carb to 20 g since.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Effusion mild (improved). Incision well-healed.
ROM: right knee flexion 108° active (was 78° eval), extension 0° (lag resolved).
MMT: quad 4/5 (was 3-/5), hamstrings 4+/5, hip abductors 4/5.
TUG: 13.6 sec (was 18.4 sec at eval).
30-sec sit-to-stand: 9 reps without arm push-off.
KOOS-PS: 56/100 (was 32 at eval — 24-point improvement).
Gait: reciprocal stairs with rail, mild antalgic limp without device on level.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Manual: grade III TF joint AP mobs, patellar superior glide.
Strengthening: TKE with green band 3×15, mini-squats to chair 3×12, lateral step-ups 4" 3×10, leg press light 2×12.
Gait/functional: cane-free indoor ambulation 100 ft × 3, simulated curb step practice.
Pre-session glucose 124 mg/dL after 20 g carb. Post-session 102 mg/dL — within target.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Excellent tolerance. Pain 2/10 post-treatment. No hypoglycemia symptoms. Patient reports first time since surgery he forgot the cane was in the corner of the room.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `STG flexion ≥105° — MET (108°).
STG extension lag <2° — MET (0°).
STG TUG <14 sec — MET (13.6).
STG KOOS-PS ≥55 — MET (56).
LTG flexion ≥120° — in progress (108°).`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue 2×/week × 5 more weeks then taper. Progress to closed-chain step-downs from 6" step next visit. Begin gardening kneel simulation with gel pad week 9 if pain stable. Maintain 20 g carb pre-session. Update PCP at next medical visit (planned week 8).`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Marcus, your KOOS score went from thirty-two to fifty-six — twenty-four points up. That is well past the meaningful change threshold.' },
    { speaker: 'PATIENT', text: 'I can tell. Walked the dog around the block this morning without the cane.' },
    { speaker: 'CLINICIAN', text: 'Flexion is one-oh-eight. We need one-twenty for full function. Are you doing the prone hangs?' },
    { speaker: 'PATIENT', text: 'Twice a day, ten minutes total.' },
    { speaker: 'CLINICIAN', text: 'Keep that. Today we add lateral step-ups and lighter leg press. By week ten I want you on a six-inch step-down.' },
    { speaker: 'PATIENT', text: 'And the gardening?' },
    { speaker: 'CLINICIAN', text: 'Week nine we start kneel simulation with a thick gel pad. By week twelve I expect you in the actual garden — short bouts, then longer.' },
  ],
  handout: handout(
    'Knee is well ahead of schedule. Keep prone hangs and home exercises. We are adding step-ups today.',
    [
      'Continue HEP — TKE, mini-squats, prone hangs',
      'Add lateral step-ups 4 inch, 10 reps each side',
      'Walk dog 15–20 minutes, slowly increase',
      '20 g carb 30 minutes before each PT session',
      '5 more weeks of PT then taper',
    ],
    ['New knee swelling that does not settle overnight', 'Locking or giving way', 'Redness or warmth around incision'],
    ['Sudden inability to bear weight', 'Fever or signs of joint infection'],
  ),
};

/** Marcus — shoulder PT progress visit. */
const MARCUS_SHOULDER_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-mt-pt-shoulder-0',
  orgId: ORG_ID,
  siteId: SITE_REHAB,
  patientId: PID,
  patientFirstName: 'Marcus',
  clinicianEmail: 'pt.morales@cascadia.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 11,
  departmentKey: 'rehab',
  episodeId: EP_SHOULDER,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Visit 8/12 — right subacromial impingement. Pain 2/10 at rest, 4/10 with overhead reach (was 6/10 eval). Sleeping on right side 4 nights/week (was zero at intake). Reaches top kitchen shelf without significant pain. Painting trim at home for short bouts pain-free. Concurrent knee TKA progressing on parallel track — Marcus reports timing his sessions back-to-back twice weekly.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `ROM: shoulder flexion 145° (eval 110°), abduction 130° (eval 100°), external rotation at 90° abduction 55° (eval 35°), IR thumb to T8 (eval T12).
MMT: supraspinatus 4/5 (eval 3+/5), infraspinatus 4+/5, middle trap 4+/5.
Special: Hawkins-Kennedy minimally positive at end-range only (eval clearly positive). Drop-arm negative. Empty-can mildly positive.
Painful arc: 130–145° only (eval 80–120°).
Strength deficit R/L: ER 88% (eval 60%), forward flexion endurance approaching symmetric.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Manual: grade II–III GH posterior glide, soft tissue to upper trap and pec minor.
Strengthening: ER band 3×12 green band, prone Y/T/W 2×10, scaption with 3# weight 3×10, sleeper stretch 3×30 sec.
Functional: simulated overhead reach with 5# load progressing to 8#.
Patient education: progress home exercise band to green this week.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated well. Pain 1/10 post. No symptom flare overnight per patient.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG flexion ≥160° — in progress (145°).
LTG no painful arc — partial (only end-range now).
ER strength 4+/5 — partial (4/5 today).`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue 1–2×/week × 4 more weeks then transition to maintenance. Progress to overhead lifts 8# next visit. Coordinate with knee episode — Marcus tolerating both well.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Sleeping on the right side four nights — that is the biggest practical milestone for shoulder impingement.' },
    { speaker: 'PATIENT', text: 'Used to wake up at three AM. Now mostly sleep through.' },
    { speaker: 'CLINICIAN', text: 'Flexion is one forty-five — twenty more degrees and you are at goal. Switch to the green band today.' },
    { speaker: 'PATIENT', text: 'And the knee is doing well too. Thank you for stacking sessions.' },
    { speaker: 'CLINICIAN', text: 'Easier on you than two trips per week. Four more weeks then we taper.' },
  ],
  handout: handout(
    'Shoulder is responding well. Move up to the green resistance band for home exercises.',
    [
      'External rotation band 12 reps green band',
      'Prone Y/T/W 10 reps daily',
      'Scaption with 3 lb weight 10 reps',
      'Sleeper stretch 30 seconds × 3',
      'Avoid heavy overhead lifting more than 8 lb until cleared',
    ],
    ['Sharp pain with new weakness', 'Numbness in arm or hand', 'Pain that wakes you up at night again'],
    ['Sudden inability to lift the arm'],
  ),
};

/** Marcus — BH intake (adjustment disorder). */
const MARCUS_BH_INTAKE: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-mt-bh-0',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Marcus',
  clinicianEmail: 'lcsw.bennett@cascadia.local',
  division: Division.BEHAVIORAL_HEALTH,
  templateId: 'seed-tmpl-bh-session',
  signedDaysAgo: 28,
  departmentKey: 'bh',
  episodeId: EP_BH,
  sections: [
    {
      id: 'presenting_concern',
      label: 'Presenting Concern',
      content: `BH intake — referred by PCP after PHQ-9 13 noted at 4-week post-op visit. Marcus reports persistent low mood since right TKA, primarily framed as grief over functional loss — "I cannot kneel in my garden, my wife waters the tomatoes." Reports decreased pleasure in usual hobbies, mid-day fatigue beyond expected post-op recovery, mild irritability, sleep onset preserved but middle-of-night waking 2–3×. Denies anhedonia globally — still enjoys grandchildren visits. Denies SI/HI. No prior psychiatric history.`,
    },
    {
      id: 'mental_status',
      label: 'Mental Status Exam',
      content: `Appearance: well-groomed, casual, ambulates with single-point cane. Behavior: cooperative, slowed pace. Speech: normal volume, slightly slower than expected rate. Mood: "Frustrated, kind of flat." Affect: constricted, congruent, occasional reactive smile when discussing grandchildren. Thought process: linear, goal-directed. Thought content: no SI/HI/AVH. Cognition: alert and oriented ×4. Insight: good. Judgment: good.`,
    },
    {
      id: 'risk_assessment',
      label: 'Risk Assessment',
      content: `C-SSRS negative across all domains. PHQ-9 today: 13 (moderate). GAD-7: 6 (mild). Denies SI, plan, intent, means. Protective factors: married 32 years, two adult children supportive, engaged in PCP and rehab care, no firearms in home (sold during recent move). Crisis resources reviewed; agreed to call 988 or this office before acting on any harmful thought.`,
    },
    {
      id: 'interventions',
      label: 'Interventions',
      content: `Psychoeducation: adjustment disorder framework — distinguishing grief over functional loss vs. major depression. Validated meaningful identity loss tied to gardening. Behavioral activation introduced — three pleasure-mastery activities per week, scaled to current physical capacity (e.g., seated trim watering, reading, pickleball spectator with friend). Sleep hygiene: stimulus control for middle-of-night waking. Grief-and-rehab framing — recovery as identity rebuild rather than return.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Weekly CBT × 8 weeks, then reassess. Homework: behavioral activation log, sleep diary. Coordinate with PCP — agreed to share PHQ-9 trend (signed ROI). Re-screen at session 4. If PHQ-9 ≥15 OR new SI, escalate to PCP for SSRI evaluation. Re-evaluate adjustment vs. MDD diagnosis at session 6.`,
    },
    {
      id: 'collateral',
      label: 'Collateral / Coordination',
      content: `ROI signed for PCP coordination. No spouse session today; open to joint session in 4 weeks if patient interested. Aware of Cascadia portal messaging if distress escalates between sessions.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Marcus, what made you decide to follow up on the referral?' },
    { speaker: 'PATIENT', text: 'My wife noticed first. I was not enjoying the things I usually do. The garden mostly.' },
    { speaker: 'CLINICIAN', text: 'When you stand on the deck and look at it, what comes up?' },
    { speaker: 'PATIENT', text: 'Frustration. And a little shame that I cannot kneel yet.' },
    { speaker: 'CLINICIAN', text: 'That feeling has a name — adjustment with loss. PT says you will be back kneeling in a few weeks. We will work on the part that does not just resolve when the knee does.' },
    { speaker: 'PATIENT', text: 'I am not sure therapy is for me but my wife wanted me to try.' },
    { speaker: 'CLINICIAN', text: 'You showed up. That counts. Would you be willing to schedule three small things this week — one with hands, one with people, one outdoors?' },
    { speaker: 'PATIENT', text: 'Yes — that I can do.' },
  ],
  handout: handout(
    'Mood changes after a major surgery are common and treatable. Schedule three small activities this week — one with hands, one with people, one outdoors.',
    ['Activity log this week — three pleasure or mastery activities', 'Sleep diary nightly', 'Weekly therapy', 'Crisis resources: 988'],
    ['Thoughts of harming yourself', 'Withdrawal from family for more than a week'],
    ['988 if any suicidal thoughts', 'Call this office between sessions if symptoms worsen'],
  ),
};

/** Marcus — BH session 4 progress. */
const MARCUS_BH_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-cascadia-visit-mt-bh-1',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Marcus',
  clinicianEmail: 'lcsw.bennett@cascadia.local',
  division: Division.BEHAVIORAL_HEALTH,
  templateId: 'seed-tmpl-bh-session',
  signedDaysAgo: 6,
  departmentKey: 'bh',
  episodeId: EP_BH,
  sections: [
    {
      id: 'presenting_concern',
      label: 'Presenting Concern',
      content: `Session 4. Marcus reports improved mood and energy. Used a stadium seat to sit on the lawn and pull weeds for 30 minutes — first gardening since surgery. Wife joined him. Sleep middle-of-night waking reduced to once nightly most nights. Continues PT 2×/week with pre-session glucose plan. PHQ-9 today 9 (down from 13).`,
    },
    {
      id: 'mental_status',
      label: 'Mental Status Exam',
      content: `Appearance: well-groomed, casual. Behavior: cooperative, brighter than intake. Speech: normal rate. Mood: "Better — more like me." Affect: full range, congruent. Thought process: linear. No SI/HI. Cognition: alert × 4. Insight/judgment: good.`,
    },
    {
      id: 'risk_assessment',
      label: 'Risk Assessment',
      content: `Denies SI/HI. PHQ-9: 9. GAD-7: 5. Crisis plan reviewed and unchanged.`,
    },
    {
      id: 'interventions',
      label: 'Interventions',
      content: `CBT: cognitive restructuring around "behind on life" thought — patient generated counter-evidence (TKA recovery is on schedule, gardening already restarted). Behavioral activation review — 3/3 activities completed last week. Introduced graded exposure to longer gardening intervals using activity pacing rules. Reinforced sleep hygiene and middle-of-night CBT-I (no clock checking).`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue weekly CBT ×4 more, then biweekly. Homework: increase gardening to 2×30 min next week with breaks; activity log. PHQ-9 at session 6. Reaffirmed PCP shared trend at last medical visit.`,
    },
    {
      id: 'collateral',
      label: 'Collateral / Coordination',
      content: `Sent PHQ-9 trend update to Dr. Harper per ROI.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'You went out and pulled weeds. Tell me what that was like.' },
    { speaker: 'PATIENT', text: 'My wife brought the stadium seat. I lasted half an hour.' },
    { speaker: 'CLINICIAN', text: 'And the thought "I am behind on life"? Where is that today?' },
    { speaker: 'PATIENT', text: 'Quieter. The garden is not perfect but it is alive.' },
    { speaker: 'CLINICIAN', text: 'That is the work. PHQ went from thirteen to nine. Stay on the activity log and we move to every other week soon.' },
  ],
  handout: handout(
    'You are responding well to therapy. Keep the activity log going and increase gardening time gradually.',
    ['Activity log daily', 'Gardening 2 x 30 min next week with breaks', 'Weekly therapy then biweekly when stable'],
    ['Return of low mood lasting more than a week', 'Sleep getting worse again', 'Suicidal thoughts'],
    ['988 if crisis', 'Call this office if symptoms regress'],
  ),
};

export const MARCUS_THOMPSON_VISITS: SeedVisitCorpus[] = [
  MARCUS_HEADLINE,
  MARCUS_KNEE_EVAL,
  MARCUS_KNEE_PROGRESS,
  MARCUS_SHOULDER_PROGRESS,
  MARCUS_BH_INTAKE,
  MARCUS_BH_PROGRESS,
];
