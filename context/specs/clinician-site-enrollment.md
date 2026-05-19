# Clinician Site Enrollment — Spec

**Status:** approved 2026-05-18 (live walkthrough). Implementation: background agent after episode-picker PR lands.

## Problem

OmniScribe today models clinicians at the organization level (`OrgUser`) and sites under organizations (`Site`), but has **no link between the two**. Consequences:

- A clinician implicitly "works at" every site in their org. No way to express "Dr. Smith works at the downtown clinic and the eastside clinic but not the north tower."
- `SITE_ADMIN` role exists but cannot be scoped to specific sites — anyone with SITE_ADMIN can admin all sites in the org.
- Scheduling has no site-eligibility check — you can schedule any clinician at any site whether they actually work there or not.
- Audit + dashboard views can't be cleanly site-scoped for site admins.

Multi-site enrollment is **standard of care** in modern healthcare orgs. CMS/Medicare expects one NPI ↔ many CCNs (the rendering location's facility number). PRN/per-diem/locum clinicians routinely span 3+ sites. A single-site clinician is the exception, not the rule.

## Goals

1. Model explicit clinician ↔ site enrollment without breaking existing org-wide roles (`ORG_ADMIN`, `SUPER_ADMIN`, `PLATFORM_OWNER`).
2. Enforce SITE_ADMIN scope to assigned sites.
3. Soft-validate scheduling against enrollment (warn, don't hard-block — exceptions like cross-coverage happen).
4. Give clinicians a "my sites" filter on schedule + patient list.
5. Audit + dashboard surfaces honor site scope where appropriate.

## Non-goals (v1)

- Per-site credential metadata beyond a free-text notes field (e.g., "OR privileges", "DEA on file" — these belong in a richer credentialing module later).
- Per-site role overrides (a clinician's role + division is org-wide; site is just a work location).
- Integration with CMS NPI / CCN registries.
- Cross-org enrollment (a User who works at two separate orgs already gets two `OrgUser` rows).

## Schema

```prisma
model OrgUserSite {
  id              String   @id @default(cuid())
  orgUserId       String
  orgUser         OrgUser  @relation(fields: [orgUserId], references: [id], onDelete: Cascade)
  siteId          String
  site            Site     @relation(fields: [siteId], references: [id])
  /** True for the clinician's primary/home site. UI defaults (schedule
   *  "My sites" filter, patient creation default siteId) use this. */
  isPrimary       Boolean  @default(false)
  /** Free-text scope notes — "OR privileges", "evening shift only",
   *  "supervision required". Surfaced in admin UI; not enforced. */
  credentialNotes String?
  enrolledAt      DateTime @default(now())
  enrolledByOrgUserId String?
  enrolledBy      OrgUser? @relation("OrgUserSiteEnroller", fields: [enrolledByOrgUserId], references: [id])

  @@unique([orgUserId, siteId])
  @@index([siteId])
}
```

Add back-relations on `OrgUser` and `Site`. Migration is append-only (rule 1).

### Virtual "all-sites" convention

Org-wide roles (`ORG_ADMIN`, `SUPER_ADMIN`, `PLATFORM_OWNER`, `PLATFORM_OPS`) implicitly cover every site in scope. They do NOT need `OrgUserSite` rows — the authz layer treats them as "all sites" automatically. This avoids forcing org admins to enroll at every site.

Codified in `src/lib/authz/site-scope.ts` (new):

```ts
export async function getClinicianSiteIds(
  orgUserId: string,
  orgId: string,
): Promise<{ scope: 'all' | 'enrolled'; siteIds: string[] }> {
  // Look up role. If ORG_ADMIN+, return scope: 'all' with all org site IDs.
  // Else return scope: 'enrolled' with OrgUserSite[].siteId list.
}

export function isAllSites(scope: { scope: string }): scope is { scope: 'all'; siteIds: string[] } {
  return scope.scope === 'all';
}
```

## Endpoints

### `POST /api/admin/users/[id]/sites`

Body: `{ siteIds: string[], primarySiteId?: string }`. Replaces the clinician's site enrollment with the given list. Gated `requireFeatureAccess('TEAM_MEMBERS_MANAGE')`. Audits `CLINICIAN_SITES_UPDATED` with `{ before: string[], after: string[], primary: string | null }` (PHI-free; only IDs).

### `GET /api/admin/users/[id]/sites`

Returns the clinician's current enrollment. Same gate.

### Enforcement edits

- `POST /api/encounters` — if caller is a clinician (not ORG_ADMIN+) and provides `siteId` not in their enrollment, return 400 `site_not_enrolled` with a hint message. ORG_ADMIN+ bypass.
- `POST /api/schedules` — same check.
- `POST /api/schedules/[id]/start` — same check (use schedule.siteId).
- `GET /api/schedules?scope=mine` — filter to enrolled sites for clinician callers.
- `GET /api/patients?scope=mine-sites` — filter patients whose `siteId` is in caller's enrollment (clinician scope only).

### SITE_ADMIN scoping

- `(admin)/admin/users/page.tsx`, `(admin)/admin/sites/page.tsx`, etc.: when caller's role is `SITE_ADMIN`, show only users/sites the caller is enrolled at. ORG_ADMIN+ see everything.

## UI

### Admin user detail (existing `/admin/users` row → drawer or detail page)

New "Site enrollment" section:
- Multi-select of org sites with primary radio
- Free-text "Credential notes" per site (collapsible)
- Save → POST to `/api/admin/users/[id]/sites`

### Clinician onboarding wizard

After password + authenticator setup, NEW STEP: "Where do you work?" — checkbox list of sites (preselected if invite carried site hints). Required to pick at least one (unless invited as ORG_ADMIN+).

### Home dashboard

"My sites" pill row at the top of the schedule card. Default to "all my sites." Clicking a site filters the schedule to that site.

### Patient list

New filter chip: "My sites only" (defaults on for clinician roles, off for admins).

### Schedule + Visit creation flows

The episode picker (PR shipped just before this one) gains a site picker IF the caller has 2+ enrollments. If exactly 1 enrollment, auto-pick. Org-wide-admin actors see all sites.

## Audit additions

Add to `src/lib/audit/actions.ts`:
- `CLINICIAN_SITES_UPDATED`
- `SCHEDULE_SITE_MISMATCH_WARNED` (when a clinician schedules at a non-enrolled site and the system warns but proceeds — useful for compliance review)

## Verification

- [ ] Migration applies cleanly to fresh DB
- [ ] Seed: pre-enroll `clinician@demo.local` at the demo site (primary); pre-enroll `siteadmin@demo.local` at the demo site only
- [ ] Browser: as `admin@demo.local`, edit `clinician@demo.local` → assign to demo site as primary → save → enrollment visible
- [ ] Browser: as `clinician@demo.local`, /home shows "My sites" pill; schedule filtered
- [ ] Browser: as `siteadmin@demo.local`, /admin/users shows only users enrolled at the same site
- [ ] API: clinician POST /api/encounters with non-enrolled siteId → 400 site_not_enrolled
- [ ] API: ORG_ADMIN POST /api/encounters with any siteId → 200 (bypass)
- [ ] CI green
- [ ] Three-lens evaluation in PR description (Clinician / Compliance / Auditor)

## Out of scope (later)

- Cross-org enrollment (User exists in two Orgs — already supported by separate OrgUser rows)
- Site credential workflow (track DEA, OR privileges with expiry dates)
- Hard-block scheduling instead of warn (per-org policy toggle)
- Tax-ID / billing-entity mapping per site (billing module work)
- Pendo / analytics tracking of site enrollment changes
