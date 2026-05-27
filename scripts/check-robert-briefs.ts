import { prisma } from '@/lib/prisma';

async function main() {
  const briefs = await prisma.noteBrief.findMany({
    where: { patientId: 'cmpj1qq98000gm1uuebt5e8im' },
    orderBy: { generatedAt: 'desc' },
    select: { noteId: true, generatedAt: true, content: true },
  });
  console.log('Briefs for Robert (newest first):');
  for (const b of briefs) {
    const c = b.content as { objectiveMeasures?: Array<Record<string, unknown>> };
    const measures = c?.objectiveMeasures ?? [];
    console.log(
      `  noteId=${b.noteId} generated=${b.generatedAt.toISOString()} measures=${measures.length}`,
    );
    for (const m of measures) {
      console.log(
        `    - ${m.measureKey ?? '(no key)'} | ${m.measure ?? m.label} = ${m.lastValue}`,
      );
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
