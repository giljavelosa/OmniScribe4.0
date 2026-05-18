import { z } from 'zod';

/**
 * Wire schema for NoteTemplate.sectionSchema — validated at every CRUD
 * boundary so the ai-generation worker always sees a known shape.
 *
 * Keep aligned with src/lib/notes/build-prompt.ts NoteSectionDef.
 */

export const TemplateSectionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, underscore, hyphen only'),
  label: z.string().min(1).max(80),
  required: z.boolean().optional(),
  promptHint: z.string().max(500).optional(),
});

export const TemplateSectionSchemaList = z.object({
  sections: z.array(TemplateSectionSchema).min(1).max(20),
});

export type TemplateSection = z.infer<typeof TemplateSectionSchema>;
export type TemplateSectionList = z.infer<typeof TemplateSectionSchemaList>;
