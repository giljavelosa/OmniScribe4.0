import { type Page, expect, type Locator } from '@playwright/test';

/**
 * Page-object helpers — thin wrappers over the most common selectors
 * + interactions. Centralizing them here means a UI tweak (rename a
 * button label, restructure a card) breaks ONE selector instead of
 * spreading test failures across every spec that touched the surface.
 *
 * Selectors prefer accessible roles + names (the recommended
 * Playwright pattern) so tests are robust to className refactors.
 */

// ---------- Home ----------------------------------------------------

export class HomePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/home');
  }

  /** "Good morning, admin" / "Good evening, Maya" greeting headline. */
  greetingLocator(): Locator {
    return this.page.getByRole('heading', { name: /good (morning|afternoon|evening)/i });
  }

  /** The "Find a patient" search input on the cockpit. */
  searchInput(): Locator {
    return this.page.getByPlaceholder(/last name, first name, or mrn/i);
  }

  async searchPatient(query: string) {
    await this.searchInput().fill(query);
    await this.page.getByRole('button', { name: /^search$/i }).click();
    await this.page.waitForURL(/\/patients\?query=/);
  }
}

// ---------- Patients list ------------------------------------------

export class PatientsListPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/patients');
  }

  /** Find a patient row by full or partial name match. */
  patientRow(name: string): Locator {
    return this.page.getByRole('link', { name: new RegExp(name, 'i') }).first();
  }

  /** Click into the first matching patient. */
  async openPatient(name: string) {
    await this.patientRow(name).click();
    await this.page.waitForURL(/\/patients\/[a-z0-9]+$/);
  }
}

// ---------- Patient chart ------------------------------------------

export class PatientChartPage {
  constructor(private readonly page: Page) {}

  /** "John Alvarez" + MALE · 70y subheading at the top of the chart. */
  identityHeader(): Locator {
    return this.page.getByRole('heading', { level: 1 }).first();
  }

  /** Bottom-right "Start Encounter" / "Start visit" CTA on chart. */
  startVisitButton(): Locator {
    return this.page.getByRole('button', { name: /^start visit$/i });
  }

  /** The chevron next to "Start visit" that opens the late-entry menu. */
  startVisitMenuTrigger(): Locator {
    return this.page.getByRole('button', { name: /more visit options/i });
  }

  /** "Start late entry…" menu item reached via the chevron. */
  startLateEntryItem(): Locator {
    return this.page.getByRole('menuitem', { name: /start late entry/i });
  }
}

// ---------- Start-visit dialog -------------------------------------

export class StartVisitDialog {
  constructor(private readonly page: Page) {}

  /** Sheet root — visible after Start visit / Start late entry click. */
  root(): Locator {
    return this.page.getByRole('dialog').filter({
      hasText: /(start visit|start late entry)/i,
    });
  }

  /** "Visit date" input — present in the picker shell only. */
  visitDateInput(): Locator {
    return this.page.getByLabel(/visit date/i);
  }

  /** Site picker — only visible when the clinician has 2+ enrolled
   *  sites; for single-site users the picker hides + auto-applies. */
  sitePicker(): Locator {
    return this.page.getByLabel(/site/i);
  }

  /** Final submit button. Label changes to "Start late entry" when the
   *  picker is in late-entry mode; "Start visit" otherwise. */
  submitButton(): Locator {
    return this.page.getByRole('button', { name: /^(start visit|start late entry|starting…)$/i });
  }
}

// ---------- Prepare page -------------------------------------------

export class PreparePage {
  constructor(private readonly page: Page) {}

  /** "Recording status: PREPARING" disabled button when the note
   *  isn't yet in PREPARING (or the live mic CTA when it is). */
  recordingStatusBadge(): Locator {
    return this.page.locator('button', {
      hasText: /recording status:/i,
    });
  }

  /** "Record this visit" / "Tap to start recording" hero CTA. */
  liveCaptureButton(): Locator {
    return this.page.getByRole('button', {
      name: /tap to start recording|record this visit/i,
    });
  }

  /** Late-entry banner: "Care delivered <date> · documented <date>". */
  lateEntryBanner(): Locator {
    return this.page.locator('text=/care delivered/i').first();
  }
}

// ---------- Review page --------------------------------------------

export class ReviewPage {
  constructor(private readonly page: Page) {}

  /** The empty-transcript banner heading. Lives in
   *  empty-transcript-banner.tsx; verified in
   *  e2e/empty-transcript-recovery.spec.ts. */
  emptyTranscriptBannerHeading(): Locator {
    return this.page.getByRole('heading', {
      name: /didn['’]t capture any speech/i,
    });
  }

  emptyTranscriptReRecordButton(): Locator {
    return this.page.getByRole('button', { name: /^re-record$/i });
  }
}

// ---------- Generic helpers ----------------------------------------

/**
 * Wait for a `next/navigation` push() to complete by URL match.
 * Useful when triggering a transition that doesn't naturally settle
 * via Playwright's auto-wait (e.g. a router.push inside a
 * useTransition).
 */
export async function waitForUrl(page: Page, pattern: RegExp): Promise<void> {
  await page.waitForURL(pattern, { timeout: 15_000 });
}

/** AppNav header presence — proves the clinical layout mounted. */
export function appNav(page: Page): Locator {
  return page.getByRole('navigation').filter({ has: page.getByText(/^home$/i) });
}

/** Patient initials chip on the chart top-left. */
export function patientInitialsChip(page: Page): Locator {
  return page.locator('[aria-label*="patient initials"], .rounded-full').first();
}

/** Confirmation that the page is rendered, not a 404. */
export async function assertNotFound(page: Page, expectFound: boolean) {
  if (expectFound) {
    await expect(page).not.toHaveURL(/\/404$/);
  } else {
    await expect(page).toHaveURL(/\/(404|not-found)/);
  }
}
