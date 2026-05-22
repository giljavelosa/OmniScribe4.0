import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from '../helpers';

const ORG_ID = 'seed-riverbend-clinic';
const SITE_MAIN = 'seed-riverbend-site-main';
const SITE_WELLNESS = 'seed-riverbend-site-wellness';

const PID = 'seed-riverbend-patient-linda';
const EP_MED = 'seed-riverbend-episode-linda-medical';
const EP_HIP = 'seed-riverbend-episode-linda-hip';
const EP_BALANCE = 'seed-riverbend-episode-linda-balance';
const EP_BH = 'seed-riverbend-episode-linda-bh';

/** Linda — headline 30-minute HFrEF + post-hip review. */
const LINDA_HEADLINE: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-lf-md-headline',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Linda',
  clinicianEmail: 'do.boucher@riverbend.local',
  division: Division.MEDICAL,
  templateId: 'seed-tmpl-medical-soap',
  signedDaysAgo: 5,
  departmentKey: 'medical',
  episodeId: EP_MED,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Chief complaint: Comprehensive HFrEF visit, 10 weeks post right hip ORIF — quadruple-therapy review and rehab/cognition coordination.

HPI: Linda Foster is a 70-year-old female with HFrEF (LVEF 35% — improved from 30% on quadruple therapy initiated 6 months ago), 10 weeks post-ORIF for right femoral neck fracture (mechanical fall at home, no syncope, no head injury, no LOC), with mild cognitive impairment under supportive care with Dr. Donovan.

HFrEF interval: On guideline-directed medical therapy — sacubitril/valsartan 49/51 BID (was 24/26), metoprolol succinate 50 mg daily (was 25), spironolactone 25 mg daily, dapagliflozin 10 mg daily. Furosemide 40 mg PRN — used 2× in past month for mild dyspnea/foot swelling. Reports baseline NYHA II — can walk 100 ft on level before mild dyspnea. No orthopnea, paroxysmal nocturnal dyspnea, or syncope. Daily weights at home — stable within 2 lb of dry weight (148 lb). Sodium intake estimated 1500–2000 mg/day per dietitian visit last month.

Hip recovery: 10 weeks post-ORIF; PT with Dr. Okonkwo at Wellness Center. Walks with rolling walker indoors, transitioning to single-point cane for short outdoor distances; daughter accompanies. Hip surgical scar healed.

Cognition / BH: Daughter Robert Foster (son) accompanies today; reports mother more forgetful with names but managing meds with weekly pill organizer + daughter check-ins. MoCA improved from 24 to 25 over 3 months with Dr. Donovan. No new wandering, no agitation, no nighttime confusion. Sleep 7 hrs, mood good — proud of recovery progress.

Falls / safety: Home-safety eval completed — grab bars installed, area rugs removed, raised toilet seat, motion-sensor nightlights. Vision corrected; last eye exam 8 months ago.

PMH: HFrEF (LVEF 35%, ischemic etiology — prior NSTEMI 2022 with PCI to LAD), atrial fibrillation rate-controlled, mild cognitive impairment, R femoral neck fracture s/p ORIF, hyperlipidemia, hx CAD with PCI 2022.
PSH: R hip ORIF (10 weeks ago), PCI 2022, cholecystectomy 1995.
Medications: sacubitril/valsartan 49/51 mg BID, metoprolol succinate 50 mg daily, spironolactone 25 mg daily, dapagliflozin 10 mg daily, atorvastatin 80 mg nightly, ASA 81 mg daily, apixaban 5 mg BID (AFib), furosemide 40 mg PRN, donepezil 5 mg nightly (started 6 weeks ago by Dr. Donovan with PCP coordination), calcium + vitamin D, multivitamin.
Allergies: ACE-I (cough — historical, transitioned to ARNI which she tolerates).
Social: Widowed 8 years, lives alone in single-story home, son 10 min away (visits 2×/week), daughter (out-of-state — calls daily), retired schoolteacher. Never smoker. EtOH none.
Family hx: father MI age 65, mother dementia age 78.

