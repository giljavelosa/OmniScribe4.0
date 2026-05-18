import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          The real sign-in form lands in Unit 01 (Foundation Auth &amp; Tenancy).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This placeholder confirms that fonts, OKLCH tokens, layout groups, and shadcn primitives
          are wired correctly. Once Unit 01 ships, this screen accepts email + password and routes
          MFA-enabled users through <code>/mfa-challenge</code>.
        </p>
      </CardContent>
    </Card>
  );
}
