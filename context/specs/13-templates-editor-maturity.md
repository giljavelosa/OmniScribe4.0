# Unit 13: Templates Editor Maturity

## Goal

Unit 05 shipped the `NoteTemplate` model + 4 seeded presets and the ai-generation worker that consumes them. Unit 13 ships the authoring surface that lets org admins manage their own templates: live section preview (instead of raw JSON), visibility UX (PERSONAL / TEAM / PUBLIC), specialty/org defaults, copy/clone with version history, sensitivityDefault picker.

## Design

All UI under `/admin/templates`. Preset templates (orgId null, isPreset=true) are read-only — clinicians clone them to make their own variant. Org-scoped templates (orgId=current org) are editable by admins.

### Surfaces

- `/admin/templates` — list (org + visible presets) with create + clone actions
- `/admin/templates/[id]` — editor: name / description / division / specialty / visibility / sensitivityDefault + section editor with live preview + clone-from-version action

### Visibility semantics

- `PERSONAL` — visible only to the creator (filtered by `createdByOrgUserId`)
- `TEAM` — visible to the whole org
- `PUBLIC` — platform-wide visible (owner-only writes for now; reads cross-org)

For Unit 13, the simpler interpretation: PERSONAL + TEAM both live under `/admin/templates`; PUBLIC is owner-only and surfaces as read-only "platform presets" entries (seeded set).

### Version history (copy/clone)

Cloning creates a new row with `version: 1` and `clonedFromId` pointing at the source template. Editing an existing template bumps `version` in-place (we don't archive prior versions in v1 — the `clonedFromId` chain is the version trail).

## Implementation

### A. Audit actions

- `TEMPLATE_CREATED`
- `TEMPLATE_UPDATED`
- `TEMPLATE_CLONED`
- `TEMPLATE_ARCHIVED`
- `TEMPLATE_UNARCHIVED`

### B. Schema additions

- `NoteTemplate.clonedFromId String?` — points at the source template when this row was cloned. Drives the version-history surface.
- `NoteTemplate.isArchived Boolean @default(false)` + `archivedAt DateTime?` — soft-delete pattern (rule 7-ish for clinical data; archived templates don't surface in the picker but the row stays for note historical reference).
- `NoteTemplate.createdByOrgUserId String?` — already exists; now actually written.

### C. APIs

- `GET /api/admin/templates?division=...&includeArchived=...` — list templates org-scoped (org templates + platform presets visible to this org).
- `GET /api/admin/templates/[id]` — single template + clonedFrom chain.
- `POST /api/admin/templates` — create new (with sections).
- `POST /api/admin/templates/[id]/clone` — clone source → new row with version 1 + clonedFromId set.
- `PATCH /api/admin/templates/[id]` — update name / description / division / specialty / visibility / sensitivityDefault / sectionSchema / promptHints. Bumps `version` when sectionSchema changes.
- `POST /api/admin/templates/[id]/archive` (`{ action: 'archive' | 'unarchive' }`) — soft-delete + restore.

Presets (isPreset=true, orgId=null) are READ-ONLY for everyone except platform owner — admin PATCH / archive return 403 with code `preset_readonly`.

### D. UI

- `/admin/templates` — list with division filter + visibility chip + clone action; row tap → editor
- `/admin/templates/[id]` — editor with:
  - Header: name (editable) + visibility select + division + specialty + sensitivityDefault picker + Archive button
  - Sections editor: ordered list of sections; each section has label / id / required toggle / promptHint; add/remove/reorder
  - Live preview pane: renders the section list exactly as `SectionAccordion` would on `/review` — text-only preview, not interactive
- Clone action (anywhere) → modal with new-name input + visibility picker → POST /clone → router.push to the new row

## Verify when done

- Schema migration applied (clonedFromId, isArchived, archivedAt).
- Admins can list / create / edit / clone / archive their own templates.
- Preset templates surface as read-only entries in the list.
- Editing sectionSchema bumps `version`.
- Cloning creates a new row with `version: 1` + `clonedFromId` pointing at the source.
- Live preview reflects sectionSchema edits in real time.
- 5 new audit actions wired (TEMPLATE_CREATED / _UPDATED / _CLONED / _ARCHIVED / _UNARCHIVED).
- progress-tracker.md updated.
