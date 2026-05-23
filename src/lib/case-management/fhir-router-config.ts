/**
 * Sprint 0.15 — Org-level FHIR-routing gate.
 *
 * Returns `true` iff the org has a verified FHIR connection (decision 9 in
 * the spec). Defaults ON when a connection is present; OFF otherwise. The
 * worker calls this once per run; on `false` it skips the FHIR-fetcher
 * entirely and the agent behaves exactly as Sprint 0.13 — backward
 * compatibility decision 10.
 *
 * "Verified connection" = at least one `OrgEhrConnection` row with
 * `enabled: true` for the org. The OAuth-token side (`FhirIdentity`) is
 * per-clinician and not used here — the worker doesn't act as a clinician.
 * Patient-level link verification (`PatientFhirIdentity.matchConfidence`)
 * happens inside the fetcher itself.
 *
 * Anti-regression rule 20: this gate doesn't read any clinical resource —
 * it only decides whether the FHIR plumbing is wired for the org. Even
 * `true` is necessary-but-not-sufficient: the fetcher still checks the
 * verified-patient-link before reading any cached Condition row.
 */

import { prisma } from '@/lib/prisma';

export async function isFhirRouterEnabled(orgId: string): Promise<boolean> {
  const count = await prisma.orgEhrConnection.count({
    where: { orgId, enabled: true },
  });
  return count > 0;
}