ROS — comprehensive: Constitutional (−) fevers, +1 lb weight gain stable. HEENT (−) vision changes from baseline. CV (+) intermittent palpitations as expected with AFib, (−) chest pain, (−) syncope. Resp (+) mild dyspnea after 100 ft walking — baseline NYHA II; (−) orthopnea, (−) PND. GI (−) N/V, (−) constipation. GU (−) incontinence (improved with PT). MSK (+) hip stiffness AM ×30 min; (+) general deconditioning. Neuro (+) mild forgetfulness as known; (−) new focal symptoms. Psych (+) mood good, (−) SI/HI. Endo wnl.`,
    },
    {
      id: 'objective',
      label: 'Objective',
      content: `Vitals: BP 116/68 (L arm seated, repeat 118/70), HR 72 irregularly irregular (AFib known), RR 16, Temp 97.8°F, SpO2 96% RA, Wt 149 lb (+1 from last visit), BMI 25.8.

General: Pleasant, well-groomed, alert, accompanied by son. Ambulates with rolling walker.
HEENT: PERRLA, EOMI, oropharynx moist.
Neck: Supple, no JVD at 30°, no carotid bruits.
CV: Irregularly irregular rhythm consistent with AFib, normal S1, slightly soft S2, no S3, no audible murmur today. PMI not displaced. No peripheral edema today (was trace 4 weeks ago).
Lungs: CTAB, no rales/rhonchi/wheezes.
Abd: Soft, NT, ND, no HSM, no abdominojugular reflux.
Right hip: surgical scar well-healed, no erythema. Hip flexion 95° active (limited by post-op stiffness), abduction 25°, IR/ER limited but symptom-free at end-range.
Ext: 1+ DP/PT pulses bilateral (chronic), no edema today, capillary refill <2 sec, no calf tenderness.
Neuro: Alert and oriented ×3 (slow on date), CN II–XII intact, motor 4+/5 lower extremities (deconditioning), reflexes 1+ symmetric, gait with rolling walker.
Cognition: Mini-Cog: 3-item recall 2/3, clock draw normal — passes. MoCA in office today by SLP last week — 25/30 (gain of 1 from baseline).
Psych: Euthymic, congruent.

In-office screens: PHQ-9 3, GAD-7 2, Mini-Cog as above. PHQ-2 negative.

Labs (drawn today): NT-proBNP 720 (was 1840 6 mo ago), BMP — Na 138, K 4.6, Cl 102, CO2 26, BUN 22, Cr 1.0, eGFR 58 (mild CKD — chronic). Lipids — TC 142, LDL 60, HDL 48, TG 130. CBC wnl. INR not applicable (on apixaban). HbA1c 5.6 (no DM).

Recent imaging: TTE 2 months ago — LVEF 35% (improved from 30%), no significant valvular disease, normal RV function, no pericardial effusion.`,
    },
    {
      id: 'assessment',
      label: 'Assessment',
      content: `1. HFrEF, ischemic — LVEF 35% (improved from 30%), NYHA II, on optimized GDMT (ARNI + BB + MRA + SGLT2i). NT-proBNP 720 (down from 1840). Stable at maintenance.

2. AFib — rate controlled on metoprolol (HR 72), anticoagulated with apixaban 5 mg BID (CHA2DS2-VASc 5 = age 70 + female + HTN historic + CHF + prior PCI/CAD). No bleeding events on apixaban + ASA combination — periodically reconsider duality.

3. Status post right femoral neck fracture s/p ORIF, 10 weeks — uncomplicated; rehab progressing.

4. Mild cognitive impairment — managed with donepezil 5 mg + cognitive training with SLP/psych. MoCA 25 (improved from 24). Family support robust.

5. Hyperlipidemia — LDL 60 on atorvastatin 80 mg, well within secondary prevention goal post-PCI.

