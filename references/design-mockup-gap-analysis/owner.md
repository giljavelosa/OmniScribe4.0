# Owner console — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/owner_console_redesign.html` (361 lines)
- **Production file(s):** `src/app/owner/page.tsx` (600 lines); shell `src/app/owner/layout.tsx` (137 lines)
- **Coverage estimate:** built ~78% / partial ~14% / missing ~8% — platform multi-org support, filterable table, KPI strip, sparkline-style activity, and CSV export are now shipped; MRR/trial semantics are explicitly annotated and table rows now include avatar-initial rhythm + row-level MRR estimate-source + billing-linkage disclosure, with Stripe-backed MRR path now preferred when linked subscription data is available.
- **Top blocking issue:** Remaining gaps are now mostly final visual fidelity polish (table density/ratios) plus edge-case billing coverage where Stripe linkage is incomplete.

## Mockup summary
- Single-frame **Owner Console → Organizations** with shell breadcrumb, **Platform Owner** pill, **Exit to home** (`owner_console_redesign.html:95-105`).
- **Five top metrics:** active orgs, **MRR**, **trials ending**, **support backlog**, **total seats sold** with trends (`112–137`).
- **Filter chips:** Plan (All/Team/Solo/Trial) + Health (`140–154`).
- **Table:** accent bar + columns **Organization, Plan, MRR, Seats (bar), Activity 30d (sparkline), Status, Open →** (`156–165`, row example `167–203`).
- sr-only line 1: explicitly **filterable table**, **sparkline**, **Enter as admin**.

## Production summary
- **`layout.tsx`:** Server-auth **`PLATFORM_OWNER`** gate (`42–51`); sidebar anchors to `#organizations`, `#support`, `#commercial`, `#platform` (`8–29`, `66–80`); header **Owner Console** + **Platform Owner** (`104–116`).
- **`page.tsx`:** Fetches `/api/owner/organizations`; supports plan/health filters, KPI strip, searchable organizations **table** with MRR/seat/activity/status columns, sparkline bars, and CSV export; keeps explicit `enterOrganization` guarded flow.

**Verdict:** **`src/app/owner/page.tsx` is a real, data-backed console — not a stub.**

## Element-by-element diff
| | Mockup | Production |
|--|--------|------------|
| **Header** | In-frame breadcrumb **Owner Console / Organizations** + back (`95–105`) | **`layout.tsx`** global header + **Exit to home** (`95–116`); page has **no duplicate breadcrumb row** inside main |
| **Body — metrics** | **5-column** row incl. **MRR**, trials, backlog (`112–137`) | KPI strip includes Active orgs, reportable MRR, trials ending, backlog, and seats sold; API now provides explicit 30d windows + metric semantics text and prefers Stripe subscription-item MRR when available |
| **Body — org list** | **One sortable/filterable table** with sparkline + MRR + seat bar (`156–204`) | Filterable table with MRR, seat bars, activity sparkline bars, status chips, row avatar initials, and open action is shipped; CSV now carries explicit 30-day window columns + MRR estimate source + billing-linkage fields |
| **Footer** | — | Shell **Exit to home** (`layout.tsx:83-91`) |
| **Interactions** | **Open →** per row (`201–203`) | Enter-admin action and CSV export are shipped; support-flow coupling remains product-policy dependent |

## Copy diff
- Mockup page title **"Organizations"** with subtitle **"12 tenants · 2 trials ending…"** (`107–109`) vs production **"Platform-safe tenant support"** and operational subtitle copy; intent is aligned, wording differs.
- Primary row CTA mockup **"Open →"** (`202`) vs production **"Enter Admin Context"** (`487–488`) / **"Open Support"** (`405–406`).
- Production emphasizes **PHI separation** and **explicit enter** language (`262–265`, `423–425`) — stronger compliance framing than mockup's commercial ops tone.

## Token / styling diff
- Mockup uses CSS vars `--color-*`, `--primary`, accent greens/purples (`owner_console_redesign.html:1-91`); production relies on **Tailwind + existing borders** `border-border/60`, `bg-card` (`owner/page.tsx:251, 312, 457`).
- Production **`OwnerDetail`** uses heavy uppercase tracking (`594–596`) — aligned with admin detail pattern; mockup table headers use similar caps (`39`).
- No hardcoded **`bg-blue-100`**-style rows on owner page — badges use **`StatusBadge`** + muted **`Badge`** (`515–541`).

## Refactor recommendations
- ~~**[src/app/owner/page.tsx + API] [effort: **M**] [risk: **med**]~~ **DONE (source-of-truth path with fallback)**: reportable MRR now prefers Stripe subscription-item data when linked; heuristic seat-tier fallback remains for partially linked/unlinked orgs.
- **[src/app/owner/page.tsx]** [effort: **S**] [risk: **low**]: Continue visual parity polish (column spacing, action density, table rhythm, badge hierarchy).
- **[src/app/owner/page.tsx + API]** [effort: **S**] [risk: **low**]: Extend export schema/trend windows for downstream ops workflows.
- ~~**[src/app/owner/layout.tsx] [effort: **XS**] [risk: **low**]~~ **DONE**: header back action copy now matches mockup wording (`Exit to home`).

## Cross-reference to cursor-tasks/01-quick-wins.md
- **Task #4:** Owner page already favors **`StatusBadge`** (`518–534`); minor **`Badge`** secondary use (`465–467`, `537–539`) — low priority vs clinical pages listed in `01-quick-wins.md`.
- **Task #5:** Owner buttons use **`size="sm"`** (`392–408`, `474–490`) — audit if Owner Console is used on **tablet** (same guidance as admin).
- **Tasks #1–#3, #6–#7:** Not applicable here.
- **Phase 2+ candidates:** **Revenue/trial source-of-truth wiring**, **support ticketing integration**, and deeper trend analytics. Table/filter/export baseline now exists in the owner surface.

**Multi-org UX:** Production **`filteredOrganizations`**, **`enterOrganization`**, and support-mode entry from admin (`layout.tsx:184-244` in admin) **do reflect platform-level, multi-tenant visibility** — this matches `.cursorrules` owner intent better than a single-org admin view; the gap is **presentation density and commercial KPIs**, not core routing.
