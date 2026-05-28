/**
 * Onboarding step — "Where do you work?"
 * Spec: context/specs/clinician-site-enrollment.md §UI/Clinician onboarding
 *
 * Inserted between sign-in and landing on /home. Skipped for
 * ORG_ADMIN+ (they implicitly cover every site) and for users who already
 * have at least one enrollment (admins typically pre-enrol on invite — only
 * the un-enrolled fall through).
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { isAllSitesRole } from '@/lib/authz/site-scope';
import { OnboardingSitesForm } from './_components/onboarding-sites-form';

export const metadata: Metadata = { title: 'Where do you work?' };
export const dynamic = 'force-dynamic';

export default async function OnboardingSitesPage() {
  const session = await auth();
  if (!session?.user || !session.user.orgId || !session.user.orgUserId) {
    redirect('/login');
  }
  // Sprint 0.20 — MFA removed; the post-signin gate at this layer is just
  // "must be signed in" (already checked above).

  const orgUser = await prisma.orgUser.findUnique({
    where: { id: session.user.orgUserId },
    select: { role: true, siteEnrollments: { select: { siteId: true } } },
  });
  if (!orgUser) redirect('/home');

  // Skip the step for org-wide-admins or anyone already enrolled.
  if (isAllSitesRole(orgUser.role) || orgUser.siteEnrollments.length > 0) {
    redirect('/home');
  }

  const sites = await prisma.site.findMany({
    where: { orgId: session.user.orgId, isArchived: false },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, address: true },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where do you work?</CardTitle>
        <CardDescription>
          Pick the sites you see patients at. Pick one primary. Your admin can
          adjust this any time on the Team members page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OnboardingSitesForm sites={sites} />
      </CardContent>
    </Card>
  );
}
