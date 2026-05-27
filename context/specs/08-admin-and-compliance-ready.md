# Unit 08: Admin & Compliance Ready

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


## Goal

Close the commercial-readiness gates: BAA tracking UI (schema already in Unit 01), Sites + Rooms CRUD, full admin user management surfaces (already covered by Unit 01 in API/auth shape — this unit completes the UI), and audit log enrichment for important mutations. After this unit, OmniScribe can be sold to and run for a first paying customer.

## Design

All surfaces are admin- or owner-only. Standard admin/owner layout from `ui-context.md`.

- **`/owner/orgs`** — list with BAA status column (`✓ executed` success badge / `⚠ pending` warning badge)
- **`/owner/orgs/new`** — provisioning sheet with BAA fields **required** (form refuses submit without them)
- **`/owner/orgs/[id]`** — org detail with BAA section editable, seat allocation, subscription view, impersonation control
- **`/admin/users`** — full user CRUD with row actions (Edit, Reset MFA, Send password reset, Deactivate)
- **`/admin/sites`** — site list with "+ Add Site"; per-site detail page with nested Rooms CRUD
- **`/admin/audit`** — audit log table with filters, search, CSV export
- **`/admin/org-settings`** — force MFA, default note style, default templates per division, voice enrollment policy, audit retention, communication preferences

Read [`journeys/07-admin-onboards-a-clinic.md`](../../journeys/07-admin-onboards-a-clinic.md) for the end-to-end flow this unit enables. Read [`references/audit-admin-state-of-play.md`](../../references/audit-admin-state-of-play.md) for the canonical commercial-readiness audit.

## Implementation

### A. Owner: Org BAA UI

`src/app/(owner)/owner/orgs/[id]/page.tsx` — already exists from Unit 09 as a placeholder. Extend with `<BaaSection>` component:

