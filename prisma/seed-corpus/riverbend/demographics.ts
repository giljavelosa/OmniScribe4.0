export const RIVERBEND_PATIENT_DEMOGRAPHICS: Record<
  string,
  {
    phone: string;
    email: string;
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string };
    coverage: { carrier: string; planName: string; memberId: string; groupId?: string };
    emergency: { name: string; relationship: string; phone: string };
  }
> = {
  'seed-riverbend-patient-jamal': {
    phone: '+1-555-3101',
    email: 'jamal.carter@email.riverbend',
    address: { line1: '47 Pearl Street', line2: 'Apt 4', city: 'Burlington', state: 'VT', postalCode: '05401' },
    coverage: { carrier: 'BCBS Demo VT', planName: 'Vermont Choice', memberId: 'BCB-JC-71204', groupId: 'RIV-820' },
    emergency: { name: 'Tasha Carter', relationship: 'Sister', phone: '+1-555-3102' },
  },
  'seed-riverbend-patient-linda': {
    phone: '+1-555-3201',
    email: 'linda.foster@email.riverbend',
    address: { line1: '12 Birch Hollow Road', city: 'Burlington', state: 'VT', postalCode: '05408' },
    coverage: { carrier: 'Medicare Demo', planName: 'Part B + Medigap F', memberId: 'MED-LF-44218' },
    emergency: { name: 'Robert Foster', relationship: 'Son', phone: '+1-555-3202' },
  },
};
