# Templates + Documentation defaults — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/template_edit_full_page_mockup.html` (243 lines); `design-mockups-2026-05/documentation_defaults_redesign.html` (219 lines)
- **Production file(s):** `src/app/(clinical)/templates/page.tsx` (632); `src/app/(clinical)/templates/[id]/edit/page.tsx` (46); `src/app/(clinical)/templates/[id]/edit/editor-client.tsx` (393); `src/app/(clinical)/templates/new/page.tsx` (244); `src/app/(admin)/manage-templates/page.tsx` (353); `src/app/(admin)/manage-templates/[id]/page.tsx` (529); `src/app/(admin)/documentation/page.tsx` (89); `src/app/(admin)/_components/org-documentation-settings.tsx` (197); `src/components/templates/section-editor.tsx` (243); `src/components/templates/section-accordion-item.tsx` (300); `src/components/templates/bucket-section.tsx` (131); `src/components/templates/bucket-section-picker.tsx` (242)
- **Coverage estimate:** template editor mockup — built ~72% / partial ~15% / missing ~13%; documentation defaults mockup — built ~67% / partial ~25% / missing ~8% (live preview + analytics + editable per-division controls + breakdown drill-down + owner metadata depth + explicit saved-state chip shipped)
- **Top blocking issue:** Remaining template-editor work is now mostly deeper live-preview realism and final visual/token polish; server-backed preview generation is now wired with cache/debounce and clearer authoring guidance.

## Mockup summary

**`template_full_page_mockup.html`** (lines 1–3, 78–241): Full-bleed "frame" on `--color-background-secondary`; header with back control, breadcrumb-style title ("Templates / …"), **inline title affordance**, **meta line** ("Preset · Medical · 4 sections · Used in 142 notes / mo"), **saved state** ("Saved 2 min ago"), **Discard** + **Save & close** (primary `#0F6E56`). **Tabs:** Structure (active), AI guidance, Preview, Settings — mockup body only renders Structure grid + embedded preview. **Structure:** two columns (1.05fr / 1fr); left = collapsible **buckets** (caret, UPPER label, section count, **Rename**); inside buckets, **drag grip**, section row with **mini-tags** (Paragraph/Bullet, Required), remove "✕", "+ Add section", dashed "+ Add bucket". **Expanded section:** primary field "AI guidance — what should the AI write here?" with helper hint; **Format** and **Length** toggle groups; footer row "▸ Advanced (Type · Required · CMS)" + "Delete section". **Right:** "Live preview", "Sample transcript ▾", rendered doc with section headers, bullets/table-like vitals in narrative, dashed footnote. **Tokens:** CSS variables (`--color-*`, `--primary`, `--border-radius-*`, `--font-sans`) plus hardcoded brand green and `rgba(15, 110, 86, …)` for focus/required chips (e.g. lines 19, 24, 40, 46, 59). **Ergonomics callouts:** drag affordance (grip), bucket rename/add, **transcript-driven preview** dropdown, tabbed separation of Structure vs AI vs Preview vs Settings.

**`documentation_defaults_redesign.html`** (lines 1–2, 80–217): Page title **"Documentation defaults"**, subtitle naming org ("OmniScribe Demo Org") and clinician override disclaimer. **Left column sections:** (1) **Default note style** — 2×2 **card grid** (Narrative, Hybrid, Hybrid bullet, Structured) with icon, radio dot, title, description; "● Saved" chip. (2) **Quantitative data** — row with icon, **Structured measures** copy, iOS-style **pill switch**. (3) **Per-division overrides** — card with **Medical / Rehab / Behavioral** pills (distinct colors `#3B6D11`, `#534AB7`, etc.) and per-row **Edit**. (4) **Override visibility** — "3 of 12 clinicians…", **progress bar**, explanatory copy, "View override breakdown →". **Right column:** "Live preview" + **pill** showing active style; sample note with **table grid** for vitals; dashed footer. **Accessibility summary** (line 1) also mentions **signing requirements** and **late-note threshold**, but those controls **do not appear** in the static HTML — treat as product intent beyond what's drawn.

## Production summary

