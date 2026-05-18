import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NewOrgForm } from './_components/new-org-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New organization' };

export default function NewOrgPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New organization</CardTitle>
          <CardDescription>
            BAA fields are required. Compliance-readiness gate — every paying org has BAA on file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewOrgForm />
        </CardContent>
      </Card>
    </div>
  );
}
