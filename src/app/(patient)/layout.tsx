import type { ReactNode } from 'react';
import { BrandWordmark } from '@/components/brand-wordmark';

/**
 * Layout for patient-facing telehealth surfaces (/v/[token],
 * /telehealth/waiting/[scheduleId]). Deliberately mirrors the auth /
 * onboarding shell so patients see consistent branding without any
 * clinician chrome or nav. No auth gate — the magic token (or its
 * post-verify cookie) is the authorization.
 */
export default function PatientLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <BrandWordmark />
        </div>
        {children}
      </div>
    </div>
  );
}