**Clinician templates (`(clinical)/templates/`)** — List page (`page.tsx`): "My Templates", tabs Personal / Team / Community, cards with `DIVISION_COLORS` badges (`72–77`, `283–291`), actions share/clone/delete; no mockup-style analytics. **New** (`new/page.tsx`): Division + optional/required profession by division (`47–47`, `155–180`), **note format cards** from `getFormatsForDivision` (`203–237`), and starter sections seeded from division/profession defaults (avoids blank-editor dead-end). **Edit** (`[id]/edit/page.tsx`): loads API then mounts `TemplateEditorClient`. **Full-page editor** (`editor-client.tsx`): sticky header with back, **inline name `Input`**, division `Badge` + profession, Cancel + Save; tabbed workspace (`Structure` / `AI guidance` / `Preview` / `Settings`), format-aware buckets via `getBucketsForFormat`, transcript/sample selector on preview (`general` / `rehab` / `complex`) with division-adaptive labels, action-oriented empty-state CTA back to Structure, visible preview feedback affordance (now including division + selected sample context in copied payloads), debounced server-backed preview calls, and division-aware local fallback preview content when generation errors occur. **API:** `/api/templates/[id]/preview` now generates section text via the shared LLM abstraction and `buildLivePreviewSystemPrompt`, with template visibility checks, short-lived cache, and division-aware transcript variants for preview realism.

**Admin manage-templates** — Index (`manage-templates/page.tsx`): compact "Note Templates", division filter, presets/custom tabs, **modal `SectionEditor`** for section edits (`253–259`); list links to `[id]` and opens dialog editor. **Important:** `SectionEditor` hard-groups by fixed `BUCKET_ORDER` (`section-editor.tsx:201-221`), **not** `getBucketsForFormat` — behavioral gap vs clinical full-page editor for non-SOAP formats. **Detail** (`[id]/page.tsx`): read-only **zones** (identity, Intended Use, Section Structure, Output Behavior with note-style grid + heuristic "AI Behavioral Rules", Sample Preview via `ClinicalContent` + `getSampleContent`) — **richer compliance-oriented readout** than the mockup's editor; actions jump to `?edit=` or duplicate (`496–525`).

**Org documentation** — `documentation/page.tsx`: title now **"Documentation defaults"** with defaults/override-aware subtitle, **`OrgDocumentationSettings`**, plus cards linking to templates and follow-up controls. **`org-documentation-settings.tsx`** now renders a two-column defaults surface with:
- style cards + structured-measures switch (persisted via PATCH),
- **per-division override visibility rows** (real counts by division),
- **live preview panel** with style pill and structured-measures rendering,
- **override visibility analytics** sourced from `GET /api/org/settings` (`overrideVisibility` payload).
Editable per-division override controls are still roadmap-scoped.

**Shared primitives (`src/components/templates/`)** — `SectionEditor`: **dialog**, template name field, buckets from `BUCKET_ORDER`, save/cancel (`184–241`). `BucketSection`: collapsible header when `onToggleBucket` provided (`52–74`); "Add block" opens `BucketSectionPicker`; labels "blocks" not "sections" (`70–72`, `110`). `SectionAccordionItem`: **GripVertical** shown but **reorder via chevrons** only (`103`, `157–172`); **AI Prompt Hint** tucked under **Advanced** (`219–284`), inverse of mockup's primary "AI guidance" placement. `BucketSectionPicker`: catalog search, profession-suggested groups (`218–224`), multi-select add.

## Element-by-element diff

**Header**
| Mockup (templates) | Production |
| --- | --- |
| Round back control + breadcrumb prefix "Templates /" | Clinician: `ArrowLeft` (`editor-client.tsx:191-196`); list uses normal app chrome |
| Meta: preset, division, section count, **usage/mo** | Editor: division badge + profession only (`205–217`); **no** preset line, **no** usage |
| **Saved timestamp**, Discard, Save & close | **No** autosave indicator; Cancel + "Save Template" (`224–235`) |
| Tabs: Structure / AI guidance / Preview / Settings | Present in clinician full-page editor (`editor-client.tsx`) |

**Body (templates)**
| Mockup | Production |
| --- | --- |
| Bucket **Rename** link | Implemented in clinical editor (`bucket-section.tsx` + `editor-client.tsx`) with local display-label override |
| **+ Add bucket** | Not in full-page editor — buckets come from format config only |
| Section row **mini-tags** (Paragraph, Required) | Collapsed row: text summary "Bullet · Standard · Required" (`section-accordion-item.tsx:87-108`) |
| **AI guidance** first in expanded editor | **Advanced** disclosure; hint textarea below Type/Required/CMS (`231–284`) |
| **Drag grip** for reorder | Grip + **ChevronUp/Down** swap (`103`, `157–172`) — not DnD |
| Right: **Sample transcript** dropdown | Present (`general` / `rehab` / `complex` sample selector) with server-backed output + fallback |

