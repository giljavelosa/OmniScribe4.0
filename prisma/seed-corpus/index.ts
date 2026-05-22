import { JAMES_PARK_VISITS } from './james-park';
import { MARIA_ALVAREZ_VISITS } from './maria-alvarez';
import { DEVON_MITCHELL_VISITS } from './devon-mitchell';
import { ACME_VISIT_CORPUS } from './acme';

export * from './helpers';
export { SEED_PATIENT_DEMOGRAPHICS } from './demographics';
export {
  buildPatientBrief,
  JAMES_PARK_BRIEF,
  MARIA_ALVAREZ_BRIEF,
  DEVON_MITCHELL_BRIEF,
} from './briefs';
export {
  ACME_VISIT_CORPUS,
  ACME_PATIENT_DEMOGRAPHICS,
  RACHEL_KIM_ACME_BRIEF,
  ROBERT_HAYES_ACME_BRIEF,
  ELENA_SANTOS_ACME_BRIEF,
} from './acme';
export {
  CASCADIA_VISIT_CORPUS,
  CASCADIA_PATIENT_DEMOGRAPHICS,
  CASCADIA_ORG_ID,
  MARCUS_THOMPSON_BRIEF,
  PRIYA_DESAI_BRIEF,
} from './cascadia';
export {
  RIVERBEND_VISIT_CORPUS,
  RIVERBEND_PATIENT_DEMOGRAPHICS,
  RIVERBEND_ORG_ID,
  JAMAL_CARTER_BRIEF,
  LINDA_FOSTER_BRIEF,
} from './riverbend';

export const DEMO_CLINIC_ORG_ID = 'seed-demo-clinic';

export const SEED_VISIT_CORPUS = [
  ...JAMES_PARK_VISITS,
  ...MARIA_ALVAREZ_VISITS,
  ...DEVON_MITCHELL_VISITS,
];
