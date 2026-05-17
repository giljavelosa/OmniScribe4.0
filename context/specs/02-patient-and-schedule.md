# Unit 02: Patient & Schedule Core

## Goal

Build the patient + encounter + schedule + episode + department data plane that every clinical surface depends on. After this unit, clinicians can create patients, schedule encounters, manage department enrollments, and start tracking longitudinal episodes of care — but they can't record yet (that's Unit 03).

## Design

UI surfaces:

- **`/patients`** — searchable patient list with name / MRN / age / sex / division / last visit columns. Filters: division, active episode, recently seen. "+ Add Patient" sheet.
- **`/patients/[id]`** — basic patient detail page (full redesign is Unit 12). Identity header (inline editable demographics), visit list, "Schedule visit" CTA.
- **`/patients/[id]/edit`** — PatientEditSheet for full demographics + addresses + coverage + emergency contacts + consents.
- **`/home`** — today's schedule cards (per-appointment with patient name, time, visit type badge), drafts queue (empty until Unit 05), patient search field.
- **`/admin/sites/[id]/departments`** — department CRUD (org admin scope).

Standard clinical layout from `ui-context.md`. Patient identity header uses `<PatientIdentityHeader>` + `<InlineEditableField>` components.

## Implementation

### A. Prisma schema additions

