export const SEED_PATIENT_DEMOGRAPHICS: Record<
  string,
  {
    phone: string;
    email: string;
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string };
    coverage: { carrier: string; planName: string; memberId: string; groupId?: string };
    emergency: { name: string; relationship: string; phone: string };
  }
> = {
  'seed-patient-medical': {
    phone: '+1-555-0101',
    email: 'james.park@email.demo',
    address: { line1: '142 Oak Street', city: 'Springfield', state: 'IL', postalCode: '62701' },
    coverage: { carrier: 'BlueCross Demo', planName: 'PPO Gold', memberId: 'BC-DM-88421', groupId: 'GRP-100' },
    emergency: { name: 'Sarah Park', relationship: 'Spouse', phone: '+1-555-0102' },
  },
  'seed-patient-rehab': {
    phone: '+1-555-0201',
    email: 'maria.alvarez@email.demo',
    address: { line1: '88 Maple Avenue', line2: 'Apt 3B', city: 'Springfield', state: 'IL', postalCode: '62704' },
    coverage: { carrier: 'Medicare Demo', planName: 'Part B + Medigap', memberId: 'MED-MA-55201' },
    emergency: { name: 'Carlos Alvarez', relationship: 'Son', phone: '+1-555-0202' },
  },
  'seed-patient-bh': {
    phone: '+1-555-0301',
    email: 'devon.mitchell@email.demo',
    address: { line1: '501 Cedar Lane', city: 'Springfield', state: 'IL', postalCode: '62702' },
    coverage: { carrier: 'Aetna Demo', planName: 'Open Choice', memberId: 'AET-DM-33109', groupId: 'EMP-442' },
    emergency: { name: 'Jordan Mitchell', relationship: 'Sibling', phone: '+1-555-0302' },
  },
};
