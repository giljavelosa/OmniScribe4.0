import { MARCUS_THOMPSON_VISITS } from './marcus-thompson';
import { PRIYA_DESAI_VISITS } from './priya-desai';

export { CASCADIA_PATIENT_DEMOGRAPHICS } from './demographics';
export { MARCUS_THOMPSON_BRIEF, PRIYA_DESAI_BRIEF } from './briefs';

export const CASCADIA_ORG_ID = 'seed-cascadia-clinic';
export const CASCADIA_SITE_MAIN = 'seed-cascadia-site-main';
export const CASCADIA_SITE_REHAB = 'seed-cascadia-site-rehab';

export const CASCADIA_VISIT_CORPUS = [
  ...MARCUS_THOMPSON_VISITS,
  ...PRIYA_DESAI_VISITS,
];