6. Mild stable CKD (eGFR 58) — chronic, no acute change despite SGLT2i + spironolactone + ARNI. K 4.6 acceptable.

7. Falls / deconditioning — being addressed via concurrent PT episode focused on gait/balance (separate episode).

8. Widow with mild MCI — assess decision-making capacity for ongoing meds: today preserved per clinical exam and son confirmation.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `HFrEF (continue quadruple therapy):
- Continue sacubitril/valsartan 49/51 BID, metoprolol succinate 50 mg daily, spironolactone 25 mg daily, dapagliflozin 10 mg daily.
- Furosemide 40 mg PRN — counseled on signs of volume overload (>2 lb weight gain, foot swelling, dyspnea, PND); use PRN as instructed.
- Daily weights, low-sodium diet (1500–2000 mg/day) reinforced.

AFib / Anticoagulation:
- Continue apixaban 5 mg BID. CHA2DS2-VASc 5 — high stroke risk justifies anticoagulation.
- Reassess ASA/apixaban duality: discussed with patient and son — given >12 months post-PCI and no high-risk anatomy, plan to discontinue ASA at next visit if stable to reduce bleeding risk. Today continue both. Educate on bleeding signs.
- HAS-BLED 3 (age, prior medication, anti-platelet) — modifiable: drop ASA next visit; counseled fall-prevention.

Cognition:
- Continue donepezil 5 mg nightly — improving MoCA. Consider titration to 10 mg in 4 weeks if no GI side effects.
- Continue SLP cognitive training (separate rehab episode).
- Continue Dr. Donovan supportive therapy.

MSK / Falls:
- Continue PT 2×/week — coordinated post-ORIF + balance.
- Home-safety modifications complete; reviewed.
- Vitamin D + calcium continue.

Surveillance:
- Repeat TTE 6 months.
- Repeat NT-proBNP + BMP in 8 weeks.
- Annual eye exam.
- DEXA — not done since fracture; order today (osteoporosis evaluation indicated post-hip-fracture).

Follow-up:
- 8 weeks for HF labs + ASA decision.
- Sooner for >2 lb weight gain in 24 hrs, dyspnea progression, syncope, falls, melena, hematuria, new confusion or depression.

Patient education:
- Reviewed quadruple-therapy purpose, daily weight log, sodium label reading, fall-prevention checklist, donepezil GI side effects, bleeding red flags, when to use furosemide PRN.

Capacity:
- Reviewed today; preserved for ongoing care decisions. Son and daughter aware of advance directive on file.`,
    },
  ],
  transcript: timedTranscript(
    [
      { speaker: 'CLINICIAN', text: 'Linda, your son is here too — good. Let us go through your heart, hip, and memory all together.' },
      { speaker: 'PATIENT', text: 'Robert keeps me organized.' },
      { speaker: 'CLINICIAN', text: 'Your ejection fraction is up from thirty to thirty-five — significant improvement. NT-proBNP is way down too.' },
      { speaker: 'PATIENT', text: 'I take all four heart pills as prescribed. Pill organizer, Sundays.' },
      { speaker: 'CLINICIAN', text: 'Excellent adherence. How many times have you used the water pill in the last month?' },
      { speaker: 'PATIENT', text: 'Twice. Both times after a salty restaurant meal.' },
      { speaker: 'CLINICIAN', text: 'Smart use. Daily weights — any jumps?' },
      { speaker: 'PATIENT', text: 'Stable around one forty-eight. One forty-nine today.' },
      { speaker: 'CLINICIAN', text: 'Hip — ten weeks post-op. Walking with the rolling walker indoors?' },
      { speaker: 'PATIENT', text: 'Cane outdoors when Robert is with me. Stairs with the rail.' },
      { speaker: 'CLINICIAN', text: 'PT is doing the right work. Now your atrial fibrillation — heart rate is seventy-two today, irregular as expected. You are on the blood thinner and aspirin both.' },
      { speaker: 'PATIENT', text: '[Son, present in room]: She bruises easily now.' },
      { speaker: 'CLINICIAN', text: 'Right — and that is the conversation. You are more than twelve months past your stent. The aspirin adds bleeding risk now without much extra benefit.' },
      { speaker: 'PATIENT', text: 'Should I stop it?' },
      { speaker: 'CLINICIAN', text: 'Today we keep both. Eight weeks from now if everything is stable I want to drop the aspirin.' },
      { speaker: 'PATIENT', text: 'OK.' },
      { speaker: 'CLINICIAN', text: 'Memory testing with Britta and Dr. Donovan went up from twenty-four to twenty-five. Donepezil is helping.' },
      { speaker: 'PATIENT', text: '[Son]: I have noticed she is sharper.' },
      { speaker: 'CLINICIAN', text: 'No GI side effects?' },
      { speaker: 'PATIENT', text: 'No nausea. Sleep good.' },
      { speaker: 'CLINICIAN', text: 'In four weeks if stable we can move to ten milligrams. We will coordinate with Dr. Donovan.' },
      { speaker: 'CLINICIAN', text: 'Bone density — you fell and broke a hip. We need a DEXA. I will order today.' },
      { speaker: 'PATIENT', text: 'My mother had osteoporosis.' },
      { speaker: 'CLINICIAN', text: 'Even more reason. Continue calcium and vitamin D. We may add a bone medicine after DEXA.' },
      { speaker: 'CLINICIAN', text: 'Capacity for these decisions — I want to ask straight, Linda. You are managing your own meds with help, right?' },
      { speaker: 'PATIENT', text: 'Yes — Robert does a check-in twice a week.' },
      { speaker: 'CLINICIAN', text: 'Good. Advance directive on file is current?' },
      { speaker: 'PATIENT', text: '[Son]: Yes — I have a copy and so does my sister.' },
      { speaker: 'CLINICIAN', text: 'Fall prevention — home modifications done. Vision check is current. PT addressing balance and strength.' },
      { speaker: 'CLINICIAN', text: 'Eight weeks for follow-up labs and aspirin decision. Call sooner for sudden weight gain over two pounds in a day, increased shortness of breath, falls, blood in urine or stool, or sudden confusion.' },
      { speaker: 'PATIENT', text: '[Son]: Got it.' },
      { speaker: 'PATIENT', text: 'Thank you, Doctor.' },
    ],
    34,
  ),
  handout: handout(
    'Heart function is improving on all four medicines. Memory is stable and slightly better with donepezil. Hip recovery on track. We are ordering a bone density scan.',
    [
      'Continue all 4 heart medicines (ARNI + metoprolol + spironolactone + dapagliflozin)',
      'Continue apixaban (blood thinner) and aspirin — drop aspirin in 8 weeks if stable',
      'Furosemide 40 mg as needed for swelling/weight gain',
      'Daily weight, log it',
      'Low-sodium diet 1500–2000 mg/day',
      'Donepezil 5 mg nightly — continue, may increase in 4 weeks',
      'Continue PT for hip and balance',
      'DEXA scan ordered today',
      'Calcium + vitamin D continue',
      'Follow up in 8 weeks',
    ],
    [
      'Weight gain over 2 lb in a day',
      'New or worsening shortness of breath',
      'Swelling in the feet or ankles that does not go away',
      'Fainting or near-fainting',
      'Falls',
      'Blood in urine, stool, or unusual bruising',
      'Sudden new confusion',
    ],
    [
      'Any of the above red flags',
      'Severe chest pain — call 911',
      'Stroke symptoms (face droop, arm weakness, speech change) — call 911',
    ],
  ),
};

