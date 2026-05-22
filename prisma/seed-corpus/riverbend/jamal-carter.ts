import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from '../helpers';

const ORG_ID = 'seed-riverbend-clinic';
const SITE_MAIN = 'seed-riverbend-site-main';
const SITE_WELLNESS = 'seed-riverbend-site-wellness';

const PID = 'seed-riverbend-patient-jamal';
const EP_MED = 'seed-riverbend-episode-jamal-medical';
const EP_ANKLE = 'seed-riverbend-episode-jamal-ankle';
const EP_PLANTAR = 'seed-riverbend-episode-jamal-plantar';
const EP_BH = 'seed-riverbend-episode-jamal-bh';

/** Jamal — headline 30-minute HIV maintenance + integrated review. */
const JAMAL_HEADLINE: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-jc-md-headline',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Jamal',
  clinicianEmail: 'do.boucher@riverbend.local',
  division: Division.MEDICAL,
  templateId: 'seed-tmpl-medical-soap',
  signedDaysAgo: 7,
  departmentKey: 'medical',
  episodeId: EP_MED,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Chief complaint: Quarterly HIV maintenance visit with comprehensive integrated review (rehab, mental health, sexual health).

HPI: Jamal Carter is a 35-year-old male with HIV-1 infection diagnosed 5 years ago, currently on bictegravir/emtricitabine/tenofovir alafenamide (Biktarvy) once daily. Adherence excellent — uses pill organizer; reports zero missed doses last quarter. Last quantitative HIV-RNA <20 copies/mL (undetectable for 4 consecutive years). Last CD4 658.

Interval: 8 weeks post left lateral malleolus ORIF (slipped on icy step January, no head injury, no LOC). Active rehab with Dr. Okonkwo for ankle plus separate concurrent rehab episode for bilateral plantar fasciitis (which preceded the fall and may have contributed to gait pattern). Returned to part-time work at non-profit; running goal currently deferred until cleared.

Mood/BH: Continues quarterly maintenance therapy with Dr. Donovan. Two-year history MDD recurrent now in partial remission on sertraline 100 mg + maintenance therapy. PHQ-9 self-reported 4. Sleep 7 hr, appetite normal, no SI/HI.

Sexual health: Single, last STI screen 4 months ago (negative). Engaged in serodiscordant relationship recently — partner on PrEP, condoms used consistently. Discussed U=U with patient — patient educates partner.

Other: BP slightly elevated at recent ankle PT visits — ranged 132–138/84–88. No hx HTN. Mild fatigue when increasing activity post-ORIF, denies dyspnea on exertion. No fevers, no opportunistic infection symptoms. Vaccination current — pneumococcal + hep B + flu + zoster age-appropriate per CDC schedule for HIV.

PMH: HIV-1 (5y), MDD recurrent in partial remission, bilateral plantar fasciitis, recent L lateral malleolus fracture s/p ORIF.
PSH: L ankle ORIF (8 weeks ago), tonsillectomy childhood.
Medications: Biktarvy (BIC/FTC/TAF) once daily, sertraline 100 mg daily, multivitamin. Acetaminophen PRN ankle pain.
Allergies: NKDA.
Social: Lives alone, sister Tasha local for support, non-profit grant writer, never smoker, EtOH 4–6 drinks/month, no recreational drugs ×4 years (former episodic methamphetamine use during active depression, sober 4 years).
Family hx: father T2DM + HTN, mother breast CA at 58 (alive), maternal aunt depression.

ROS — comprehensive: Constitutional (−) fevers, night sweats, weight changes (gained 3 lb post-op consistent with reduced activity). HEENT (−) oral lesions, (−) thrush. CV (−) chest pain, (+) BP elevation as noted. Resp (−) cough, (−) dyspnea. GI (−) diarrhea, (−) abdominal pain. GU (−) penile/anal lesions, (−) urethral discharge. Skin (−) new rashes, (−) Kaposi-like lesions. MSK (+) ankle stiffness on stairs, (+) bilateral heel pain AM. Neuro (−) numbness, (−) weakness. Psych (+) low mood improving; (−) SI/HI. Endo/Lymph (−) palpable nodes.`,
    },
    {
      id: 'objective',
      label: 'Objective',
      content: `Vitals: BP 134/86 (L arm seated, repeat 132/84), HR 70, RR 14, Temp 98.0°F, SpO2 99% RA, Ht 5'10", Wt 169 lb (+3 from baseline), BMI 24.3.

