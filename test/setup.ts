import { GlobalRegistrator } from '@happy-dom/global-registrator';
import '@testing-library/jest-dom/vitest';

if (!globalThis.document) {
  GlobalRegistrator.register({ url: 'http://localhost:3000' });
}
