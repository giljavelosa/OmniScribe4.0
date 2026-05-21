import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from './helpers';

const PID = 'seed-patient-bh';
const EP_BH = 'seed-episode-seed-patient-bh';
const EP_MED = 'seed-episode-dm-medical';
const EP_REHAB = 'seed-episode-dm-rehab';

/** Additional Devon Mitchell visits — medical episode, cervical PT, expanded depth. */
export const DEVON_MITCHELL_EXTENDED: SeedVisitCorpus[] = [
  {
    noteId: 'seed-visit-dm-md-0',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'clinician@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 55,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Chief complaint: Establish care + executive wellness visit before BH referral.

HPI: Devon Mitchell, 30yo non-binary professional (software project manager), establishing with Demo Clinic PCP. Presents for baseline wellness prior to pursuing therapy for work-related anxiety (self-referred to BH — not yet seen). Reports 6+ months escalating worry, sleep 5–6 hrs, tension headaches 2–3×/week, neck/shoulder tightness from prolonged desk work. No prior psychiatric hospitalizations. No regular medications.

Occupational ergonomics: dual monitors, laptop often on couch evenings — admits poor posture. Caffeine 3–4 cups coffee/day, last cup often 4pm. Exercise: sporadic gym 1×/week.

PMH: None. PSH: wisdom teeth 2018.
Meds: ibuprofen PRN headache.
Allergies: NKDA.
Social: Lives with partner, non-smoker, EtOH 2–3 drinks/week. Family hx: mother GAD on escitalopram.

Review of systems — comprehensive:
Constitutional: (+) fatigue PM. HEENT: (+) tension HA. CV/Resp/GI/GU: negative. MSK: (+) neck stiffness end of workday. Neuro: negative. Psych: (+) worry, (−) SI/HI.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 122/78, HR 84, RR 16, Temp 98.6°F, SpO2 99% RA, BMI 24.1, Ht 5'9", Wt 168 lb.

General: Well-groomed, mildly anxious affect, cooperative.
HEENT: PERRLA, TMs clear, oropharynx without exudate.
Neck: paraspinal tenderness bilaterally upper traps, ROM flexion/extension full with mild discomfort at end-range extension, Spurling negative bilaterally.
CV: RRR, no murmurs. Lungs: CTAB. Abd: soft NT.
Neuro: strength 5/5 UE, sensation intact, reflexes 2+ symmetric.
Skin: no rash.

Screeners: PHQ-9: 9 (mild). GAD-7: 15 (moderate-severe).
Labs ordered: TSH, CMP, CBC, fasting lipids — patient fasting today.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `1. Generalized anxiety disorder — symptomatic, not yet in treatment; medically stable for BH/therapy-first approach per patient preference.
2. Tension-type headaches — likely cervicogenic contribution; ergonomic factors.
3. Health maintenance — establish care, labs pending, immunizations reviewed.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `BH: Encouraged to proceed with scheduled LCSW intake. PCP available for med eval if BH recommends.

Headaches/neck: Ergonomic counseling — monitor at eye level, 20-20-20 rule, limit evening couch laptop. PT referral for cervical/upper trap program if headaches persist ×4 weeks despite ergonomics + BH.

Labs: TSH, CMP, CBC, lipids — review portal when resulted.

Preventive: Tdap UTD per record. Discussed STI screening — deferred. Flu season — offer at next visit.

Follow-up: 6 months wellness or sooner if BH requests med eval. Return for HA >4/week despite interventions, or any SI.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Devon, welcome — you are establishing care with us. What would you like to focus on today?' },
        { speaker: 'PATIENT', text: 'Mostly a check-up. I am starting therapy next week for anxiety but wanted a medical baseline.' },
        { speaker: 'CLINICIAN', text: 'Tell me about the anxiety — how long and what it looks like day to day.' },
        { speaker: 'PATIENT', text: 'Six months or more. Racing thoughts about deadlines even when I am on track. Sleep is short.' },
        { speaker: 'CLINICIAN', text: 'Any panic attacks, chest pain, or thoughts of harming yourself?' },
        { speaker: 'PATIENT', text: 'No panic attacks. No suicidal thoughts.' },
        { speaker: 'CLINICIAN', text: 'Your GAD-7 is fifteen — moderate to severe range. Therapy is a great first step.' },
        { speaker: 'PATIENT', text: 'I prefer to try therapy before medication.' },
        { speaker: 'CLINICIAN', text: 'Reasonable. If you and your therapist want medication later, we can coordinate.' },
        { speaker: 'CLINICIAN', text: 'You mentioned headaches — describe them.' },
        { speaker: 'PATIENT', text: 'Band around the head, twice a week, worse after long Zoom days. Neck feels like concrete.' },
        { speaker: 'CLINICIAN', text: 'Let me check neck range and nerve symptoms.' },
        { speaker: 'PATIENT', text: 'No arm numbness.' },
        { speaker: 'CLINICIAN', text: 'Spurling test negative — reassuring. Likely tension and posture.' },
        { speaker: 'CLINICIAN', text: 'How much coffee and when?' },
        { speaker: 'PATIENT', text: 'Three or four cups, last one around four PM sometimes.' },
        { speaker: 'CLINICIAN', text: 'Try cutting off caffeine by noon for two weeks — may help sleep and tension.' },
        { speaker: 'CLINICIAN', text: 'Describe your desk setup.' },
        { speaker: 'PATIENT', text: 'Two monitors but I slouch. Evenings I work on the couch with the laptop.' },
        { speaker: 'CLINICIAN', text: 'Elevate the laptop, external keyboard, twenty-twenty-twenty eye breaks.' },
        { speaker: 'PATIENT', text: 'If headaches continue, should I see PT?' },
        { speaker: 'CLINICIAN', text: 'Yes — I will put in a referral if still weekly after ergonomics and therapy start.' },
        { speaker: 'CLINICIAN', text: 'We are drawing fasting labs today — thyroid, metabolic panel, cholesterol.' },
        { speaker: 'PATIENT', text: 'My mom has anxiety and takes escitalopram.' },
        { speaker: 'CLINICIAN', text: 'Family history noted — does not mean you must take medication.' },
        { speaker: 'CLINICIAN', text: 'Blood pressure and exam otherwise normal. Follow up in six months or sooner if therapy recommends.' },
        { speaker: 'PATIENT', text: 'Thank you — this helps.' },
      ],
      36,
    ),
    handout: handout(
      'Baseline visit complete. Start therapy as planned. Improve desk ergonomics and limit afternoon caffeine.',
      ['Therapy intake next week', 'No caffeine after noon trial', 'Monitor at eye level — no couch laptop', 'Fasting labs drawn today', 'PT referral if headaches persist 4 weeks'],
      ['Suicidal thoughts', 'Worst headache of life', 'Arm numbness with neck pain'],
      ['988 if crisis', 'Call for neurological symptoms'],
    ),
  },

  {
    noteId: 'seed-visit-dm-rehab-0',
    patientId: PID,
    patientFirstName: 'Devon',
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
        content: `PT eval — cervical/upper thoracic mechanical pain and tension-type headaches. Referred by PCP after 6 weeks of persistent work-related neck pain despite ergonomic changes and BH engagement. Devon reports bilateral upper trap pain 5/10 end of workday, headaches 2×/week (down from 3). Started CBT + sertraline — sleep improved to 6–7 hrs. Goal: work full days without end-of-day headache, improve posture endurance.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Posture: forward head 52° (norm <45°), rounded shoulders.
ROM: cervical flexion 45°, extension 50° (pain at end-range extension), rotation R/L 70°.
MMT: upper trap 4+/5 with trigger points bilaterally, deep neck flexors 3+/5 (DNF test hold 12 sec, norm >20).
Special: upper limb tension test negative; cervical compression negative.
Headache disability index (HDI): 42% (moderate).`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Manual: upper trap soft tissue mobilization, cervical SNAGs for extension.
Ther ex: chin tucks 3×10, scapular retraction 3×12, DNF activation 3×10 sec holds.
Ergonomic review: monitor height adjusted in clinic simulation.
Modalities: heat 10 min pre-treatment.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Headache 0/10 post-session. Understands HEP — chin tucks every hour at desk.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `LTG: HDI <20% — baseline 42%.
STG: DNF hold ≥20 sec — baseline 12 sec.
STG: headache frequency ≤1/week — baseline 2/week.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `PT 1×/week ×6 weeks. HEP: chin tucks hourly, scapular sets, doorway stretch. Coordinated with BH — stress management complements posture work.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Devon, tell me about the neck pain pattern across a workday.' },
        { speaker: 'PATIENT', text: 'Fine in the morning. By four PM my traps burn and sometimes I get a headache.' },
        { speaker: 'CLINICIAN', text: 'Your deep neck flexors are weak — common with forward head posture.' },
        { speaker: 'PATIENT', text: 'I do chin tucks sometimes but forget.' },
        { speaker: 'CLINICIAN', text: 'We will set a hourly phone reminder. Let us practice scapular retraction.' },
        { speaker: 'PATIENT', text: 'Therapy and sertraline helped sleep — headaches are less frequent already.' },
        { speaker: 'CLINICIAN', text: 'Good — PT addresses the mechanical piece. Chin tucks ten reps every hour at desk.' },
        { speaker: 'PATIENT', text: 'How long until I can work without the four PM headache?' },
        { speaker: 'CLINICIAN', text: 'Most desk workers see meaningful change in four to six weeks with consistent HEP.' },
      ],
      32,
    ),
    handout: handout(
      'Neck pain is linked to posture and muscle endurance. Do chin tucks hourly and scapular exercises daily.',
      ['Chin tucks 10 reps every hour at desk', 'Scapular retraction 12 reps 3× daily', 'Doorway stretch 30 sec ×3', 'PT weekly ×6 weeks'],
      ['Headache with fever', 'Arm weakness', 'Loss of balance'],
      ['Worst headache ever — emergency', 'New neurological symptoms'],
    ),
  },

  {
    noteId: 'seed-visit-dm-rehab-1',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'pt.smith@demo.local',
    division: Division.REHAB,
    templateId: 'seed-tmpl-rehab-daily',
    signedDaysAgo: 5,
    departmentKey: 'rehab',
    episodeId: EP_REHAB,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Visit 3/6. Headaches 1×/week (improved). End-of-day trap pain 3/10. HEP compliance ~70% — hourly chin tucks when calendar reminder fires. Completed full workday without headache twice this week.`,
      },
      {
        id: 'objective_measures',
        label: 'Objective Measures',
        content: `Forward head 48° (improved). DNF hold 18 sec. HDI 28% (down from 42%).
ROM: extension 55° with minimal pain.`,
      },
      {
        id: 'treatment_performed',
        label: 'Treatment Performed',
        content: `Progression: theraband rows 3×12, prone Y raises 3×10, cervical endurance holds.
Work simulation: 45 min seated task with posture checks q15 min — no headache.`,
      },
      {
        id: 'patient_response',
        label: 'Patient Response',
        content: `Encouraged by progress. Pain 1/10 post.`,
      },
      {
        id: 'goal_progress',
        label: 'Goal Progress',
        content: `Headache frequency STG nearly met. DNF improving toward 20 sec target.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue weekly ×3 more. Add standing desk intervals 10 min/hour per patient interest.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Two full workdays without headache — what was different?' },
        { speaker: 'PATIENT', text: 'Used the hourly chin tuck reminder and stopped couch emails.' },
        { speaker: 'CLINICIAN', text: 'Disability score down fourteen points. Extension improved.' },
        { speaker: 'PATIENT', text: 'Anxiety is better too — less clenching I think.' },
        { speaker: 'CLINICIAN', text: 'Stress and posture feed each other. Three more PT visits then maintenance HEP.' },
      ],
      30,
    ),
    handout: handout(
      'Neck program is working. Keep hourly chin tucks and try standing desk intervals.',
      ['Continue HEP daily', 'Standing 10 min each hour if possible', '3 more PT visits'],
      ['Return of daily headaches', 'Arm numbness'],
      ['Call if neurological symptoms'],
    ),
  },
];

export { EP_MED as DEVON_EP_MED, EP_BH as DEVON_EP_BH, EP_REHAB as DEVON_EP_REHAB };