General: Alert, healthy-appearing, no acute distress. Ambulates with mild antalgic gait favoring left, no assistive device.
HEENT: PERRLA, oropharynx clear (no thrush, no oral hairy leukoplakia), no cervical or supraclavicular LAD palpable.
Neck: Supple, no JVD, no carotid bruits.
CV: RRR, normal S1/S2, no murmurs, no S3/S4. No edema.
Lungs: CTAB, no wheezes/rales.
Abd: Soft, NT, ND, no HSM.
Skin: No new rashes, no KS-like lesions, surgical scar L lateral ankle well-healed.
Left ankle: surgical scar healed, no erythema, no effusion. ROM dorsiflexion 14° (vs 22° R), plantarflexion 38°. Anterior drawer stable. Mild tenderness over surgical hardware.
Feet (plantar): bilateral medial calcaneal tubercle tenderness L > R, windlass test mildly positive bilateral, gastroc tightness bilateral.
Neuro: CN II–XII intact, motor 5/5 (ankle PF/DF 4+/5 L due to recent surgery), reflexes 2+ symmetric, gait as noted, Romberg negative.
Psych: euthymic, congruent affect, no acute distress.

In-office screens: PHQ-9 4 (minimal), GAD-7 3 (minimal), AUDIT 2 (low risk).
Labs (drawn today): HIV RNA <20 (undetectable), CD4 658 (was 612), CMP/LFTs wnl, CBC wnl, fasting lipids — TC 192, LDL 118, HDL 52, TG 110, A1c 5.5, urinalysis wnl. RPR negative, gonorrhea/chlamydia (urine + pharyngeal + rectal) negative, hepatitis B sAb reactive (vaccinated), hep C Ab negative.`,
    },
    {
      id: 'assessment',
      label: 'Assessment',
      content: `1. HIV-1 infection — virologically suppressed × 4 years, immunologically reconstituted (CD4 658, up from 612). Continue Biktarvy. Adherence excellent.

2. Major depressive disorder, recurrent — in partial remission on sertraline 100 mg + maintenance psychotherapy. PHQ-9 4. Stable.

3. Status post left ankle ORIF (8 weeks) — uncomplicated; rehab progressing per PT. Surgical scar well-healed.

4. Bilateral plantar fasciitis — chronic, in PT (separate episode); contributed to gait mechanics that likely set up fall risk.

5. Newly elevated BP — three readings 132–138/84–88. Office today 132/84 manual. Does not yet meet HTN threshold but sustained pre-HTN; lifestyle counseling warranted; recheck in 4 weeks. ART (TAF-based) is renal-protective compared to TDF — no immediate need to switch.

6. Sexual health — STI panel today negative; in serodiscordant relationship, partner on PrEP, condoms consistent, U=U education reinforced. PrEP not indicated for him (he is the source partner, treated to undetectable).

7. Cardiovascular risk surveillance — baseline lipid panel today; LDL 118 borderline high; ASCVD risk calculation low at 35y but HIV is independent CV risk factor — counseled on prevention; statin not yet indicated but relevant to revisit at 40y or earlier if BP becomes hypertensive.

8. Vaccinations — current per CDC HIV-specific schedule.

