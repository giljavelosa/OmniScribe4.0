-- CreateEnum
CREATE TYPE "PatientSex" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PatientAddressKind" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "PatientCoverageStatus" AS ENUM ('ACTIVE', 'TERMINATED', 'PENDING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PatientConsentStatus" AS ENUM ('GIVEN', 'DECLINED', 'PENDING', 'REVOKED');

-- CreateEnum
CREATE TYPE "PatientDepartmentEnrollmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED', 'WAITLIST');

-- CreateEnum
CREATE TYPE "PatientDepartmentIntakeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('IN_PERSON', 'TELEHEALTH');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('ACTIVE', 'RECERT_DUE', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'MET', 'NOT_MET', 'MODIFIED', 'DISCONTINUED', 'PARTIALLY_MET');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('STG', 'LTG');

-- CreateEnum
CREATE TYPE "NoteSensitivityLevel" AS ENUM ('STANDARD_CLINICAL', 'BEHAVIORAL_HEALTH', 'BILLING_ONLY', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('PREPARING');

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "siteId" TEXT,
    "division" "Division" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "sex" "PatientSex" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "preferredLanguage" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAddress" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" "PatientAddressKind" NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',

    CONSTRAINT "PatientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCoverage" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "planName" TEXT,
    "memberId" TEXT NOT NULL,
    "groupId" TEXT,
    "status" "PatientCoverageStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),

    CONSTRAINT "PatientCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientEmergencyContact" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "PatientEmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientGuarantor" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,

    CONSTRAINT "PatientGuarantor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "status" "PatientConsentStatus" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCommunicationPreference" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL,

    CONSTRAINT "PatientCommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "division" "Division" NOT NULL,
    "intakeFormSchema" JSONB,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientDepartmentEnrollment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "status" "PatientDepartmentEnrollmentStatus" NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PatientDepartmentEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientDepartmentIntake" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "status" "PatientDepartmentIntakeStatus" NOT NULL,
    "sensitivityLevel" "NoteSensitivityLevel" NOT NULL DEFAULT 'STANDARD_CLINICAL',
    "formData" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PatientDepartmentIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianOrgUserId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "roomId" TEXT,
    "visitType" "VisitType" NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "clinicianOrgUserId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "roomId" TEXT,
    "departmentId" TEXT,
    "episodeOfCareId" TEXT,
    "status" "EncounterStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeOfCare" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianOrgUserId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "division" "Division" NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "bodyPart" TEXT,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "recertDueAt" TIMESTAMP(3),
    "visitsAuthorized" INTEGER,
    "visitsCompleted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EpisodeOfCare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeGoal" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "goalType" "GoalType" NOT NULL,
    "goalText" TEXT NOT NULL,
    "baselineMeasure" TEXT,
    "targetMeasure" TEXT,
    "currentMeasure" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "originNoteId" TEXT,
    "resolvedNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalProgressEntry" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "measureValue" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "clinicianOrgUserId" TEXT NOT NULL,
    "division" "Division" NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'PREPARING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_orgId_lastName_firstName_idx" ON "Patient"("orgId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Patient_orgId_isDeleted_idx" ON "Patient"("orgId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_orgId_mrn_key" ON "Patient"("orgId", "mrn");

-- CreateIndex
CREATE INDEX "PatientAddress_patientId_idx" ON "PatientAddress"("patientId");

-- CreateIndex
CREATE INDEX "PatientCoverage_patientId_idx" ON "PatientCoverage"("patientId");

-- CreateIndex
CREATE INDEX "PatientEmergencyContact_patientId_idx" ON "PatientEmergencyContact"("patientId");

-- CreateIndex
CREATE INDEX "PatientGuarantor_patientId_idx" ON "PatientGuarantor"("patientId");

-- CreateIndex
CREATE INDEX "PatientConsent_patientId_idx" ON "PatientConsent"("patientId");

-- CreateIndex
CREATE INDEX "PatientCommunicationPreference_patientId_idx" ON "PatientCommunicationPreference"("patientId");

-- CreateIndex
CREATE INDEX "Department_orgId_idx" ON "Department"("orgId");

-- CreateIndex
CREATE INDEX "PatientDepartmentEnrollment_patientId_idx" ON "PatientDepartmentEnrollment"("patientId");

-- CreateIndex
CREATE INDEX "PatientDepartmentEnrollment_departmentId_status_idx" ON "PatientDepartmentEnrollment"("departmentId", "status");

-- CreateIndex
CREATE INDEX "PatientDepartmentIntake_patientId_idx" ON "PatientDepartmentIntake"("patientId");

-- CreateIndex
CREATE INDEX "PatientDepartmentIntake_departmentId_status_idx" ON "PatientDepartmentIntake"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Schedule_clinicianOrgUserId_scheduledStart_idx" ON "Schedule"("clinicianOrgUserId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Schedule_orgId_scheduledStart_idx" ON "Schedule"("orgId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_scheduleId_key" ON "Encounter"("scheduleId");

-- CreateIndex
CREATE INDEX "Encounter_patientId_startedAt_idx" ON "Encounter"("patientId", "startedAt");

-- CreateIndex
CREATE INDEX "EpisodeOfCare_patientId_status_idx" ON "EpisodeOfCare"("patientId", "status");

-- CreateIndex
CREATE INDEX "Note_orgId_status_idx" ON "Note"("orgId", "status");

-- CreateIndex
CREATE INDEX "Note_patientId_createdAt_idx" ON "Note"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAddress" ADD CONSTRAINT "PatientAddress_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCoverage" ADD CONSTRAINT "PatientCoverage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGuarantor" ADD CONSTRAINT "PatientGuarantor_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommunicationPreference" ADD CONSTRAINT "PatientCommunicationPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDepartmentEnrollment" ADD CONSTRAINT "PatientDepartmentEnrollment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDepartmentEnrollment" ADD CONSTRAINT "PatientDepartmentEnrollment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDepartmentIntake" ADD CONSTRAINT "PatientDepartmentIntake_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDepartmentIntake" ADD CONSTRAINT "PatientDepartmentIntake_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_episodeOfCareId_fkey" FOREIGN KEY ("episodeOfCareId") REFERENCES "EpisodeOfCare"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeOfCare" ADD CONSTRAINT "EpisodeOfCare_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeOfCare" ADD CONSTRAINT "EpisodeOfCare_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeGoal" ADD CONSTRAINT "EpisodeGoal_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "EpisodeOfCare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalProgressEntry" ADD CONSTRAINT "GoalProgressEntry_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "EpisodeGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
