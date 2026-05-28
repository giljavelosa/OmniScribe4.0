# Design Critique: OmniScribe / Genscribe

**Reviewed by:** Claude
**Date:** April 29, 2026
**Scope:** Whole web app — auth, clinical capture flow, drafts, processing, admin, landing, UI primitives
**Stage assumption:** Live product, mid-refinement (not exploration, not final polish)

> **A note on method:** This critique is based on reading the JSX/CSS source, not on rendered screenshots or live interaction. That means I can be precise about what's coded (typography scales, color tokens, structure, copy) but I'm inferring how it actually feels in a browser. For pixel-level visual judgments — kerning, true contrast, animation timing — pair this with a screenshot pass.

---

## Overall Impression

OmniScribe has a calm, deliberately clinical aesthetic — warm off-white, muted teal, generous whitespace — that fits "trustworthy medical software" much better than the typical SaaS-blue look. The capture screen's escalating empathy when processing takes longer ("This is taking a bit longer..." → "may be under heavy load") is a small, mature touch most products skip.

The biggest opportunity isn't a redesign — it's **systematization**. The product is designed page-by-page rather than from a tight system, so the same idea (a label, a status, a button) shows up in 3–4 slightly different forms across screens. Tightening the type scale, spacing scale, and label pattern would make the whole product feel ~30% more polished without changing a single layout.

**Plain-English version:** The product looks good. The problem is it's just slightly inconsistent across screens — like a house where every room is nice but the door handles are all from different sets. Fix the door handles and it instantly feels like one product.

---

## Critical Findings (Fix These First)

### 1. The product calls itself two different names

In `signup/page.tsx` and `register-form.tsx` the user sees **"OmniScribe workspace."** Everywhere else (folders, configs, internal copy) it's **Genscribe.** Whichever is the real name, the other should disappear. Brand inconsistency on the *first* screen a new customer sees is the single most damaging thing on this list — it reads as "unfinished" or "pivoting."

🔴 **Severity: Critical**
**Fix:** Pick the canonical name today. Search-and-replace across the repo. Add a single brand constant (`export const APP_NAME = "OmniScribe"`) so it can never drift again.

### 2. Goal status uses color as the only signal

In `PriorContextPanel`, "Active / Met / Carried" goals are distinguished only by background color (primary tint / emerald / sky). About 1 in 12 men have some form of color vision deficiency, and clinicians often work in bright/glare-heavy clinical environments where subtle hue differences disappear.

🔴 **Severity: Critical (accessibility + medical context)**
**Fix:** Add an icon to each pill — e.g., a dot for Active, a checkmark for Met, an arrow-loop for Carried. Color stays as reinforcement, not the only signal.

### 3. Status badges on the Drafts page use hardcoded Tailwind colors

