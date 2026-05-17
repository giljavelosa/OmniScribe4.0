# Admin (team / overview / management) — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/admin_overview_and_team_mockup.html` (476 lines); `design-mockups-2026-05/admin_team_responsive_v2.html` (332 lines); `design-mockups-2026-05/admin_team_desktop_and_ipad.html` (385 lines)
- **Production file(s):** `src/app/(admin)/users/page.tsx` (1410 lines); `src/app/(admin)/sites/page.tsx` (116 lines); `src/app/(admin)/seats/page.tsx` (639 lines); `src/app/(admin)/billing/page.tsx` (583 lines); `src/app/(admin)/voice/page.tsx` (425 lines); plus shell `src/app/(admin)/layout.tsx` (277 lines), IA `src/lib/admin-ia.ts` (98 lines)
- **Coverage estimate:** built ~75% / partial ~17% / missing ~8% (Team table/chip/touch baseline + overview KPI/activity/export are shipped; seats + voice table actions now have tablet touch-target bumps, KPI window/signature semantics are explicit, admin overview metric-semantics text is surfaced, and team rows now include tablet avatar/control rhythm bumps)
- **Top blocking issue:** Remaining deltas are mostly strict visual/data-fidelity polish (org switcher chrome + fine spacing rhythm); metric-governance detail is improved with explicit semantics + sample-size context.

## Mockup summary
- **`admin_overview_and_team_mockup.html`:** Treat as **canonical** for *intent*: (1) **Overview** frame with shell header, breadcrumbs, org switcher, four KPI tiles (active members, seats assigned, notes/month, time-to-sign), two-column body (recent activity + seat utilization + top users), **Export report**; (2) **Team** frame with stats rail, **status + role filter chips**, checkbox column, **single grid table** unifying members and invites, avatar initials, row actions (edit / overflow). sr-only line 1 states purpose explicitly.
- **`admin_team_responsive_v2.html`:** **Responsive exploration** — side-by-side Desktop 1440 vs iPad 1024; same IA sidebar labels; iPad **drops Site/Dept column** and folds into member column (lines 210–213, 48–49 CSS); **row icon buttons 22px desktop → 26px iPad** (lines 86–88).
- **`admin_team_desktop_and_ipad.html`:** **Alternative framing** (browser + iPad bezel); documents **larger touch targets on iPad** for primary button, search, chips, and **28×28px row icon buttons** vs 22px desktop (lines 62–65, 77–78, 124–125).

## Production summary
- **Shell:** `layout.tsx` renders fixed **"Administration"** title, mode pill, description, optional **Platform Owner support mode** banner, sidebar from `getAdminNavSections`, horizontal nav on small screens (`layout.tsx:136-277`).
- **IA:** overview route and nav slot are now present in admin flow.
- **Team (`/users`):** Table-first shell is shipped (search, status chips, role filter, metrics strip, unified members+invites rows, row action menu, seat management popover). Role + membership chips are tokenized through `<StatusBadge>`.
- **Sites:** Simple grid cards with counts (`sites/page.tsx:61-114`).
- **Seats / Billing:** Rich subscription summaries, tables/links (`seats/page.tsx`, `billing/page.tsx`) — overlap mockup *metrics conceptually* but not as Overview landing.
- **Voice:** Table roster + revoke dialog (`voice/page.tsx:136-284`).

## Element-by-element diff
| Area | Mockup | Production |
|------|--------|------------|
| **Header** | Per-page title row inside frame (Overview / Team), org dropdown in shell header (`admin_overview…:127-146, 251-260`) | Global **Administration** header; page H1 inside route only (`layout.tsx:204-216`); **no org switcher control** in chrome |
| **Body — Overview** | Four KPIs + activity list + utilization + top users (`admin_overview…:148-243`) | KPI strip + recent activity + seat utilization + top users + export report are shipped; 30-day window + signed-vs-created semantics are now explicit in API/export, with remaining visual ratio polish |
| **Body — Team** | One table; invites as rows; filters; bulk select; avatars (`admin_overview…:276-319`; `admin_team_responsive_v2…:141-173`) | Unified table + filter chips + row overflow actions + avatar-initial cells are shipped; control chips/search/invite and avatar rhythm now include tablet bumps, with remaining fine spacing-ratio polish |
| **Footer** | Caption labels under frames only | App shell **Back to Home** / exit owner link (`layout.tsx:183-199`) |
| **Interactions** | Icon row actions, Export, Manage links (`admin_overview…:174-175, 209`) | Overflow row actions + edit + seat popover + copy invite + overview export report are shipped |

