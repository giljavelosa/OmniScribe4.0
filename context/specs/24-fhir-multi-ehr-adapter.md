# Unit 24: FHIR — Multi-EHR Adapter Abstraction (F6)

## Goal

Wave 4 closing unit. Generalize the NextGen-specific paths so adding Epic / Cerner is a few hours' work, not a few days'. Per `references/fhir-integration-spec.md` F6 — "Generalize NextGen adapter to support Epic + Cerner; per-org EHR config; **multi-EHR org support (defer to later if low demand)**."

The deferral clause matters: this unit ships the SEAM, not the second-vendor wiring. When a customer signs that requires Epic, the adapter slots in via the vendor registry + a new env-var pair; the existing NextGen flow remains the canonical reference implementation.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Scope | Adapter seam + per-vendor metadata + schema for future per-org config. **No new active EHR wiring** (Epic / Cerner ship when there's a customer). |
| 2 | Vendor identifier | Short slug: `'nextgen' | 'epic' | 'cerner'`. Matches the strings already used for `FhirIdentity.ehrSystem` etc. so no migration. |
| 3 | OrgEhrConnection | Additive schema only — current flow stays env-driven (rule 14: client secrets in env / Secrets Manager, not DB-resident plaintext). When per-org config lands in a future unit, this table is where encrypted credentials live. |
| 4 | Vendor-specific quirks | Patient identifier system OIDs (NextGen uses code 'MR'; Epic uses system='urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0'; Cerner uses 'MRN' code). Extracted into a vendor adapter so the brief + identity matching + sync paths don't fork. |
| 5 | UI | Admin's `/admin/integrations/fhir` gets a "Supported EHRs" reference panel — 3-row table with status chip per vendor (Active / Planned). The existing NextGen card stays where it is. |

## Design

### Vendor registry

`src/services/fhir/vendor-registry.ts`:

```typescript
export type EhrVendor = 'nextgen' | 'epic' | 'cerner';

export type VendorMetadata = {
  id: EhrVendor;
  displayName: string;
  /** OID or code system used by this vendor's MRN identifier. Falls back
   *  to the FHIR R4 'MR' type-code when not set. */
  mrnIdentifierSystem?: string;
  /** Whether the vendor's adapter is wired in v1 (Active) or laid out
   *  but not connected (Planned — env-vars + DB-config land when there's
   *  a customer). */
  status: 'active' | 'planned';
  /** Surfaced in the admin UI as the "to enable" footnote. */
  enablementNote: string;
};

export const EHR_VENDORS: VendorMetadata[] = [
  {
    id: 'nextgen',
    displayName: 'NextGen',
    status: 'active',
    enablementNote: 'Set FHIR_NEXTGEN_CLIENT_ID / _SECRET / _REDIRECT_URI in env.',
  },
  {
    id: 'epic',
    displayName: 'Epic',
    mrnIdentifierSystem: 'urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0',
    status: 'planned',
    enablementNote: 'Adapter ready; client credentials need a per-customer Epic app.',
  },
  {
    id: 'cerner',
    displayName: 'Cerner',
    mrnIdentifierSystem: 'urn:oid:2.16.840.1.113883.6.1000',
    status: 'planned',
    enablementNote: 'Adapter ready; client credentials need a per-customer Cerner app.',
  },
];

export function getVendor(id: string): VendorMetadata | undefined { ... }
```

### Vendor-aware patient adapter

The Patient adapter (Unit 21) currently extracts MRN by FHIR-R4 code matching:
`identifier.find(i => i.type?.coding?.some(c => c.code === 'MR'))`.

That works for NextGen. Epic + Cerner use `identifier.system` OIDs to label the MRN slot. Update `adaptPatient` to take an optional vendor parameter and prefer the vendor's `mrnIdentifierSystem` match first, falling back to the 'MR' code match.

```typescript
function adaptPatient(r: FhirResource, vendor?: VendorMetadata): SimplifiedPatient
```

Callers that don't pass `vendor` get the existing code-match behavior (NextGen-compatible). When the adapter dispatcher is called from a sync orchestrator that knows the ehrSystem, it passes the vendor through.

### OrgEhrConnection schema (additive)

```prisma
model OrgEhrConnection {
  id            String   @id @default(cuid())
  orgId         String
  organization  Organization @relation(fields: [orgId], references: [id])
  ehrSystem     String   // matches EhrVendor type
  displayName   String
  fhirBaseUrl   String
  /** AES-256-GCM-encrypted client secret (reuses Unit 19's token-crypto
   *  envelope). Stored encrypted at rest per anti-regression rule 14. */
  clientIdEnc   String   @db.Text
  clientSecretEnc String @db.Text
  redirectUri   String
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([orgId, ehrSystem])
  @@index([orgId])
}
```

Schema only — no API or worker reads from this table in F6. When a future unit wires per-org config, it'll plug in via a `loadOrgEhrConnection(orgId, ehrSystem)` helper that falls back to env vars when no row exists.

### Admin UI

`/admin/integrations/fhir` gains a "Supported EHRs" panel below the existing NextGen card:

```
SUPPORTED EHRs
┌─────────────────────────────────────────────────────────────┐
│ NextGen        ✓ Active     Use the launcher above.        │
├─────────────────────────────────────────────────────────────┤
│ Epic           ⏳ Planned    Adapter ready; needs a per-... │
├─────────────────────────────────────────────────────────────┤
│ Cerner         ⏳ Planned    Adapter ready; needs a per-... │
└─────────────────────────────────────────────────────────────┘
```

Just a reference panel for v1 — no "Add Epic connection" button yet (the OrgEhrConnection-driven flow lands when there's a paying customer).

### Audit actions

Two added now so the schema + future flow are wired:

- `ORG_EHR_CONNECTION_CREATED` — admin adds a per-org EHR config (future flow).
- `ORG_EHR_CONNECTION_REMOVED` — admin removes one.

No emitters in F6; the audit names are reserved + locked at the union so future PRs don't need a separate schema change.

## Implementation order

1. Spec + 2 audit actions (this commit)
2. Vendor registry + vendor-aware patient adapter + tests
3. OrgEhrConnection schema + migration (no callers yet)
4. Admin UI "Supported EHRs" panel
5. Tracker + PR #25

## Out of scope (F6 / future)

- Epic adapter wiring (env-vars + per-org config + onboarding flow). Ships when a customer signs.
- Cerner adapter wiring (same).
- Per-org credential management UI (add/edit/rotate/disable). Ships with the first per-org connection.
- Multi-EHR-per-org support (one patient mapping to two EHRs simultaneously). Per the reference spec §13: "v2 conversation."
- Vendor-specific search parameter handling (Epic's encounter context binding, Cerner's procedure code variants). Land per-vendor when wiring that vendor.

## Verify when done

- `EHR_VENDORS` registry exports 3 entries — NextGen 'active', Epic + Cerner 'planned'.
- `adaptPatient` with `vendor: getVendor('epic')` prefers identifier.system match over code match.
- `OrgEhrConnection` migration applied; no rows in seed.
- `/admin/integrations/fhir` shows the 3-row Supported EHRs panel.
- All existing FHIR flows (Units 19–23) continue to work unchanged.
- progress-tracker.md updated; PR #25 stacked on Unit 23. Wave 4 COMPLETE.
