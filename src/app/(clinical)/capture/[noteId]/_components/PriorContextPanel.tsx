import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Placeholder. Real prior-context brief lands in Unit 06; this stub keeps the
 * capture layouts honest about their slots without faking content.
 */
export function PriorContextPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Prior context</CardTitle>
        <CardDescription>30-second pre-visit brief arrives in Unit 06.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Trajectory · open follow-ups · plan-for-today will surface here once the
        BriefGenerator service is online.
      </CardContent>
    </Card>
  );
}
