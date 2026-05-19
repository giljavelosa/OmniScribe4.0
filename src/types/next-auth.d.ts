import type { OrgRole, PlatformRole, Division, Profession } from '@prisma/client';
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
  }
}