```tsx
function BaaSection({ org }: { org: Organization }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>BAA & Compliance</CardTitle>
        <CardDescription>Business Associate Agreement status</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateBaaAction}>
          <FormField label="BAA Executed Date" name="baaExecutedAt" type="date" defaultValue={org.baaExecutedAt} required />
          <FormField label="BAA Version" name="baaVersion" defaultValue={org.baaVersion} required placeholder="e.g. 2026-Q2-v3" />
          <FormField label="Compliance Profile" name="complianceProfile" type="select" options={['STANDARD', 'BH_42CFR2', 'RESEARCH']} defaultValue={org.complianceProfile} required />
          <FormField label="Countersigned By" value={org.baaCountersignedBy || '(auto-set to current owner on save)'} readOnly />
          <Button type="submit">Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

The action handler updates `Organization`, sets `baaCountersignedBy` to current owner's userId, writes `PlatformAuditLog` entry `BAA_UPDATED` with field changes.

### B. Owner: Org list BAA column

`src/app/(owner)/owner/orgs/page.tsx`:

```tsx
<Table>
  <TableHead>
    <TableRow>
      <TableHeader>Name</TableHeader>
      <TableHeader>Division</TableHeader>
      <TableHeader>BAA</TableHeader>
      <TableHeader>Seats</TableHeader>
      <TableHeader>Last Active</TableHeader>
    </TableRow>
  </TableHead>
  <TableBody>
    {orgs.map(org => (
      <TableRow key={org.id}>
        <TableCell>{org.name}</TableCell>
        <TableCell>{org.division}</TableCell>
        <TableCell>
          {org.baaExecutedAt
            ? <StatusBadge variant="success">✓ executed {formatDate(org.baaExecutedAt)}</StatusBadge>
            : <StatusBadge variant="warning">⚠ pending</StatusBadge>}
        </TableCell>
        <TableCell>{org.seatCount}</TableCell>
        <TableCell>{org.lastActiveAt}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

Filter by BAA status; sort by `baaExecutedAt`.

### C. Owner: Org provisioning form

`src/app/(owner)/owner/orgs/new/page.tsx` — sheet form requires BAA fields:

```tsx
<form action={provisionOrgAction}>
  <FormField label="Organization Name" name="name" required />
  <FormField label="Primary Division" name="division" type="select" options={['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI']} required />
  <FormField label="Primary Contact Name" name="contactName" required />
  <FormField label="Primary Contact Email" name="contactEmail" type="email" required />
  <FormField label="Billing Email" name="billingEmail" type="email" required />
  
  <Separator />
  <h3>BAA Execution (required)</h3>
  <FormField label="BAA Executed Date" name="baaExecutedAt" type="date" required />
  <FormField label="BAA Version" name="baaVersion" required placeholder="2026-Q2-v3" />
  <FormField label="Compliance Profile" name="complianceProfile" type="select" options={['STANDARD', 'BH_42CFR2', 'RESEARCH']} required />
  
  <Button type="submit">Provision Organization</Button>
</form>
```

Action handler:
1. Create Stripe customer (atomic with org creation; rollback if Stripe fails)
2. Create Org with BAA fields populated
3. Seed default templates per division (CMS presets)
4. Generate first SUPER_ADMIN invite + send email
5. Write `PlatformAuditLog` entry `ORG_PROVISIONED`
6. Redirect to `/owner/orgs/[id]`

### D. Admin: MFA reset

(API endpoint already in Unit 01 §E.) UI: in `/admin/users` row dropdown:

```tsx
<DropdownMenuItem onSelect={() => setShowMfaResetDialog(true)}>Reset MFA</DropdownMenuItem>

<AlertDialog open={showMfaResetDialog} onOpenChange={setShowMfaResetDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Reset MFA for {user.name}?</AlertDialogTitle>
      <AlertDialogDescription>
        The user will lose access to their current MFA device and must enroll a new one on next sign-in. All current sessions will be invalidated.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <FormField label="Reason for reset" name="reason" type="textarea" required placeholder="e.g. 'User reported lost phone'" />
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={confirmMfaReset}>Reset MFA</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### E. Admin: Sites CRUD

`src/app/(admin)/admin/sites/page.tsx` — list of sites with "+ Add Site" sheet.

`src/app/(admin)/admin/sites/[id]/page.tsx` — site detail with nested Rooms CRUD.

API routes:
- `GET /api/admin/sites` — list (gated to org admin or site admin for own site)
- `POST /api/admin/sites` — create
- `PATCH /api/admin/sites/[id]` — update
- `POST /api/admin/sites/[id]/archive` — soft-delete (sets `isArchived = true`)
- `POST /api/admin/sites/[id]/unarchive` — restore
- `GET /api/admin/sites/[id]/rooms`
- `POST /api/admin/sites/[id]/rooms` — create
- `PATCH /api/admin/rooms/[id]` — update
- `POST /api/admin/rooms/[id]/archive`

All audited.

### F. Admin: audit log surface

`src/app/(admin)/admin/audit/page.tsx`:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Audit Log</CardTitle>
    <CardDescription>All actions in {org.name}</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="flex gap-2 mb-4">
      <DateRangePicker />
      <Select label="Actor" options={actors} />
      <Select label="Action" options={actionTypes} />
      <Input placeholder="Search by resource ID…" />
      <Button onClick={exportCsv}>Export CSV</Button>
    </div>
    <Table>
      <TableHead>
        <TableRow>
          <TableHeader>Time</TableHeader>
          <TableHeader>Actor</TableHeader>
          <TableHeader>Action</TableHeader>
          <TableHeader>Resource</TableHeader>
          <TableHeader>Metadata</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {logs.map(log => (
          <TableRow key={log.id}>
            <TableCell>{log.createdAt}</TableCell>
            <TableCell>{log.userEmail}</TableCell>
            <TableCell>{log.action}</TableCell>
            <TableCell>{log.resourceType}:{log.resourceId}</TableCell>
            <TableCell><code>{JSON.stringify(log.metadata)}</code></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </CardContent>
</Card>
```

Audit `AUDIT_LOG_VIEWED` (yes — we audit the audit log being viewed) and `AUDIT_LOG_EXPORTED`.

### G. Admin: Org settings

`src/app/(admin)/admin/org-settings/page.tsx` — form for:
- Force MFA (boolean)
- Default note style (NoteStyle enum)
- Default templates per division (rule: when patient division X + status Y, use template Z)
- Voice enrollment policy ('encourage' / 'required' / 'disabled')
- Audit retention years (default 7)
- Communication preferences (Twilio config, Resend config)
- Feature flags (key-value)

Action handler writes `ORG_SETTINGS_UPDATED` audit with field-name list (no PHI; field values may need redaction depending on field).

### H. Audit log enrichment

For these mutations, capture `before` and `after` fields in `AuditLog.metadata`:
- Sign (`NOTE_SIGNED`): before = note status (DRAFT → SIGNED), follow-up sweep decisions
- BAA updated (`BAA_UPDATED`): before/after field values
- MFA reset (`MFA_RESET`): before = mfaEnabled true, reason
- Role changes (`USER_ROLE_CHANGED`): before/after role
- Sensitivity tier changed (`NOTE_SENSITIVITY_CHANGED`): before/after tier

Only the fields that changed, NOT full record dumps. PHI-free.

### I. Invite expiration verification

Already implemented in Unit 01 §G. This unit adds a test:

```ts
it('rejects expired invites with 410 Gone', async () => {
  const invite = await prisma.invite.create({ data: { ..., expiresAt: new Date(Date.now() - 1000) } });
  const res = await POST(`/api/onboarding/${invite.token}/password`, { newPassword: 'Demo1234!' });
  expect(res.status).toBe(410);
  expect(await res.json()).toMatchObject({ error: { code: 'invite_expired' } });
});
```

### J. Customer self-onboarding wizard

Implemented in Unit 01 §F. This unit verifies:
- Wizard is resumable if interrupted (state recoverable from `Invite.consumedAt` + `User.mfaEnabled`)
- Audit log captures every step (`ONBOARDING_OPENED`, `USER_CREATED`, `MFA_ENROLLED`, `ONBOARDING_COMPLETED`)
- Wizard works on iPad + iPhone + desktop (manual cross-device test)

### K. Stripe integration for seat allocation

`POST /api/admin/seats` (org admin scope):
- Creates `Seat` rows
- Creates / updates Stripe subscription with new seat count
- Atomically (transaction); rollback on Stripe failure

UI: `/admin/seats` page with allocation form + utilization view (rest of seats surface lives in Unit 09 owner console).

## Dependencies

- `stripe@21.x` (already)
- Resend (already)
- `papaparse@5.x` for CSV export (small dep)

## Verify when done

- [ ] `Organization` schema has BAA fields (from Unit 01); migration applied; demo org backfilled.
- [ ] Platform owner can populate BAA fields on `/owner/orgs/[id]`; `baaCountersignedBy` auto-set to owner; PlatformAuditLog `BAA_UPDATED` entry created.
- [ ] Owner Org list shows BAA-status column; filterable by status.
- [ ] Owner provisioning form rejects submission without BAA fields populated.
- [ ] Admin can reset a user's MFA: AlertDialog with reason → email sent → sessions invalidated → user re-enrolls on next sign-in → audit entry exists.
- [ ] Admin can send password reset email: user receives link → resets → audit exists.
- [ ] Sites CRUD works (create, edit, archive, restore); only org admin can mutate.
- [ ] Rooms CRUD works nested under Sites.
- [ ] Customer self-onboarding wizard completes end-to-end on staging.
- [ ] Expired invite tokens return 410 Gone; test covers this.
- [ ] All admin/owner routes audit-log every mutation with PHI-free metadata.
- [ ] Audit log enrichment: Sign, MFA reset, BAA acceptance, role changes, sensitivity tier changes capture before/after in metadata.
- [ ] Admin audit log surface works (search, filter, CSV export).
- [ ] Org settings page saves correctly; settings drive correct downstream behavior (force-MFA blocks sign-in until enrolled; default templates apply on `/prepare`).
- [ ] Stripe integration: seat allocation reflects in subscription; provisioning is atomic with Stripe customer creation.
- [ ] `npm run build` + `npm run lint` pass.
- [ ] Three-lens evaluation: Clinician (onboarding wizard is friendly), Compliance (BAA tracking + MFA reset + audit enrichment satisfies HIPAA business-associate posture), Auditor (every admin action reconstructable from `AuditLog` + `PlatformAuditLog`).
- [ ] `progress-tracker.md` updated; commercial-readiness blockers from `references/audit-admin-state-of-play.md` now closed.
