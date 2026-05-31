import type { ExtractionJson } from '@/types/external-context-extraction';

export function buildVerifiedDocumentTranscript(extraction: ExtractionJson): string {
  const lines = [
    `Verified uploaded document — ${extraction.documentType.replaceAll('_', ' ')}`,
    `Summary: ${extraction.summary}`,
  ];

  pushItems(lines, 'Diagnoses', extraction.diagnoses.map((d) => `${d.text}${d.icdHint ? ` (${d.icdHint})` : ''}`));
  pushItems(lines, 'Medications', extraction.medications.map((m) => {
    const parts = [m.name, m.dose, m.route, m.frequency].filter(Boolean);
    return `${parts.join(' ')}${m.status ? ` — ${m.status}` : ''}`;
  }));
  pushItems(lines, 'Allergies', extraction.allergies.map((a) => `${a.substance}${a.reaction ? ` — ${a.reaction}` : ''}`));
  pushItems(lines, 'Labs', extraction.labs.map((l) => {
    const value = [l.value, l.unit].filter(Boolean).join(' ');
    return `${l.name}: ${value}${l.abnormalFlag ? ` (${l.abnormalFlag})` : ''}`;
  }));
  pushItems(lines, 'Vitals', extraction.vitals.map((v) => `${v.type}: ${[v.value, v.unit].filter(Boolean).join(' ')}`));
  pushItems(lines, 'Procedures', extraction.procedures.map((p) => `${p.text}${p.date ? ` (${p.date})` : ''}`));

  if (extraction.documentDateGuess) lines.push(`Document date guess: ${extraction.documentDateGuess}`);
  if (extraction.extractionNotes) lines.push(`Review notes: ${extraction.extractionNotes}`);
  return lines.join('\n');
}

function pushItems(lines: string[], label: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push(`${label}:`);
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}
