export const ACME_PATIENT_DEMOGRAPHICS: Record<
  string,
  {
    phone: string;
    email: string;
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string };
    coverage: { carrier: string; planName: string; memberId: string; groupId?: string };
    emergency: { name: string; relationship: string; phone: string };
  }
> = {
  'seed-acme-patient': {
    phone: '+1-555-1101',
    email: 'rachel.kim@email.acme',
    address: { line1: '220 Lakeview Drive', city: 'Springfield', state: 'IL', postalCode: '62703' },
    coverage: { carrier: 'United Demo', planName: 'Choice Plus', memberId: 'UD-RK-77201', groupId: 'ACME-500' },
    emergency: { name: 'David Kim', relationship: 'Spouse', phone: '+1-555-1102' },
  },
  'seed-acme-patient-rehab': {
    phone: '+1-555-1201',
    email: 'robert.hayes@email.acme',
    address: { line1: '15 Birch Lane', city: 'North Springfield', state: 'IL', postalCode: '62711' },
    coverage: { carrier: 'Aetna Demo', planName: 'Medicare Advantage', memberId: 'AET-RH-44102' },
    emergency: { name: 'Linda Hayes', relationship: 'Spouse', phone: '+1-555-1202' },
  },
  'seed-acme-patient-bh': {
    phone: '+1-555-1301',
    email: 'elena.santos@email.acme',
    address: { line1: '908 Willow Court', line2: 'Unit 2', city: 'Springfield', state: 'IL', postalCode: '62702' },
    coverage: { carrier: 'Cigna Demo', planName: 'Open Access', memberId: 'CIG-ES-22901', groupId: 'TECH-88' },
    emergency: { name: 'Maria Santos', relationship: 'Sister', phone: '+1-555-1302' },
  },
};
