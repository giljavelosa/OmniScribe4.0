export type MedicationReference = {
  medicationName: string;
  canonicalName: string;
  aliases: string[];
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  adultDosing: Array<{
    indication: string;
    usualStartingDose: string;
    titration: string;
    maximumDose: string;
    lowerStartingDoseConsiderations: string[];
    monitoring: string[];
  }>;
  patientContextCautions: string[];
};

const MEDICATION_REFERENCES: MedicationReference[] = [
  {
    medicationName: 'Losartan potassium',
    canonicalName: 'losartan',
    aliases: ['losartan', 'cozaar', 'losartan potassium'],
    sourceId: 'dailymed:losartan-potassium',
    sourceLabel: 'DailyMed losartan potassium label',
    sourceUrl: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=losartan%20potassium',
    adultDosing: [
      {
        indication: 'adult hypertension',
        usualStartingDose: '50 mg by mouth once daily',
        titration: 'Titrate based on blood-pressure response.',
        maximumDose: '100 mg by mouth once daily',
        lowerStartingDoseConsiderations: [
          '25 mg once daily for possible intravascular volume depletion, such as active diuretic therapy.',
          '25 mg once daily for mild-to-moderate hepatic impairment.',
        ],
        monitoring: [
          'Blood pressure response',
          'Serum potassium',
          'Renal function/creatinine after initiation or dose change when clinically indicated',
        ],
      },
    ],
    patientContextCautions: [
      'Age alone is not listed as a dose-reduction criterion in the referenced adult hypertension dosing.',
      'Kidney disease, potassium status, volume status, diuretic use, hepatic impairment, and interacting medications should be considered before applying the general dosing range.',
    ],
  },
];

export function lookupMedicationReference(medicationName: string): MedicationReference | null {
  const normalized = normalizeMedicationName(medicationName);
  if (!normalized) return null;
  return MEDICATION_REFERENCES.find((entry) =>
    entry.aliases.some((alias) => normalizeMedicationName(alias) === normalized),
  ) ?? null;
}

function normalizeMedicationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
