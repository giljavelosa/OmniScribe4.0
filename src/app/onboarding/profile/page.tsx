import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requiresProfileCompletion } from '@/lib/auth/profile-completion';
import { ProfileForm } from './_components/profile-form';

export const dynamic = 'force-dynamic';

/**
 * Clinician profile-completion gate landing page.
 *
 * Reached when (clinical)/layout.tsx detects the signed-in user lacks a
 * concrete division (i.e., null or MULTI) or lacks a categorical
 * `professionType`. Submitting the form writes both back to OrgUser +
 * navigates to /home.
 *
 * If the user already has a complete profile, redirect to /home — avoids
 * a loop when the user hits /onboarding/profile directly after completing.
 */
export default async function ProfileCompletionPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!requiresProfileCompletion(session.user)) redirect('/home');

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Finish setting up your account</h1>
        <p className="text-sm text-muted-foreground">
          Before you record your first encounter, tell us your clinical division and
          profession. This drives the default note format and keeps templates focused on
          the work you actually do.
        </p>
      </header>
      <ProfileForm
        currentDivision={session.user.division}
        currentProfessionType={session.user.professionType}
        currentProfession={session.user.profession}
      />
    </div>
  );
}
