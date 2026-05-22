import { JAMAL_CARTER_VISITS } from './jamal-carter';
import { LINDA_FOSTER_VISITS } from './linda-foster';

export { RIVERBEND_PATIENT_DEMOGRAPHICS } from './demographics';
export { JAMAL_CARTER_BRIEF, LINDA_FOSTER_BRIEF } from './briefs';

export const RIVERBEND_ORG_ID = 'seed-riverbend-clinic';
export const RIVERBEND_SITE_MAIN = 'seed-riverbend-site-main';
export const RIVERBEND_SITE_WELLNESS = 'seed-riverbend-site-wellness';

export const RIVERBEND_VISIT_CORPUS = [
  ...JAMAL_CARTER_VISITS,
  ...LINDA_FOSTER_VISITS,
];