9. History of stimulant use disorder — sustained remission ×4 years, no current use, no current cravings reported. Continue sobriety supports.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `HIV / ART:
- Continue Biktarvy daily.
- Repeat HIV-RNA + CD4 in 6 months (every-6-month interval given sustained suppression).
- Continue STI screening every 3 months given sexual activity (next cycle 3 months — site-pathogen-targeted).

BP / Cardiovascular:
- Three weeks of home BP log twice daily provided.
- DASH diet handout, sodium <2300 mg/day, alcohol cap 4 drinks/week (already in range).
- Recheck BP in 4 weeks. If sustained avg ≥130/80, start lisinopril 5 mg (avoid TDF interaction, but he is on TAF — safe).
- Lipids — recheck annually; counseled.

MSK:
- Continue PT 2×/week for ankle (Dr. Okonkwo) and concurrent plantar fasciitis episode.
- Acetaminophen for pain; avoid NSAIDs >3×/week given long-term renal/CV considerations.
- Approve return to running progression when PT clears, anticipate at week 12 post-ORIF.

Mental health:
- Continue sertraline 100 mg + quarterly maintenance therapy with Dr. Donovan.
- PHQ-9 next at 6 months unless symptoms emerge.
- Continue sobriety supports — patient endorsed weekly peer-led group.

Sexual health:
- U=U education reinforced.
- Condoms continued.
- Partner on PrEP — patient supportive.
- Vaccinations: continue annual flu, repeat pneumococcal age 65 unless CD4 drops; HPV catch-up not indicated (>26 with low-risk profile, but discussed).

Follow-up:
- 4 weeks BP recheck (with PA Rivera).
- 6 months HIV labs + full review.
- Sooner for fever, oral lesions, new neuro symptoms, severe depression or SI, BP >160/100, ankle infection signs.`,
    },
  ],
  transcript: timedTranscript(
    [
      { speaker: 'CLINICIAN', text: 'Jamal, four straight years undetectable. That is significant.' },
      { speaker: 'PATIENT', text: 'I take it the same time every morning. Pill organizer Sunday night.' },
      { speaker: 'CLINICIAN', text: 'Walk me through the ankle. Eight weeks since surgery — how is it on stairs?' },
      { speaker: 'PATIENT', text: 'Better. Dorsiflexion is the limit. PT is pushing it.' },
      { speaker: 'CLINICIAN', text: 'Plantar fasciitis is the chronic piece. The PT is treating both.' },
      { speaker: 'PATIENT', text: 'Yes — same therapist. Easier to coordinate.' },
      { speaker: 'CLINICIAN', text: 'Your blood pressure has crept up the past few visits at PT — one thirty-four over eighty-six today. Not high enough yet to start medication but I want a home log.' },
      { speaker: 'PATIENT', text: 'I bought a cuff already since you mentioned it last time.' },
      { speaker: 'CLINICIAN', text: 'Twice a day for three weeks. If average is over one-thirty over eighty, we start lisinopril.' },
      { speaker: 'CLINICIAN', text: 'STI panel today — pharyngeal and rectal swabs covered. Going through a relationship change?' },
      { speaker: 'PATIENT', text: 'New partner — six months. He is on PrEP. We use condoms.' },
      { speaker: 'CLINICIAN', text: 'You teach him about U-equals-U?' },
      { speaker: 'PATIENT', text: 'Yes — he was nervous at first. The education helped.' },
      { speaker: 'CLINICIAN', text: 'You may not need PrEP for him given he is on it. You being undetectable is the most powerful prevention there is.' },
      { speaker: 'PATIENT', text: 'I tell him that.' },
      { speaker: 'CLINICIAN', text: 'Mental health — PHQ-9 four today. Quarterly therapy is working. Sleep?' },
      { speaker: 'PATIENT', text: 'Seven hours most nights. Better than the year I was using.' },
      { speaker: 'CLINICIAN', text: 'Four years sober. How is the recovery community piece?' },
      { speaker: 'PATIENT', text: 'I go weekly. Sponsor for two new guys.' },
      { speaker: 'CLINICIAN', text: 'That structure protects against relapse and depression. Lipids — LDL one-eighteen — borderline. We do not start a statin at thirty-five but I want to revisit at forty unless something changes.' },
      { speaker: 'PATIENT', text: 'Family history is rough — my dad has diabetes and high BP.' },
      { speaker: 'CLINICIAN', text: 'Right — and HIV is an independent cardiovascular risk factor. Prevention now matters. DASH diet, walking once cleared.' },
      { speaker: 'CLINICIAN', text: 'Ankle running — when?' },
      { speaker: 'PATIENT', text: 'PT says about week twelve.' },
      { speaker: 'CLINICIAN', text: 'I will defer to her. Your scar is well-healed, ROM coming back. Keep going.' },
      { speaker: 'PATIENT', text: 'Anything else from the labs I should know?' },
      { speaker: 'CLINICIAN', text: 'CD4 up to six fifty-eight from six twelve. Liver and kidney perfect. Hep B antibodies still protective.' },
      { speaker: 'PATIENT', text: 'Six months out for the next labs?' },
      { speaker: 'CLINICIAN', text: 'Six months for HIV labs, three months for STI screen, four weeks for BP. Call sooner for fever, oral lesions, mood drop, or low feet sensation.' },
      { speaker: 'PATIENT', text: 'Thanks Doc.' },
    ],
    32,
  ),
  handout: handout(
    'HIV is undetectable for 4 years — outstanding. Mood is stable. Track home blood pressure for 3 weeks. Continue ankle and foot therapy.',
    [
      'Biktarvy daily — continue',
      'Sertraline 100 mg daily — continue',
      'Home BP log twice daily for 3 weeks',
      'DASH diet, sodium <2300 mg/day',
      'Continue PT for ankle and plantar fasciitis',
      'STI screen in 3 months',
      'HIV labs in 6 months',
      'Recovery group weekly — continue',
    ],
    [
      'New oral white patches or thrush',
      'Fever above 101 lasting more than 24 hours',
      'BP over 160/100',
      'New depression or thoughts of self-harm',
      'New neuro symptoms — numbness, weakness',
      'Ankle redness, drainage, or fever',
    ],
    [
      'Any thought of self-harm — call 988',
      'Signs of opportunistic infection',
      'Severe ankle complications',
    ],
  ),
};