```prisma
enum PatientSex {
  MALE
  FEMALE
  OTHER
  UNKNOWN
}

enum PatientAddressKind {
  HOME
  WORK
  OTHER
}

enum PatientCoverageStatus { ACTIVE TERMINATED PENDING UNKNOWN }
enum PatientConsentStatus { GIVEN DECLINED PENDING REVOKED }
enum PatientDepartmentEnrollmentStatus { ACTIVE INACTIVE COMPLETED WAITLIST }
enum PatientDepartmentIntakeStatus { DRAFT SUBMITTED REVIEWED ARCHIVED }
enum VisitType { IN_PERSON TELEHEALTH }
enum ScheduleStatus { SCHEDULED CONFIRMED CHECKED_IN IN_PROGRESS COMPLETED CANCELLED NO_SHOW }
enum EncounterStatus { PLANNED IN_PROGRESS COMPLETED CANCELLED }
enum EpisodeStatus { ACTIVE RECERT_DUE DISCHARGED CANCELLED }
enum GoalStatus { ACTIVE MET NOT_MET MODIFIED DISCONTINUED PARTIALLY_MET }
enum GoalType { STG LTG }
enum NoteSensitivityLevel { STANDARD_CLINICAL BEHAVIORAL_HEALTH BILLING_ONLY ADMINISTRATIVE }

model Patient {
  id              String   @id @default(cuid())
  orgId           String
  organization    Organization @relation(fields: [orgId], references: [id])
  siteId          String?
  site            Site?    @relation(fields: [siteId], references: [id])
  division        Division
  firstName       String
  lastName        String
  mrn             String
  dob             DateTime
  sex             PatientSex
  phone           String?
  email           String?
  preferredLanguage String?
  isDeleted       Boolean  @default(false)
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  addresses       PatientAddress[]
  coverages       PatientCoverage[]
  emergencyContacts PatientEmergencyContact[]
  guarantors      PatientGuarantor[]
  consents        PatientConsent[]
  communicationPreferences PatientCommunicationPreference[]
  enrollments     PatientDepartmentEnrollment[]
  intakes         PatientDepartmentIntake[]
  encounters      Encounter[]
  schedules       Schedule[]
  episodes        EpisodeOfCare[]
  
  @@unique([orgId, mrn])
  @@index([orgId, lastName, firstName])
  @@index([orgId, isDeleted])
}

model PatientAddress {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  kind        PatientAddressKind
  line1       String
  line2       String?
  city        String
  state       String
  postalCode  String
  country     String   @default("US")
}

model PatientCoverage {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  carrier     String
  planName    String?
  memberId    String
  groupId     String?
  status      PatientCoverageStatus @default(ACTIVE)
  effectiveDate DateTime?
  terminationDate DateTime?
}

model PatientEmergencyContact {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  name         String
  relationship String?
  phone        String?
  email        String?
}

model PatientGuarantor {
  id           String   @id @default(cuid())
  patientId    String
  patient      Patient  @relation(fields: [patientId], references: [id])
  name         String
  relationship String?
  phone        String?
  email        String?
  address      String?
}

model PatientConsent {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  consentType String   // 'recording' | 'voice-id' | 'telehealth' | etc.
  status      PatientConsentStatus
  version     String
  acceptedAt  DateTime?
  declinedAt  DateTime?
}

model PatientCommunicationPreference {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  channel     String   // 'email' | 'sms' | 'phone' | 'portal'
  optedIn     Boolean
}

model Department {
  id          String   @id @default(cuid())
  orgId       String
  organization Organization @relation(fields: [orgId], references: [id])
  siteId      String?  // null = org-wide
  site        Site?    @relation(fields: [siteId], references: [id])
  name        String
  division    Division
  intakeFormSchema Json?  // JSON schema for intake form
  
  enrollments PatientDepartmentEnrollment[]
  intakes     PatientDepartmentIntake[]
  encounters  Encounter[]
}

model PatientDepartmentEnrollment {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  orgId       String
  departmentId String
  department  Department @relation(fields: [departmentId], references: [id])
  status      PatientDepartmentEnrollmentStatus
  enrolledAt  DateTime @default(now())
  endedAt     DateTime?
}

model PatientDepartmentIntake {
  id          String   @id @default(cuid())
  patientId   String
  patient     Patient  @relation(fields: [patientId], references: [id])
  departmentId String
  department  Department @relation(fields: [departmentId], references: [id])
  status      PatientDepartmentIntakeStatus
  sensitivityLevel NoteSensitivityLevel @default(STANDARD_CLINICAL)
  formData    Json
  submittedAt DateTime?
  reviewedAt  DateTime?
}

model Schedule {
  id              String   @id @default(cuid())
  orgId           String
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  clinicianOrgUserId String
  siteId          String
  roomId          String?
  visitType       VisitType
  scheduledStart  DateTime
  scheduledEnd    DateTime
  status          ScheduleStatus @default(SCHEDULED)
  notes           String?  // admin note, not clinical
  createdAt       DateTime @default(now())
  
  encounter       Encounter?
  
  @@index([clinicianOrgUserId, scheduledStart])
  @@index([orgId, scheduledStart])
}

model Encounter {
  id              String   @id @default(cuid())
  orgId           String
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  scheduleId      String?  @unique
  schedule        Schedule? @relation(fields: [scheduleId], references: [id])
  clinicianOrgUserId String
  siteId          String
  roomId          String?
  departmentId    String?
  department      Department? @relation(fields: [departmentId], references: [id])
  episodeOfCareId String?
  episode         EpisodeOfCare? @relation(fields: [episodeOfCareId], references: [id])
  status          EncounterStatus @default(PLANNED)
  startedAt       DateTime?
  endedAt         DateTime?
  
  // Note relation added in Unit 05
  
  @@index([patientId, startedAt])
}

model EpisodeOfCare {
  id              String   @id @default(cuid())
  orgId           String
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  clinicianOrgUserId String
  departmentId    String
  division        Division
  diagnosis       String
  bodyPart        String?
  status          EpisodeStatus @default(ACTIVE)
  startedAt       DateTime @default(now())
  endedAt         DateTime?
  recertDueAt     DateTime?
  visitsAuthorized Int?
  visitsCompleted Int      @default(0)
  
  goals           EpisodeGoal[]
  encounters      Encounter[]
}

model EpisodeGoal {
  id              String   @id @default(cuid())
  episodeId       String
  episode         EpisodeOfCare @relation(fields: [episodeId], references: [id])
  goalType        GoalType
  goalText        String
  baselineMeasure String?
  targetMeasure   String?
  currentMeasure  String?
  status          GoalStatus @default(ACTIVE)
  originNoteId    String?  // set when goal was created in a note
  resolvedNoteId  String?  // set when goal status changed
  createdAt       DateTime @default(now())
  
  progressEntries GoalProgressEntry[]
}

model GoalProgressEntry {
  id          String   @id @default(cuid())
  goalId      String
  goal        EpisodeGoal @relation(fields: [goalId], references: [id])
  noteId      String   // set when progress recorded in a note (Unit 05)
  measureValue String
  recordedAt  DateTime @default(now())
}
```

Run migration. Update seed with 3 demo patients (one per division) + scheduled appointments for the demo clinician.

### B. Patient CRUD API

