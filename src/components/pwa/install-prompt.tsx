'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * InstallPrompt — Unit 36.
 *
 * Listens for `beforeinstallprompt` + surfaces a small CTA. On user
 * acceptance, fires the platform prompt + posts the outcome to
 * `/api/pwa/install-event` so the audit lens captures install
 * conversion rate.
 *
 * Hidden when:
 *   - The app is already running in standalone mode
 *     (`display-mode: standalone`).
 *   - The user previously dismissed within the 30-day TTL
 *     (localStorage key `omniscribe.installPromptDismissedAt`).
 *   - The browser doesn't fire `beforeinstallprompt` (Safari).
 *
 * Mounted at the root layout. Renders nothing in the common case.
 */

const DISMISS_KEY = 'omniscribe.installPromptDismissedAt';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  platforms?: string[];
};

export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Already installed — never show.
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Recently dismissed — wait out the TTL.
    const dismissedAtStr = window.localStorage.getItem(DISMISS_KEY);
    if (dismissedAtStr) {
      const dismissedAt = Number.parseInt(dismissedAtStr, 10);
      if (!Number.isNaN(dismissedAt) && Date.now() - dismissedAt < DISMISS_TTL_MS) {
        return;
      }
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
      setHidden(false);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setHidden(true);
    setDeferredEvent(null);
  }, []);

  const install = useCallback(async () => {
    if (!deferredEvent) return;
    try {
      await deferredEvent.prompt();
      const choice = await deferredEvent.userChoice;
      // Audit outcome regardless of accept/dismiss.
      void fetch('/api/pwa/install-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: choice.outcome,
          platforms: deferredEvent.platforms ?? null,
        }),
      }).catch(() => {
        /* best-effort; install proceeds regardless of audit success */
      });
      if (choice.outcome === 'dismissed') {
        dismiss();
      } else {
        setHidden(true);
        setDeferredEvent(null);
      }
    } catch {
      // Browser already handled / dismissed.
      dismiss();
    }
  }, [deferredEvent, dismiss]);

  if (hidden || !deferredEvent) return null;

  return (
    <div
      role="dialog"
      aria-label="Install OmniScribe"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-border bg-card p-3 shadow-lg space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">Install OmniScribe</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Add to your iPad home screen for full-screen access + offline-aware
        shell.
      </p>
      <Button
        type="button"
        size="sm"
        onClick={install}
        className="gap-1 w-full"
      >
        <Download className="h-3 w-3" aria-hidden />
        Install
      </Button>
    </div>
  );
}