`drafts/page.tsx` uses `bg-blue-100 text-blue-900`, `bg-amber-100 text-amber-900`, `bg-green-100 text-green-900`. These bypass the design tokens (`--primary`, `--destructive`, etc.) defined in `globals.css`, so:
- Dark mode will be wrong (these classes don't auto-adapt).
- Amber-100 + amber-900 is borderline for WCAG AA contrast and likely fails in some viewing conditions.
- Future palette changes won't propagate to the most important screen in the app.

🔴 **Severity: Critical**
**Fix:** Define `--status-info`, `--status-warning`, `--status-success` tokens and a `<StatusBadge variant="...">` component. Use it everywhere.

### 4. Error text at low opacity

The login page uses `text-red-600/70` for error messages. The /70 opacity drops contrast under the 4.5:1 WCAG AA floor on the warm off-white background. Users won't lose their account over it, but a clinician misreading a sign-in error costs them seconds they don't have.

🟡 **Severity: Moderate (definite a11y issue, easy fix)**
**Fix:** `text-destructive` (full opacity) or pair with a small alert icon. Run all error messages through a contrast checker.

### 5. Sheet-inside-sheet on the capture screen

`DocumentationSetupPanel` shows a compact summary while recording. Tapping "Edit setup" slides in a Sheet from the right that contains the full form, including selectors that themselves open dropdowns. On a tablet — which is what most clinicians use bedside — this becomes "modal containing modal containing modal," and the back/dismiss path gets muddy.

🟡 **Severity: Moderate**
**Fix:** During an active recording, allow inline edits to the most-changed fields (template, note style) rather than reopening the full form. Reserve the Sheet for pre-recording setup only.

---

## Usability

| Finding | Severity | Recommendation |
|---|---|---|
| Bottom tab bar disappears entirely on capture/processing/edit routes | 🟢 Minor | Intentional and probably correct (focus mode), but consider a subtle "Exit capture" affordance so users never feel trapped |
| `Start Draft` button is hidden (not disabled) when generation isn't allowed | 🟡 Moderate | Disable in place with a tooltip explaining why. A vanishing button is the #1 UX support ticket |
| Step numbering on the setup form is computed inline (`showDiscipline ? "3." : "2."`) | 🟢 Minor | Wrap in a `useStepNumbers()` hook so adding a field can't desync labels |
| Drafts list action buttons (Continue Setup / Resume / View / Review) aren't visually distinct as buttons | 🟡 Moderate | Use a single primary button per row, secondary actions in an overflow menu. Prevents the "is this a link?" hesitation |
| Patient name truncates with no tooltip on hover | 🟢 Minor | Add `title={fullName}` or a Radix tooltip. Long names are common (hyphenated, double surnames) |
| Delete confirmation has no loading state | 🟢 Minor | Disable the button and swap to a spinner; right now disabled-but-silent reads as "did my click register?" |
| Signing-PIN entry uses one long input with letter-spacing rather than discrete boxes | 🟢 Minor | Discrete per-digit boxes are the dominant pattern (Apple, Stripe, banks) for short codes. For the 4-digit signing PIN, four boxes lower friction and reduce mistakes |
| No "Forgot password" link on login | 🟡 Moderate | Add it. Required for a v1 auth surface |
| Polling interval (3s) on processing screen has no SSE / websocket fallback shown | 🟢 Minor (not strictly UX) | Worth noting because it shapes how "live" the UI feels |

---

## Visual Hierarchy

**What the eye lands on first**

- **Login** → Brand wordmark and the centered card. Correct.
- **Capture** → Patient name (20px) and the elapsed time (21px monospace). Correct — those are the two facts a clinician scanning between rooms cares about.
- **Drafts list** → The h1 "Drafts." Probably should be the first overdue/in-progress item; the title is informational and could be smaller, with the queue itself being the focal element.
- **Signup** → Hero headline competes with the right-rail signup form. On wide screens the form wins (sticky, framed); on smaller screens the hero wins. The product probably wants the form to win in both. Consider de-emphasizing the hero or using a single-column layout under 1280px.

**Type scale fragmentation**

In rendered components I count **at least 11 distinct font-sizes** in active use (11, 12, 13, 14, 15, 16, 20, 21, 24, 26, 28 px). That's roughly twice what a tight system needs. The 12px-vs-13px decision in particular is invisible to users but expensive to maintain — every new component has to re-litigate "is this a small label or a small body?"

🟡 **Recommendation:** Collapse to a 6-step scale: 12 / 13 / 15 / 17 / 21 / 28. Define them as `--text-xs`, `--text-sm`, `--text-base`, `--text-md`, `--text-lg`, `--text-xl`. Forbid raw `text-[14px]`-style classes via lint rule.

**Whitespace**

Generous and tasteful in most places. The exception is the Drafts list, which has `max-w-[800px]` on a wide screen and leaves big empty gutters. On a 27" monitor the queue feels lonely. Either widen the constraint to ~1100px or fill the gutters with a secondary panel (filters, today's metrics).

---

## Consistency

| Element | Issue | Recommendation |
|---|---|---|
| Form field labels | Some `text-[11px] uppercase tracking-[0.12em]`, some `text-[12px] uppercase tracking-[0.14em]`, some not uppercase at all | One Label component, one set of props. The micro-difference between 0.12em and 0.14em is a mistake, not a choice |
| Button vs. link styling | Some pages use `<Button>`, some use styled `<Link>`, some use raw `<button>` with inline Tailwind | All clickable text → Button or Link components only. Lint rule: no inline `<button class="...">` |
| Icon size & stroke-width | Mostly Lucide, but stroke-width and size vary inconsistently | Two icon sizes only: 14px for inline-with-text, 16px for buttons. One stroke-width (1.75) |
| Note style selector | Uses a custom popover with manual `mousedown` listener while the rest of the app uses Radix Select | Migrate to Radix Select. Custom popovers are where keyboard nav and screen-reader behavior quietly breaks |
| Border-radius | Cards use 26px and 22px in adjacent components on the signup page | Use the radius tokens (`--radius-md`, `--radius-lg`) only. The 4px difference reads as "someone copied this card and tweaked it" |
| Repeated metadata | Template + note-style pills appear in both `CaptureHeader` and `LiveNotePanel` | Show once. The capture header is the authoritative location |
| Recording label text | Same icon + text rendered in two places in the same screen | Single source. Probably belongs to a shared `<RecordingStatus>` component |

---

## Accessibility

I can flag what's evident from the JSX. A real audit needs a tool like axe-core run against the live app.

- **Color-as-only-signal:** Goal status pills, error text, status badges — all flagged above. Add icons.
- **Icon-only buttons:** Several places (advanced toggle in DocumentationSetupPanel, dropdown chevrons) — verify each has an `aria-label`. None of the JSX I read showed it explicitly, which usually means it's missing.
- **Contrast failures (likely):**
  - `text-red-600/70` on the login background.
  - `text-muted-foreground` at /40 or /45 opacity in metadata strips. Muted-foreground is already light; further opacity reduction probably crosses the WCAG line.
  - Hardcoded amber/blue/green badge colors on Drafts.
- **Form labels:** `NoteTypeSelector` and `TemplateSelector` triggers have visible styled "labels" but no semantic `<label htmlFor>`. Screen readers announce them as unlabeled comboboxes.
- **Touch targets:** `h-7` (28px) buttons appear in several places. WCAG AA recommends 44×44px. Inside a form on desktop this is fine; on a tablet at the bedside it's not.
- **Focus rings:** The button component has good `focus-visible:ring-3 ring-ring/50` defaults — credit where due.
- **Dark mode:** Tokens are defined but the hardcoded `blue-100 / amber-100 / green-100` badges will look broken in dark mode. Worth a 5-minute QA pass with the OS in dark mode.

---

## Copy

- "**Shaping from transcript**" — atmospheric but vague. Clinicians want to know *what* is happening. Consider "Drafting from the recording" or "Generating note from transcript."
- "**Edit setup**" (button) → opens a sheet titled "**Edit Note Setup**." Match them — both should say "Edit note setup" or both "Edit setup."
- "**Documentation setup**" — internal jargon. A clinician doesn't think of it as "documentation"; they think of it as "the note." Consider "Note settings" or "How this note will be written."
- "**Division**" / "**Discipline**" — these terms come from rehab/multi-specialty contexts. New users from a small clinic may not parse them. Either add an info-tooltip or reword to "Practice area" / "Specialty."
- LiveNotePanel empty state has 3+ sentences of instructional text. Cut to one sentence + one supporting line. Clinicians don't read paragraphs.
- "**Start free testing**" (top-nav CTA) — slightly unusual phrasing; "Start free trial" or "Try free" is the convention users pattern-match against.

---

## What Works Well

- The teal-on-warm-neutral palette feels intentionally clinical without being cold or hospital-sterile. This is rare and good.
- Escalating empathy on the processing screen ("taking a bit longer" → "under heavy load") is a small touch most products miss. Keep it.
- The bottom-tab active state animation (`translate-y` + glow) is tactile and gives the app a native-feeling rhythm on mobile.
- Adaptive setup form complexity — Discipline only appearing for multi-specialty divisions, Goals only for REHAB — is the right pattern. Smart defaults > more fields.
- Source-grouped template picker (My / Team / Presets / Community) maps to how clinicians actually think about templates. Good IA.
- Empty state on Drafts ("You're all caught up") with the soft check icon — properly motivating, not just informational.
- CVA-based button variants with multiple icon sizes is a solid foundation; the size sprawl is fixable.

---

## Priority Recommendations

1. **Pick one product name and purge the other this week.** "OmniScribe" vs. "Genscribe" appearing in the same flow is the single most damaging finding. Lowest-effort, highest-impact change in this entire critique.

2. **Build a `<StatusBadge>` and `<Label>` component, then ban the underlying patterns.** Status badges and form labels are the two places inconsistency is most visible. Replacing 100% of usages with two well-designed components will deliver visible polish improvements within a sprint.

3. **Run an accessibility pass on the four screens a clinician sees during one encounter** — Login, Drafts, Capture, Processing. Specifically: color-only signals, icon-only buttons, contrast on muted text, label associations on selects. This is the highest-stakes user (a doctor mid-shift, often on a tablet, often in poor light) and currently the least-defended.

4. **Collapse the type scale to 6 steps and the spacing scale to 4 steps.** Codify in `globals.css`. Add an ESLint rule banning arbitrary `text-[Npx]` and arbitrary spacing values. This is the single biggest "feels more polished" lever available and costs roughly one focused day of refactoring.

5. **Fix the sheet-inside-sheet pattern on the capture screen.** During an active recording the *only* thing a clinician should be able to do quickly is swap template or note style. Inline those two; keep the full setup behind a "More settings" link.

---

## What I Couldn't Assess Without Running The App

- True color contrast at rendered sizes (need rendered screenshots + a contrast tool).
- Animation timing and feel (the JSX hints at it but the perception is browser-rendered).
- Real keyboard navigation paths through the capture screen.
- Mobile responsive behavior at specific breakpoints — `CaptureHeader` doesn't have visible responsive classes, which is suspicious but not provable from source.
- The two main components I couldn't read in full (`OmniScribeAILanding` on the marketing page, `RegisterForm`'s rendered output) — both worth a separate look.

If you want, I can do a follow-up pass focused on any one of those (a11y, mobile, or just the capture screen end-to-end), or I can turn the priority list above into a tracked checklist you can work through.