## Copy diff
- Overview subtitle mockup: **"How the team is using OmniScribe this month"** (`admin_overview…:141`) vs production **"Team operations snapshot for the last 30 days."** — intent now aligned, wording differs.
- Team primary CTA: mockup **"+ Invite member"** (`admin_overview…:272`) vs production **"Invite Member"** with `Plus` icon (`users/page.tsx:652-654`).
- Team subtitle mockup matches production closely: mockup line 265 vs production **"Manage who belongs to the team and how each membership is set up."** (`users/page.tsx:618-619`).
- Nav label: mockup sidebar **"Team"** (`admin_team_responsive_v2.html:107`) now matches production nav label.
- Seats empty-state mentions **"OmniScribe"** in deactivate copy (`users/page.tsx:1120-1121`) — aligned with mockup branding, not a divergence.

## Token / styling diff
- Team role/membership pills now use tokenized `<StatusBadge>` variants.
- **Invite / error reds:** `text-red-600/70` (`users/page.tsx:669`); billing `text-red-600/80` (`billing/page.tsx:431`); seats revoke styling `text-red-600/60` (`seats/page.tsx:519`).
- Voice warning summary now uses `status-warning` tokens; no remaining hardcoded amber warning value in the summary stat card.
- **Arbitrary typography:** widespread `text-[Npx]` across admin pages (e.g. `users/page.tsx:615-619`) — matches lint critique in `01-quick-wins.md` acceptance criteria.
- Team seat popover now uses tokenized `bg-card` surface.
- Team table controls now include iPad touch-target bumps (checkboxes + overflow actions + key action buttons); further spacing polish still remains.

## Refactor recommendations
- **[src/app/(admin)/overview/page.tsx + src/app/api/admin/overview/route.ts]** [effort: **S**] [risk: **low**]: Continue metric-governance polish (if needed: percentile windows / naming) and align spacing/visual ratios to the mockup comp.
- **[src/app/(admin)/users/page.tsx]** [effort: **M**] [risk: **low**]: Continue parity polish on table density/avatars and iPad spacing now that the core table/chips/actions surface is shipped.
- **[src/lib/admin-ia.ts]** [effort: **XS**] [risk: **low**]: IA rename is now shipped (`Users & Invites` → `Team`).
- ~~**[src/app/(admin)/voice/page.tsx] [effort: **XS**] [risk: **low**]~~ **DONE**: warning summary now uses `status-warning` token classes; row actions now include tablet height bump (`md:h-11`) while preserving compact desktop sizing.
- ~~**[src/app/(admin)/seats/page.tsx] [effort: **S**] [risk: **low**]~~ **DONE**: Tablet pass now bumps row action buttons to `h-11` on `md` while preserving compact desktop `h-8`.

## Cross-reference to cursor-tasks/01-quick-wins.md
- **Task #4 (`StatusBadge`):** Team role/membership chips are now tokenized through `StatusBadge`.
- **Task #5 (touch targets):** Team list controls now include iPad touch-target bumps; seats/billing still need their own tablet pass where applicable.
- **Tasks #1–#3, #6–#7:** Clinical/admin-adjacent only; **no direct overlap** with these admin routes beyond general token hygiene.
- **Phase 2+ candidates:** Further **Overview fidelity** (metric semantics + export schema), **bulk actions** + selection column, **org switcher** in admin chrome for multi-org admins, and deeper sparkline/trend polish.

**iPad note:** Team now uses a dense table with larger control hit targets at tablet widths; remaining gaps are spacing rhythm and avatar/table visual ratios versus mockup.
