// Stub — full MFA challenge surface lands in Commit 8.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default function MfaChallengeStub() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify MFA</CardTitle>
        <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Full challenge surface arrives in the next commit of this PR.
      </CardContent>
    </Card>
  );
}