**Body (documentation defaults)**
| Mockup | Production |
| --- | --- |
| H1 + org name in subtitle | "Documentation defaults" with defaults/override subtitle; org name displayed in override visibility copy |
| 2×2 **style cards** + saved dot | Full-width **list** of options; saving shows "Saving..." text only (`117–119`) |
| **Per-division overrides** card | Present with editable per-division style + measures controls (persisted via `configOverrides.documentationDivisionOverrides`) |
| **Override visibility** analytics | Present via real `overrideVisibility` API payload |
| Right **live preview** with style pill | Present in `OrgDocumentationSettings` |

**Footer / secondary**
| Mockup | Production |
| --- | --- |
| Template: dashed preview footnote | Editor preview has section blocks + separator rows; no transcript disclaimer (`296–328`) |
| Doc defaults: footer on preview | N/A — no preview panel |

**Interactions**
- Mockup **Discard** / unsaved state: no dirty-tracking in `editor-client.tsx` (Cancel navigates away without confirm beyond router).
- Mockup **tabs** imply separate AI/Settings surfaces; production bundles CMS/Required/Type under **Advanced** accordion.
- Admin **SectionEditor** dialog vs mockup **full workspace** — different mental model for same task.
- **API reality:** org settings support only two fields in this UI path (`org-documentation-settings.tsx:97-105`); per-division defaults in mockup would need schema + API + analytics.

## Copy diff

- Page title: mockup **"Documentation defaults"** (`documentation_defaults_redesign.html:83`) vs production **"Documentation"** (`documentation/page.tsx:33-35`).
- Subtitle: mockup names org and "starting point" (`documentation_defaults_redesign.html:84`) vs production mode-specific one-liner (`documentation/page.tsx:36-39`).
- Preview column: mockup **"Live preview"** + **"Sample transcript ▾"** (`template_edit...:214-216`) vs **"Note Preview"** + section count (`editor-client.tsx:286-292`).
- Style labels: mockup **"Hybrid bullet"** / **"Structured"** (`documentation_defaults...:116-126`) vs rehab list uses **"Hybrid Prose"**, **"Bullet"** for structured (`org-documentation-settings.tsx:46-60`) — same enums, different **surface copy**.
- Blocks: **"Add section"** (mockup `129`, `195`) vs **"Add block to {label}"** (`bucket-section.tsx:110`).
- Primary save: **"Save & close"** vs **"Save Template"** (`editor-client.tsx:230-234`).
- Meta line: mockup **"Used in 142 notes / mo"** — **no equivalent string** in production template surfaces.
- Mockup preview foot: **"Generated from a sample 26-min…"** (`template_edit...:238`) vs editor fallback **"[label] content will be generated…"** (`editor-client.tsx:390-391`).

## Token / styling diff

- **Mockup** explicitly hardcodes brand green: `.te-btn-pri { background: #0F6E56 }` (`template_edit...:19`); `.te-mini-tag.req` / toggles use `rgba(15, 110, 86,…)` (`46–47`, `59`); doc mockup pills `#0F6E56`, `#3B6D11`, `#534AB7` (`50–51`, `68`).
- **Task #4 division object (canonical cite):** `manage-templates/page.tsx:291-296` (`divisionColors`); duplicated in `manage-templates/[id]/page.tsx:67-73`, `clinical/templates/page.tsx:72-77`, `editor-client.tsx:179-184` — all `bg-blue-50`, `bg-green-50`, `bg-purple-50` Tailwind, not `StatusBadge` tokens.
- **Accent / danger scatter:** e.g. `Trash2` `text-red-500` (`clinical/templates/page.tsx:336`); `section-accordion-item.tsx:176-177, 228` `red-400`/`red-600`; share dialog `text-blue-600` / `text-green-600` (`371–382` clinical templates).
- **Inconsistent sizing:** clinical list title `text-[28px]` (`templates/page.tsx:163`) vs admin manage-templates `text-lg` (`manage-templates/page.tsx:156`); documentation page matches admin compact header (`documentation/page.tsx:33`).
- **Missing design tokens:** mockups rely on `--color-border-tertiary`, `--primary-soft`, etc.; production uses `border-border/50`, `bg-card`, `primary/5` — convergent intent, **not** the same token names as mock CSS.

## Refactor recommendations

