import type { ReactNode } from 'react';
import { BrandWordmark } from '@/components/brand-wordmark';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <BrandWordmark />
        </div>
        {children}
      </div>
    </div>
  );
}
