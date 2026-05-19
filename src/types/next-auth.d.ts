import type { OrgRole, PlatformRole, Division, Profession } from '@prisma/client';
import type { ImpersonationContext } from '@/lib/impersonation';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      emailVerified: Date | null;
      name: string | null;
      image: string | null;
      orgId: string | null;
      orgUserId: string | null;
      role: OrgRole | null;
      division: Division | null;
      profession: string | null;
      professionType: Profession | null;
      mfaEnabled: boolean;
      mfaVerified: boolean;
      platformRole: PlatformRole;
    };
    /** Unit 32 — present when the platform owner is actively
     *  impersonating another user. Mutations are refused while this
     *  field is set (see assertNotImpersonating + middleware.ts). */
    impersonation?: ImpersonationContext | null;
  }

  interface User {
    id: string;
    email: string;
    emailVerified: Date | null;
    name: string | null;
    image: string | null;
    orgId: string | null;
    orgUserId: string | null;
    role: OrgRole | null;
    division: Division | null;
    profession: string | null;
    professionType: Profession | null;
    mfaEnabled: boolean;
    mfaVerified: boolean;
    platformRole: PlatformRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    email: string;
    orgId: string | null;
    orgUserId: string | null;
    role: OrgRole | null;
    division: Division | null;
    profession: string | null;
    professionType: Profession | null;
    mfaEnabled: boolean;
    mfaVerified: boolean;
    platformRole: PlatformRole;
    /** Unit 32 — impersonation context lives on the JWT so middleware
     *  (which can't reach the DB) can enforce the read-only mutation
     *  gate at the edge. Cleared by the end-impersonation endpoint. */
    impersonation?: ImpersonationContext | null;
  }
}