/** Jamal — ankle PT eval, 2 weeks post-ORIF. */
const JAMAL_ANKLE_EVAL: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-jc-pt-ankle-0',
  orgId: ORG_ID,
  siteId: SITE_WELLNESS,
  patientId: PID,
  patientFirstName: 'Jamal',
  clinicianEmail: 'pt.okonkwo@riverbend.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 42,
  departmentKey: 'rehab',
  episodeId: EP_ANKLE,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Initial PT eval — 2 weeks post left lateral malleolus ORIF. Mechanism: slip on icy step. Currently weight-bearing as tolerated per ortho. Walking with single crutch indoors, two crutches on stairs. Pain 5/10 with weight-bearing, 2/10 at rest. Goal: return to recreational soccer (5-a-side league) within 12 weeks. Pre-fracture chronic bilateral plantar fasciitis (separate concurrent rehab episode) noted; relevant to mechanics.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Surgical scar: well-approximated, sutures removed, no erythema/drainage.
Edema: 1+ pitting at lateral malleolus, +2 cm vs R.
ROM: dorsiflexion 5°, plantarflexion 30°, inversion 5°, eversion 5° (all limited by stiffness + pain).
MMT: ankle PF 3+/5, DF 3/5, inversion 3/5, eversion 3/5 (compared to L 5/5).
Single-leg balance L: 6 sec (R: 38 sec).
Functional: walks on level surface ~50 ft with single crutch, antalgic.
LEFS (Lower Extremity Functional Scale): 28/80.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Edema management: retrograde massage, elevation, compression instruction.
ROM: ankle pumps, alphabet, towel stretch for gastroc.
Strengthening: isometric DF/PF/inv/ev hold ×10 each direction.
Manual: gentle subtalar mobs grade I–II.
Patient education: weight-bearing precautions, gait progression, when to ice (post-exercise + every 2 hr first 48 hr), DVT/infection red flags. Crutch fitting confirmed.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated session well. Pain 4/10 post. No adverse cardiopulmonary signs. Verbalized HEP and edema-management plan.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG (12 weeks): return to soccer with ankle DF ≥20°, single-leg balance ≥30 sec.
STG (4 weeks): DF ≥12°, ambulation with no assistive device level surface.
STG (8 weeks): LEFS ≥55, jog tolerance assessment.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `PT 2×/week × 12 weeks at Riverbend Wellness. HEP 3×/day. Coordinate with concurrent plantar fasciitis episode (same therapist). Ortho follow-up week 6 — communicate ROM at that time. Acetaminophen for pain (per PCP — avoid NSAIDs).`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Two weeks post-op — walk me through how things are at home, Jamal.' },
    { speaker: 'PATIENT', text: 'Slow but doable. Crutches indoors, two on stairs.' },
    { speaker: 'CLINICIAN', text: 'Dorsiflexion is five degrees today — that is our main early target. Twelve weeks to soccer is realistic but you have to do the home program.' },
    { speaker: 'PATIENT', text: 'I will. I miss the league.' },
    { speaker: 'CLINICIAN', text: 'Edema management every two hours first forty-eight after exercises. Ice fifteen minutes elevated.' },
    { speaker: 'PATIENT', text: 'And the plantar fasciitis stuff?' },
    { speaker: 'CLINICIAN', text: 'We pick that back up at week four when ankle weight-bearing is solid.' },
  ],
  handout: handout(
    'You are 2 weeks post-ankle surgery. Range of motion and edema control are the priority. Do home exercises three times a day.',
    ['Ankle pumps and alphabet — every 2 hours', 'Towel calf stretch hold 30 sec', 'Isometric strengthening 10 reps each direction', 'Ice 15 min elevated after exercises', 'PT twice weekly for 12 weeks'],
    ['Calf swelling, redness, or pain (DVT)', 'Sudden chest pain or shortness of breath (PE)', 'Drainage or spreading redness at scar', 'Fever > 101'],
    ['Any DVT or PE warning signs — call ortho immediately', 'Signs of incision infection'],
  ),
};