/** Linda — hip PT eval, 2 weeks post-ORIF. */
const LINDA_HIP_EVAL: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-lf-pt-hip-0',
  orgId: ORG_ID,
  siteId: SITE_WELLNESS,
  patientId: PID,
  patientFirstName: 'Linda',
  clinicianEmail: 'pt.okonkwo@riverbend.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 56,
  departmentKey: 'rehab',
  episodeId: EP_HIP,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Initial PT eval — 2 weeks post right femoral neck ORIF after mechanical fall at home. Cleared by ortho for full weight-bearing as tolerated. Currently using rolling walker indoors with 1A assist. Goal: independent community ambulation with rolling walker, eventual single-point cane, return to home alone with safety modifications complete. Comorbidities pertinent to rehab: HFrEF (NYHA II — needs activity tolerance monitoring), AFib on apixaban (fall + bleeding risk), MCI (instructions in writing), prior CAD with PCI 2022.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Surgical scar: well-healed, no erythema, no drainage.
ROM: hip flexion R 70° (vs 100° L), abduction 15° (vs 30° L), IR/ER limited and protected.
MMT: hip abductor R 2+/5 (significant deficit, expected post-op), quadriceps R 3/5, glute med R 2+/5.
Berg Balance Scale: 28/56 (high fall risk; threshold ≤45).
Timed Up and Go: 30.2 sec with rolling walker (very high fall risk; ≥13.5 = high).
Gait speed: 0.32 m/s (functional community ambulation requires ≥0.6 m/s).
30-sec sit-to-stand: 5 reps with arm push (was unable pre-treatment).
Single-leg stance R: unable. L: 8 sec.
Pain: 4/10 with weight-bearing, 1/10 at rest.
Activity tolerance: 8 min before mild dyspnea (HF baseline NYHA II).`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Bed mobility and transfer training — log roll, sit-to-stand with hip precaution review (no flexion >90°, no adduction past midline, no IR — although standard ORIF has fewer restrictions, we maintain provisional precautions per ortho preference).
Strengthening: ankle pumps, quad sets, glute squeezes 3×10 each.
Gait: parallel bar standing weight shifts, then rolling walker ×30 ft × 2 with rest.
Patient + family education: written HEP with large font, fall prevention review, when to use furosemide PRN if dyspnea/swelling escalates, signs of DVT/PE, infection.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated session well. HR 88 peak, no chest pain, no excessive dyspnea (NYHA II baseline). SpO2 96% throughout. Fatigue moderate; required 2 rest breaks. Verbalized HEP back accurately.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG (12 weeks): independent community rolling-walker ambulation, BBS ≥45, gait speed ≥0.6 m/s.
STG (4 weeks): TUG <20 sec, hip abductor MMT ≥3+/5.
STG (8 weeks): BBS ≥40, transition to single-point cane indoors.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `PT 2×/week × 12 weeks at Riverbend Wellness. HEP daily — written instructions. Home health PT bridge for first 2 weeks transitioned to outpatient. Coordinate with PCP for HF activity tolerance and family for transport. Concurrent balance/gait episode initiated separately to focus on broader fall prevention. Acetaminophen for pain (avoid NSAIDs given HF + CKD + anticoagulation).`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Linda, two weeks post-op — let us start with the rolling walker safely.' },
    { speaker: 'PATIENT', text: 'My son set the apartment up. Grab bars, raised toilet, no rugs.' },
    { speaker: 'CLINICIAN', text: 'TUG today is thirty seconds — high fall risk. We have work to do but you are exactly where I expect at week two.' },
    { speaker: 'PATIENT', text: 'I want to walk to the mailbox alone.' },
    { speaker: 'CLINICIAN', text: 'That is a great goal. We need balance and hip strength. Twelve weeks of two-per-week with home program daily.' },
    { speaker: 'PATIENT', text: 'I will do my best.' },
    { speaker: 'CLINICIAN', text: 'Heart-wise — eight minutes before a little shortness of breath. We work within that. Ankle pumps, quad sets, glute squeezes — written down for you.' },
  ],
  handout: handout(
    'You are 2 weeks out from hip surgery. Home exercises every day. Keep using the rolling walker as instructed.',
    [
      'Ankle pumps every hour while awake',
      'Quad sets — 10 reps three times daily',
      'Glute squeezes — 10 reps three times daily',
      'Sit-to-stand practice — 5 reps three times daily',
      'PT twice weekly at Wellness Center',
      'Use furosemide if weight up over 2 lb or new swelling',
    ],
    [
      'Calf swelling, redness, or pain (DVT)',
      'Sudden chest pain or shortness of breath (PE)',
      'Weight gain over 2 lb in a day',
      'Increased confusion',
      'Fall with new pain',
      'Drainage or redness at hip incision',
    ],
    [
      'Any DVT or PE signs — call ortho immediately',
      'Heart failure red flags',
      'Falls with injury — call son and PCP',
    ],
  ),
};

/** Linda — balance/gait PT progress (concurrent rehab episode). */
const LINDA_BALANCE_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-lf-pt-balance-0',
  orgId: ORG_ID,
  siteId: SITE_WELLNESS,
  patientId: PID,
  patientFirstName: 'Linda',
  clinicianEmail: 'pt.okonkwo@riverbend.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 9,
  departmentKey: 'rehab',
  episodeId: EP_BALANCE,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Visit 14/24 (week 9 post-ORIF) of balance/gait episode running in parallel with hip episode. Linda reports walked to mailbox alone twice this week with rolling walker. Pain 1/10 hip. No falls since surgery. Reports more confidence in legs.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Berg Balance Scale: 42/56 (was 28 at eval — 14-point improvement, exceeds MCID).
TUG: 18.6 sec (was 30.2 at eval).
Gait speed: 0.55 m/s (was 0.32) — approaching community-ambulation threshold.
30-sec sit-to-stand: 8 reps (was 5).
MMT hip abductor R: 4-/5 (was 2+/5).
Single-leg stance R: 6 sec (was unable).`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Strengthening: side-lying hip abduction 3×12, mini-squats to chair 3×10, banded sidestepping 2×15.
Balance: Romberg progressions, weight shifts, narrow base, tandem stance.
Gait: rolling walker progression to single-point cane indoors trial 30 ft × 3.
Functional: simulated kitchen retrieval task with cane.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `No symptoms. HR peak 84, BP 122/72, SpO2 97% — within HF activity safety range. Confident and engaged.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `STG TUG <20 sec — MET (18.6).
STG hip abductor ≥3+/5 — MET (4-/5).
STG BBS ≥40 — MET (42).
LTG community rolling-walker + BBS ≥45 + gait speed ≥0.6 m/s — in progress.
30-sec STS ≥10 — in progress (8).`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue 2×/week × 4 more weeks. Begin outdoor walking program with son once weekly. Order DEXA per PCP. Discharge planning at week 16 with maintenance HEP and community senior fitness referral.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Linda, you walked to the mailbox alone twice this week — that is huge.' },
    { speaker: 'PATIENT', text: 'I waited until the path dried after rain.' },
    { speaker: 'CLINICIAN', text: 'Smart. Berg score went from twenty-eight to forty-two. Today we trial the single-point cane indoors.' },
    { speaker: 'PATIENT', text: 'I have not used the cane yet.' },
    { speaker: 'CLINICIAN', text: 'Thirty feet at a time today, three sets. We progress to longer indoors next visit.' },
  ],
  handout: handout(
    'Balance and walking are improving substantially. Continue daily exercises and short outdoor walks with your son.',
    [
      'Side-lying hip abduction 12 reps daily',
      'Mini-squats to chair 10 reps',
      'Banded sidestepping 15 reps',
      'Tandem stance practice',
      'Outdoor walk with son once weekly',
      'PT twice weekly',
    ],
    ['Falls or near-falls', 'New or worsening shortness of breath', 'New chest pain'],
    ['Falls — call son and PCP', 'Heart failure red flags'],
  ),
};

/** Linda — SLP cognitive therapy (rehab — could be mapped to BH but anchored here in MCI BH episode). */
const LINDA_BH_COGNITIVE: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-lf-bh-cognitive-0',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Linda',
  clinicianEmail: 'psy.donovan@riverbend.local',
  division: Division.BEHAVIORAL_HEALTH,
  templateId: 'seed-tmpl-bh-session',
  signedDaysAgo: 18,
  departmentKey: 'bh',
  episodeId: EP_BH,
  sections: [
    {
      id: 'presenting_concern',
      label: 'Presenting Concern',
      content: `Session 6 — supportive therapy + cognitive maintenance for mild cognitive impairment. Linda reports awareness of memory difficulties — primarily names and recent appointment dates. Started donepezil 5 mg 6 weeks ago via PCP coordination; tolerating well, no GI side effects. Family supportive: son visits 2×/week, daughter daily phone. No mood disturbance. Today MoCA 25 (baseline 24).`,
    },
    {
      id: 'mental_status',
      label: 'Mental Status Exam',
      content: `Appearance: well-groomed, ambulates with rolling walker. Behavior: cooperative, pleasant. Speech: normal rate, occasional word-finding pause. Mood: "Content." Affect: euthymic, full range, congruent. Thought process: linear. Thought content: no SI/HI/AVH, no paranoia. Cognition: alert and oriented to person, place, year (slow on date — corrects with calendar cue). Insight: good awareness of cognitive change. Judgment: good.`,
    },
    {
      id: 'risk_assessment',
      label: 'Risk Assessment',
      content: `C-SSRS negative. PHQ-9 3, GAD-7 2. No SI/HI. Functional safety: home-safety modifications complete; medication management with weekly pillbox + son check-in; no driving (decided collaboratively 1 year ago); financial decisions joint with son. Capacity preserved for ongoing daily care decisions.`,
    },
    {
      id: 'interventions',
      label: 'Interventions',
      content: `Supportive therapy: validated effort and progress; reinforced strategies (calendar prompts, written daily lists, repetition with family). Cognitive training: spaced retrieval for grandchildren names, dual-task walking practiced (already integrated by PT colleagues). Discussed advance care planning briefly — already current; no change indicated. Coordinated update with PCP and SLP.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue every-3-week sessions × 4 then quarterly maintenance. Homework: name-recall practice 3×/week with son, journal entries. Repeat MoCA at 6 months. Coordination with PCP — supportive of donepezil titration to 10 mg in 2 weeks if no GI side effects (PCP to drive).`,
    },
    {
      id: 'collateral',
      label: 'Collateral / Coordination',
      content: `Updated PCP and SLP per ROI. Son present for last 5 minutes — caregiver psychoeducation reinforced.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Linda, MoCA twenty-five today. The donepezil and the work you are doing are paying off.' },
    { speaker: 'PATIENT', text: 'I still forget names. I write them down now.' },
    { speaker: 'CLINICIAN', text: 'That strategy is exactly right. Spaced retrieval for grandchildren names — let us do five together.' },
    { speaker: 'PATIENT', text: 'OK.' },
    { speaker: 'CLINICIAN', text: 'You have very good awareness of where you are at. That is protective.' },
    { speaker: 'PATIENT', text: 'My son is good — twice a week, calendar reminders.' },
    { speaker: 'CLINICIAN', text: 'We will keep going every three weeks for a few more, then quarterly.' },
  ],
  handout: handout(
    'Memory testing improved. Continue using calendar prompts and written lists. Donepezil dose may go up in 2 weeks.',
    ['Continue donepezil as PCP directs', 'Name-recall practice 3 times weekly with son', 'Journal entry daily', 'Therapy every 3 weeks'],
    ['New or sudden worsening of memory', 'New mood changes', 'Wandering or getting lost'],
    ['Sudden confusion or behavior change — call PCP', 'Falls — call son and PCP'],
  ),
};

export const LINDA_FOSTER_VISITS: SeedVisitCorpus[] = [
  LINDA_HEADLINE,
  LINDA_HIP_EVAL,
  LINDA_BALANCE_PROGRESS,
  LINDA_BH_COGNITIVE,
];