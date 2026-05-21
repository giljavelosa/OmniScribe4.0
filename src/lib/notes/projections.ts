/**
 * PHI-aware projections used by the LLM prompt builders.
 *
 * The LLM needs JUST ENOUGH patient + episode context to write a clinically-
 * meaningful note. Anything beyond that is friction / leak surface. These
 * projections deliberately limit what goes into the prompt:
 *
 *   - Patient: first name, age, sex, preferred language, MRN (for
 *     traceability in the note header). DOB/SSN/phone/email NEVER projected.
 *     Note division is passed separately by callers (sourced from
 *     `note.division`, not from the patient).
 *   - Episode : department + diagnosis + body part + active LTG/STG goal
 *     texts. Goal status. NEVER raw goal IDs or note IDs.
 */

import type { Patient, EpisodeOfCare, EpisodeGoal, Department } from '@prisma/client';

export type PatientProjection = {
  firstName: string;
  age: number;
  sex: string;
  preferredLanguage: string | null;
  mrn: string | null;
};

export function projectPatientForPrompt(patient: Patient): PatientProjection {
  return {
    firstName: patient.firstName,
    age: ageInYears(patient.dob),
    sex: patient.sex,
    preferredLanguage: patient.preferredLanguage,
    mrn: patient.mrn,
  };
}

export type EpisodeProjection = {
  diagnosis: string;
  bodyPart: string | null;
  departmentName: string;
  status: string;
  goals: Array<{ text: string; type: string; status: string }>;
};

export function projectEpisodeForPrompt(
  episode: EpisodeOfCare & { department: Department; goals: EpisodeGoal[] },
): EpisodeProjection {
  return {
    diagnosis: episode.diagnosis,
    bodyPart: episode.bodyPart,
    departmentName: episode.department.name,
    status: episode.status,
    goals: episode.goals
      .filter((g) => g.status === 'ACTIVE' || g.status === 'PARTIALLY_MET')
      .map((g) => ({ text: g.goalText, type: g.goalType, status: g.status })),
  };
}

function ageInYears(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}
