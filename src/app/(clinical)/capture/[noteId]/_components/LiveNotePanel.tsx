import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Placeholder. Real live-note draft + section progress strip lands in Unit 05
 * (Note Generation & Sign). Per design-critique-capture-flow.md, this panel
 * uses GENERATION status only ("Drafting", "Awaiting more detail", "Draft
 * live") — never "Listening", which is the header's job.
 */
export function LiveNotePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Live note</CardTitle>
        <CardDescription>Section-by-section draft arrives in Unit 05.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Section progress strip + AI draft will appear here once the LLM abstraction
        + division prompts land.
      </CardContent>
    </Card>
  );
}
