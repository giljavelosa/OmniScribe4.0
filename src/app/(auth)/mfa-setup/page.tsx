// Stub — full MFA enrollment surface lands in Commit 8.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default function MfaSetupStub() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up MFA</CardTitle>
        <CardDescription>
          MFA enrollment is required for every OmniScribe account (D2: always required).
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Full enrollment surface arrives in the next commit of this PR.
      </CardContent>
    </Card>
  );
}