/** Jamal — ankle PT progress visit 12. */
const JAMAL_ANKLE_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-jc-pt-ankle-1',
  orgId: ORG_ID,
  siteId: SITE_WELLNESS,
  patientId: PID,
  patientFirstName: 'Jamal',
  clinicianEmail: 'pt.okonkwo@riverbend.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 6,
  departmentKey: 'rehab',
  episodeId: EP_ANKLE,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Visit 12/24 (week 8). Pain 1/10 ambulation, 0/10 rest. No assistive device for level walking ×4 weeks. Stairs reciprocal pattern with rail. Walked dog 25 min on flat trail. Asks about jogging — anticipates clearance week 12.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Edema resolved.
ROM: DF 14° (was 5° eval), PF 42°, inversion 18°, eversion 12°.
MMT: ankle PF 4+/5, DF 4+/5.
Single-leg balance L 22 sec (was 6 sec).
LEFS: 58/80 (was 28).
Functional: heel-to-toe walk symmetric, calf raises 12 reps L (vs 16 R).`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Strengthening: single-leg calf raises 3×12, lateral hops with stick reach 2×8, theraband DF 3×15.
Balance: Bosu single-leg stance, eyes-closed challenge.
Functional: simulated soccer cuts at low intensity (with PT in support).`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `Tolerated dynamic challenges without symptoms. Pain 0/10 post.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `STG DF ≥12° — MET (14°).
STG LEFS ≥55 — MET (58).
LTG DF ≥20° — in progress.
Single-leg balance ≥30 sec — in progress.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue 2×/week × 4 more weeks. Begin straight-line jogging week 10 if PF strength symmetric. Plantar fasciitis episode now overlap-treated; coordinate orthotic fitting next visit.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'No assistive device for four weeks now and walking the dog twenty-five minutes — solid.' },
    { speaker: 'PATIENT', text: 'I ran on the spot for thirty seconds yesterday — felt fine.' },
    { speaker: 'CLINICIAN', text: 'Save the jogging for week ten when we plan it. Today we add Bosu balance and lateral hops.' },
    { speaker: 'PATIENT', text: 'Soccer — week twelve still?' },
    { speaker: 'CLINICIAN', text: 'On track. We need full dorsiflexion and balance to thirty seconds first.' },
  ],
  handout: handout(
    'Ankle is on track for soccer return. Add balance and lateral hops. No solo jogging until week 10.',
    ['Single-leg calf raises 12 reps daily', 'Bosu balance 1 min × 3', 'Lateral hops with control', 'Continue ankle ROM stretches', 'PT twice weekly'],
    ['Sharp ankle pain returning above 5/10', 'New ankle giving-way'],
    ['Sudden inability to bear weight', 'Calf swelling or pain (DVT)'],
  ),
};

