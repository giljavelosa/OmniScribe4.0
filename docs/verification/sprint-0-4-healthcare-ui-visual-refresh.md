# Sprint 0.4 — Healthcare Visual Refresh Verification

> Date: 2026-05-20

---

## What changed

| File | Change |
|------|--------|
| `src/app/globals.css` | `--background` → soft aqua `oklch(0.97 0.020 185)`; `--primary` → blue-teal `oklch(0.44 0.11 185)`; `--ring` + `--accent` hue updated to match; `.dark` primary hue matched |
| `src/app/(clinical)/patients/page.tsx` | Prisma query extended with `site` + `episodes`; `ageInYears` helper added; mobile card redesign (age/sex — no DOB, site, status badge, Open chart + Start note buttons); desktop registry table in `<Card>` with shadow; improved empty state; filter pill bar updated |
| `src/app/(clinical)/home/page.tsx` | Mobile status tiles wrapped in `bg-card shadow-sm rounded-xl` so they pop off the aqua background |

---

## Color token changes

| Token | Before | After | Why |
|-------|--------|-------|-----|
| `--background` | `oklch(0.985 0.002 90)` warm off-white | `oklch(0.97 0.020 185)` soft aqua | Healthcare/clinical feel; cards pop off the aqua base |
| `--primary` | `oklch(0.44 0.08 167)` deep muted green-teal | `oklch(0.44 0.11 185)` vibrant blue-teal | Matches design reference direction; same L = same white-text contrast (~5:1 WCAG AA) |
| `--ring` | hue 167 | hue 185 | Focus rings match new primary |
| `--accent` | `oklch(0.96 0.015 167)` | `oklch(0.96 0.020 185)` | Accent tint now matches background hue for visual harmony |
| `.dark --primary` | hue 167 | hue 185 | Dark mode consistency |

---

## Viewport notes

### 430px mobile

**`/home`:**
- Soft aqua page background visible below the teal header/greeting strip
- Status tiles now in a white rounded card with subtle shadow — pops against aqua
- Scheduling cards, draft rows, follow-up rows benefit from white-on-aqua contrast
- Bottom nav: teal primary color is now the updated blue-teal

**`/patients`:**
- No table — single-column card list
- Each card: initials avatar + name + `{age}y {sex} · MRN {mrn}` (no full DOB) + last visit + site name + Active/No active care badge + `[Open chart]` `[Start note]` buttons
- Empty state: rounded white card with descriptive message
- Filter pills: My sites | All | Recent (disabled) | Active (disabled)

### 1024px+ desktop

**`/patients`:**
- Patient registry table inside a `<Card>` (rounded-xl, shadow-sm)
- Columns: Patient (avatar + linked name) | Age / Sex | MRN | Last visit | Site | Status
- Full DOB not shown on desktop either — age/sex only
- Hover: `hover:bg-muted/20` row highlight

---

## Commands run

```bash
npx tsc --noEmit
# Exit 0 — 0 type errors

npx vitest run
# 65 test files pass, 3 files with 14 pre-existing failures (unchanged from before Sprint 0.4)
# pre-existing: seat-gate mock issues in encounters/schedule-start tests
```

---

## PHI compliance

- Full DOB removed from both mobile cards and desktop table — shows `{age}y {sex}` only
- No new PHI in console logs, localStorage, URL params, or client-side debugging
- Site name and episode status are non-PHI operational data shown to the authenticated clinician

---

## Remaining risks

1. **"Recent" and "Active" filter pills are visual-only** — they show `cursor-not-allowed` and a tooltip. Real filter logic (by last-visit recency or has-active-episodes) needs a future sprint.

2. **"Start note" button goes to `/patients/[id]`** — same destination as "Open chart". A direct encounter-start shortcut requires the episode picker UX which lives on the patient detail page. Future sprint can deep-link to a pre-selected episode.

3. **Background color affects all pages** — the `--background` token is global. Admin, owner, ops, and auth pages now show the soft aqua background. This is intentional (consistent healthcare aesthetic) but may need per-layout overrides if a more neutral background is preferred for admin surfaces.

4. **`--primary` hue shift** — the header, bottom nav, buttons, focus rings, and status-pill backgrounds all reflect the new blue-teal. Visual QA on all clinical surfaces is recommended.

5. **Patient `site` relation requires patient to have `siteId` set** — patients created before the `siteId` requirement was enforced may have `site: null`. The card and table both handle this with `p.site?.name ?? '—'`.