- `GET /api/patients?query=…&division=…&page=…` — trigram match on lastName/firstName/mrn; 20 results per page; audit `PATIENT_SEARCHED` with `queryLength` (not the query)
- `POST /api/patients` — create patient + first address + first coverage atomically
- `GET /api/patients/[id]` — patient + addresses + coverages + active episodes
- `PATCH /api/patients/[id]` — partial update; audit with changed field list
- `DELETE /api/patients/[id]` — soft-delete (set `isDeleted = true`, `deletedAt = now()`); never hard-delete
- `POST /api/patients/[id]/addresses`, `PATCH .../[addressId]`, similar for coverages, emergency contacts, etc.

Every route: `requireFeatureAccess('PATIENT_MANAGEMENT')` + `orgId` scoping.

### C. Schedule + Encounter API

- `GET /api/schedules?date=...&clinicianId=...&orgId=...`
- `POST /api/schedules` — `requireFeatureAccess('VISITS_CREATE')`
- `PATCH /api/schedules/[id]` — status changes; audit every transition
- `POST /api/schedules/[id]/start` — transition to `IN_PROGRESS`; auto-create `Encounter` + `Note` (status `PREPARING` — `Note` from Unit 05); return `noteId`
- `POST /api/schedules/[id]/cancel` — audit reason; do NOT cancel any associated Note (Notes have their own lifecycle)
- `POST /api/encounters` — for ad-hoc visits (no prior schedule)
- `GET /api/encounters/[id]` — encounter + linked schedule + note + patient summary

### D. Department + enrollment + intake

- `GET / POST / PATCH / DELETE /api/admin/departments` — org admin scope
- `POST /api/patients/[id]/enrollments` — enroll patient in a department
- `PATCH /api/patients/[id]/enrollments/[enrollmentId]` — change status (transfer, discharge)
- `POST /api/patients/[id]/intakes` — submit intake form (form validated against department's `intakeFormSchema`)
- `PATCH /api/patients/[id]/intakes/[intakeId]/sensitivity` — change sensitivity tier (audit + propagation)

### E. Division model

- `Organization.division` is the org default
- `Organization.defaultDivision` overrides if `division == MULTI`
- `EpisodeOfCare.division` overrides per episode
- `Note.division` (set in Unit 05) follows: episode → org default. Locked at recording start.

Helper: `src/lib/divisions/resolve.ts`:

```ts
export function resolveDivisionForNote(patient: Patient, episode: EpisodeOfCare | null, org: Organization): Division {
  if (episode) return episode.division;
  if (org.division !== 'MULTI') return org.division;
  return org.defaultDivision || patient.division;
}
```

### F. UI components

- `<PatientIdentityHeader>` — name · sex/age · MRN · DOB · preferred language · accessibility flags
- `<InlineEditableField>` — Tap to edit, save on blur or Enter; uses `<Input>` primitive
- `<PatientEditSheet>` — full edit form in a `<Sheet>` (right side)
- `<SchedulingCard>` — appointment card on `/home`
- `<DepartmentEnrollmentBadge>` — status pill with `<StatusBadge>`

### G. Soft-delete behavior

`Patient.isDeleted` filters out of `/api/patients` list and search by default. Admin "include deleted" filter shows them. Deleted patients' historical notes remain accessible (audit retention).

## Dependencies

No new npm packages. All existing from Unit 01.

## Verify when done

- [ ] Schema migrations applied; seed produces 3 patients across 3 divisions + scheduled appointments.
- [ ] Patient search returns results in < 1 second on the 3-patient demo set; pagination works.
- [ ] Patient CRUD works for all fields including nested addresses, coverages, emergency contacts, consents.
- [ ] Soft-delete works: deleted patient disappears from search; admin "include deleted" filter shows them; audit log shows deletion.
- [ ] Scheduling: clinician picks patient from `/home`, creates appointment, starts → auto-creates Encounter + Note in `PREPARING` → routes to `/prepare/[noteId]` (placeholder for now; Unit 03 builds it).
- [ ] Division resolves correctly: org default → episode override (if any) → note. Locked at recording start.
- [ ] Department enrollment lifecycle works (admit, transfer, discharge); intake form JSON validates against department schema.
- [ ] Audit log: every patient create / update / soft-delete / search / view / enrollment / intake — all PHI-free metadata (no names, MRNs, DOBs in metadata).
- [ ] `orgId` in WHERE clause of every patient/encounter/schedule query.
- [ ] 3-tap test on `/home`: clinician can start a new visit in ≤ 2 taps from landing.
- [ ] Three-lens evaluation: Clinician (patient search is fast; demographics inline editable), Compliance (PHI never leaks into audit metadata), Auditor (every PHI read logged with who/when/scope).
- [ ] `progress-tracker.md` updated.