/** Jamal — plantar fasciitis PT progress. */
const JAMAL_PLANTAR_PROGRESS: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-jc-pt-plantar-0',
  orgId: ORG_ID,
  siteId: SITE_WELLNESS,
  patientId: PID,
  patientFirstName: 'Jamal',
  clinicianEmail: 'pt.okonkwo@riverbend.local',
  division: Division.REHAB,
  templateId: 'seed-tmpl-rehab-daily',
  signedDaysAgo: 4,
  departmentKey: 'rehab',
  episodeId: EP_PLANTAR,
  sections: [
    {
      id: 'subjective',
      label: 'Subjective',
      content: `Visit 5/8 of plantar fasciitis episode (resumed at week 6 post-ankle ORIF once weight-bearing was full). First-step morning pain bilateral now 4/10 (was 7/10 baseline). Wearing OTC orthotics — fitted for custom today. Night splint 4–5 nights/week.`,
    },
    {
      id: 'objective_measures',
      label: 'Objective Measures',
      content: `Palpation: bilateral medial calcaneal tubercle tenderness reduced.
ROM: ankle DF 14° L (matching ankle episode), 18° R.
Heel raise: L 12 reps, R 16 reps.
Windlass test: mildly positive R only.`,
    },
    {
      id: 'treatment_performed',
      label: 'Treatment Performed',
      content: `Eccentric heel drop 3×10 from step bilateral, intrinsic foot doming, gastroc/soleus stretch holds 30 sec ×3.
Custom orthotic casting completed today; delivery 2 weeks.`,
    },
    {
      id: 'patient_response',
      label: 'Patient Response',
      content: `No symptom flare with eccentrics. Optimistic about custom orthotics.`,
    },
    {
      id: 'goal_progress',
      label: 'Goal Progress',
      content: `LTG first-step pain ≤2/10 — in progress (4/10).
LTG return to running — pending ankle clearance.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Continue 1×/week × 3 visits. Pair with ankle visits at same site. Custom orthotics review week 7. Begin straight-line jog program coordinated with ankle plan.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Morning pain four out of ten bilateral — half what it was. Custom orthotics are casted today.' },
    { speaker: 'PATIENT', text: 'OTC ones helped but I want the custom for soccer.' },
    { speaker: 'CLINICIAN', text: 'Eccentric drops three sets of ten daily — keep that up.' },
  ],
  handout: handout(
    'Plantar fasciitis is improving. Custom orthotics in 2 weeks. Continue eccentric heel drops daily.',
    ['Eccentric heel drops 10 reps daily bilateral', 'Calf stretch 30 sec × 3', 'Night splint 5 nights/week', 'Continue OTC orthotic until custom arrives'],
    ['Sharp heel pain over 7/10 returning', 'Numbness or burning in foot'],
    ['Foot infection signs', 'Inability to bear weight'],
  ),
};

/** Jamal — BH quarterly maintenance session. */
const JAMAL_BH_MAINT: SeedVisitCorpus = {
  noteId: 'seed-riverbend-visit-jc-bh-0',
  orgId: ORG_ID,
  siteId: SITE_MAIN,
  patientId: PID,
  patientFirstName: 'Jamal',
  clinicianEmail: 'psy.donovan@riverbend.local',
  division: Division.BEHAVIORAL_HEALTH,
  templateId: 'seed-tmpl-bh-session',
  signedDaysAgo: 14,
  departmentKey: 'bh',
  episodeId: EP_BH,
  sections: [
    {
      id: 'presenting_concern',
      label: 'Presenting Concern',
      content: `Quarterly maintenance session — MDD recurrent in partial remission, sustained sobriety from stimulants 4+ years. Jamal reports stable mood despite recent ankle fracture and reduced activity. PHQ-9 4. No current cravings. Continues weekly recovery community participation, sponsoring two newer members. Adjusting to dating someone after sustained single period; reports anxiety occasionally about disclosing HIV status to new acquaintances but uses learned skills.`,
    },
    {
      id: 'mental_status',
      label: 'Mental Status Exam',
      content: `Appearance: well-groomed, casual. Behavior: cooperative, calm, mild antalgic gait into office. Speech: normal. Mood: "Pretty good — best I have been in a while." Affect: euthymic, full range, congruent. Thought process: linear. Thought content: no SI/HI/AVH. Cognition: A&O ×4. Insight/judgment: excellent.`,
    },
    {
      id: 'risk_assessment',
      label: 'Risk Assessment',
      content: `C-SSRS negative. PHQ-9 4. AUDIT 2. No SI/HI. No current substance cravings. Robust protective factors — sobriety community, sponsor + sponsoring others, sister support, stable medical care.`,
    },
    {
      id: 'interventions',
      label: 'Interventions',
      content: `Maintenance therapy / relapse prevention focus. Reviewed early warning signs — sleep <6 hr, isolation, skipping recovery meetings. Discussed disclosure decisions in dating with values clarification. Reinforced cognitive flexibility around new partner's PrEP use as shared protection rather than personal risk marker. Noted frustration with reduced exercise during ankle recovery — affirmed plan to use alternative coping tools (writing, peer connection) until cleared.`,
    },
    {
      id: 'plan',
      label: 'Plan',
      content: `Quarterly maintenance schedule. Continue sertraline 100 mg + recovery community + sponsor work. PHQ-9 next 3 months unless symptoms emerge. Patient agreed to message office between sessions if early warnings appear.`,
    },
    {
      id: 'collateral',
      label: 'Collateral / Coordination',
      content: `Coordination with PCP (Dr. Boucher) confirmed via shared note system; PHQ-9 trend stable.`,
    },
  ],
  transcript: [
    { speaker: 'CLINICIAN', text: 'Jamal, four years sober. PHQ-9 four today. How does that sit with you?' },
    { speaker: 'PATIENT', text: 'Better than it ever has. Even with the ankle and the dating stuff.' },
    { speaker: 'CLINICIAN', text: 'Tell me about the disclosure piece.' },
    { speaker: 'PATIENT', text: 'I tell people early. Most are cool, especially when I explain U-equals-U. New partner was nervous at first. He is on PrEP now.' },
    { speaker: 'CLINICIAN', text: 'You used the disclosure framework we built.' },
    { speaker: 'PATIENT', text: 'Yes. It still feels vulnerable but the script helps.' },
    { speaker: 'CLINICIAN', text: 'Continue quarterly schedule. Message me if sleep drops below six hours for a few nights or you start skipping meetings.' },
  ],
  handout: handout(
    'Mood is stable in remission. Continue medication and recovery community. Watch for early warning signs.',
    ['Continue sertraline 100 mg', 'Weekly recovery meeting', 'Sponsor work continues', 'Quarterly therapy', 'Message office for early warning signs'],
    ['Sleep less than 6 hours for several nights', 'Isolation or skipping meetings', 'Substance cravings'],
    ['Suicidal thoughts — call 988', 'Cravings or near-relapse — call sponsor and 988 if needed'],
  ),
};

export const JAMAL_CARTER_VISITS: SeedVisitCorpus[] = [
  JAMAL_HEADLINE,
  JAMAL_ANKLE_EVAL,
  JAMAL_ANKLE_PROGRESS,
  JAMAL_PLANTAR_PROGRESS,
  JAMAL_BH_MAINT,
];