1. **[org-documentation-settings.tsx + documentation/page.tsx] [L] [med]** — Add right-column **live preview** wired to `defaultNoteStyle` + `defaultStructuredMeasures`, matching mockup doc layout; may reuse patterns from `manage-templates/[id]/page.tsx` sample preview (`465–491`) or `ClinicalContent`.
2. ~~**[org-documentation-settings.tsx] [S] [med]**~~ **DONE (metadata depth)** — Override breakdown now includes override-type mix (style-only / measures-only / both) and recent override-owner names; remaining work is visual parity polish for controls.
3. ~~**[section-editor.tsx + manage-templates/page.tsx] [M] [med]**~~ **DONE** — admin modal editor now derives buckets from `getBucketsForFormat(template.noteFormat)` instead of fixed `BUCKET_ORDER`, reducing format drift across admin/clinical editors.
4. ~~**[section-accordion-item.tsx + editor-client.tsx] [M] [low]**~~ **DONE (section editor)** — `SectionAccordionItem` now promotes AI guidance above the fold; Advanced remains focused on Type/Required/CMS controls.
5. ~~**[editor-client.tsx] [S] [low]**~~ **DONE (header state cues)** — Header now includes preset/custom + section-count meta, explicit unsaved/saved status copy, discard confirmation for dirty exits, and 30-day signed-usage metadata when available.
6. ~~**[editor-client.tsx or new component] [M] [med]**~~ **PARTIAL (server-backed v1+)** — transcript/sample selector now drives a debounced server-backed preview endpoint (`/api/templates/[id]/preview`) with cache + grounding prompt reuse + division-aware sample variants (`medical` / `rehab` / `behavioral health`); remaining lift is final visual parity and optional encounter-library depth.
7. ~~**[bucket-section.tsx] [S] [low]**~~ **PARTIAL (rename shipped)** — Bucket rename is now available in the clinical editor; optional **add bucket** remains product-dependent.
8. ~~**[editor-client.tsx] [M] [med]**~~ **DONE (autosave resilience v1)** — editor autosaves valid dirty state on debounce, retries failed autosave requests, and surfaces explicit fallback guidance (`Autosave failed... use Save Template now`) while preserving manual save.
9. ~~**[bucket-section.tsx + editors] [M] [med]**~~ **DONE (drag/drop reorder)** — sections can now be reordered via drag-and-drop within each bucket (while keeping chevron move controls as fallback).

**Phase 0 components:** `StatusBadge` exists with CSS variables (`status-badge.tsx:11-19`); division rows in mockup use custom pills — candidates to map to `StatusBadge` variants after Task #4 migration.

## Cross-reference to `cursor-tasks/01-quick-wins.md`

- **Task #4** — Direct hit: `manage-templates/page.tsx:291-296` and `[id]/page.tsx:67-73` called out in quick-wins (`01-quick-wins.md:92-93`); same pattern in `clinical/templates/page.tsx:72-77`, `editor-client.tsx:179-184`.
- **Task #5** — `manage-templates/page.tsx` icon `Button` ghost `size="sm"` (`333–345`) — quick-wins notes `h-8` desktop OK, tablet bump (`01-quick-wins.md:114-116`).
- **Task #1–#3, #6–#7** — Not central to these screens; no emoji CTA on templates path.
- **Phase 2+ candidates** — Tabbed template editor (Structure / AI / Preview / Settings); documentation **signing** + **late-note threshold** (mockup sr-only line 1 only); **clinician override analytics**; **DnD** section reorder; **org-named** subtitle in documentation header; **autosave** pipeline.

## Special considerations (division + compliance)

- **Division-aware UX:** Clinician **new template** forces profession for Rehab/BH (`templates/new/page.tsx:47-48, 176-179`) — aligns with `.cursorrules` discipline split. **Editor** surfaces division as badge (`editor-client.tsx:205-212`) but **does not** surface discipline-specific **documentation rubric** copy in the chrome (only catalog hints via picker descriptions). **Admin dialog `SectionEditor`** uses fixed SOAP buckets (`section-editor.tsx:201-221`) — risk for **behavioral** or **rehab** structural templates vs clinical full-page editor.
- **Medicare / skilled care:** Mockup's vitals AI hint is **transcript-grounded** ("omit if not mentioned") (`template_edit...:158-160`) — matches safety rules conceptually. Production buries **`aiPromptHint`** under Advanced (`section-accordion-item.tsx:273-282`), which **discourages** clinicians/admins from authoring compliance-critical guidance. Conversely, **admin template detail** infers rules like "Transcript-grounded", "ICD-10", "Structured measures" from hint text (`manage-templates/[id]/page.tsx:94-155`) — strong **read** surface, weak **write** surface vs mockup. Neither mockup nor editor **explicitly** prompts "skilled justification" or "medical necessity" wording; that remains prompt/catalog responsibility, not UI.
