export const CASCADIA_PATIENT_DEMOGRAPHICS: Record<
  string,
  {
    phone: string;
    email: string;
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string };
    coverage: { carrier: string; planName: string; memberId: string; groupId?: string };
    emergency: { name: string; relationship: string; phone: string };
  }
> = {
  'seed-cascadia-patient-marcus': {
    phone: '+1-555-2101',
    email: 'marcus.thompson@email.cascadia',
    address: { line1: '4412 Aurora Ave N', line2: 'Apt 207', city: 'Seattle', state: 'WA', postalCode: '98103' },
    coverage: { carrier: 'Premera Demo', planName: 'Heritage Plus', memberId: 'PRM-MT-66102', groupId: 'CAS-700' },
    emergency: { name: 'Denise Thompson', relationship: 'Spouse', phone: '+1-555-2102' },
  },
  'seed-cascadia-patient-priya': {
    phone: '+1-555-2201',
    email: 'priya.desai@email.cascadia',
    address: { line1: '1812 NE 50th Street', city: 'Seattle', state: 'WA', postalCode: '98105' },
    coverage: { carrier: 'Regence Demo', planName: 'BlueAdvantage HMO', memberId: 'REG-PD-30901', groupId: 'CAS-720' },
    emergency: { name: 'Anil Desai', relationship: 'Spouse', phone: '+1-555-2202' },
  },
};
