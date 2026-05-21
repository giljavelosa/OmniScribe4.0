import { RACHEL_KIM_VISITS } from './rachel-kim';
import { ROBERT_HAYES_VISITS } from './robert-hayes';
import { ELENA_SANTOS_VISITS } from './elena-santos';
import { ACME_EXTENDED_VISITS } from './extended';

export { ACME_ORG_ID, ACME_SITE_MAIN, ACME_SITE_NORTH } from './rachel-kim';
export { ACME_PATIENT_DEMOGRAPHICS } from './demographics';
export {
  RACHEL_KIM_ACME_BRIEF,
  ROBERT_HAYES_ACME_BRIEF,
  ELENA_SANTOS_ACME_BRIEF,
} from './briefs';

export const ACME_VISIT_CORPUS = [
  ...RACHEL_KIM_VISITS,
  ...ROBERT_HAYES_VISITS,
  ...ELENA_SANTOS_VISITS,
  ...ACME_EXTENDED_VISITS,
];
