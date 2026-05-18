'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';

const POLL_INTERVAL_MS = 5_000;

type SessionStatus =
  | 'SCHEDULED'
  | 'VERIFIED'
  | 'CONSENT_CAPTURED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

type StatusResponse = {
  status: SessionStatus;
  scheduleId: string;
  roomUrl: string | null;
  magicExpiresAt: string;
};

/**
 * Patient waiting-room state machine, client-side. Three concerns:
 *
 *   1. Consent capture — VERIFIED requires a single checkbox + Submit
 *      before the clinician can start the call. Posts to /me/consent.
 *   2. Status polling — every 5s while NOT in a terminal state. Stops
 *      on ACTIVE/COMPLETED/CANCELLED/EXPIRED to avoid runaway requests
 *      after the patient walks away with the tab open.
 *   3. Join-call CTA — appears when status is ACTIVE; opens the Daily.co
 *      room in a new tab. (Real /telehealth/room/[scheduleId] surface
 *      lands in Unit 17; v1 just hands off the room URL.)
 *
 * The magic token never touches this component — the cookie set during
 * verify carries it server-side.
 */
export function WaitingRoom({
  initialStatus,
  consentVersion,
  scheduledStartIso,
}: {
  initialStatus: SessionStatus;
  consentVersion: string;
  scheduledStartIso: string;
}) {
  const [status, setStatus] = useState<SessionStatus>(initialStatus);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [consentPending, startConsent] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTerminal =
    status === 'COMPLETED' || status === 'CANCELLED' || status === 'EXPIRED';

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/telehealth/me/status', { cache: 'no-store' });
      if (!res.ok) {
        // 401 here typically means the cookie has expired (2-hour cap);
        // surface a clear nudge to re-enter via the magic link rather
        // than silently spinning.
        setPollError(
          res.status === 401
            ? 'Your session expired. Please open your appointment link again from your email.'
            : 'We can’t reach the server right now. Retrying…',
        );
        return;
      }
      const body = (await res.json()) as { data: StatusResponse };
      setStatus(body.data.status);
      setRoomUrl(body.data.roomUrl);
      setPollError(null);
    } catch {
      setPollError('We can’t reach the server right now. Retrying…');
    }
  }, []);

  useEffect(() => {
    if (isTerminal) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    // Kick a poll right away so a stale initial status flips quickly,
    // then settle into the cadence.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStatus();
    pollRef.current = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, isTerminal]);

  function submitConsent() {
    setConsentError(null);
    if (!consentChecked) {
      setConsentError('Please confirm the consent statement to continue.');
      return;
    }
    startConsent(async () => {
      const res = await fetch('/api/telehealth/me/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentVersion }),
      });
      if (!res.ok) {
        setConsentError('We couldn’t record your consent. Please try again.');
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { data?: { status?: SessionStatus } }
        | null;
      if (body?.data?.status) {
        setStatus(body.data.status);
      }
    });
  }

  if (status === 'VERIFIED') {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-foreground/90 space-y-2">
          <p className="font-medium">Telehealth consent</p>
          <p>
            I understand this visit will be conducted by video. The clinician may share information
            with my care team and document the visit in my chart. I can withdraw at any time by
            ending the call.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <input
            id="consent"
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            disabled={consentPending}
            className="mt-1 h-4 w-4 rounded border-border"
          />
          <Label htmlFor="consent" className="text-sm font-normal">
            I have read and agree to the telehealth consent above.
          </Label>
        </div>
        {consentError && <StatusBanner variant="danger">{consentError}</StatusBanner>}
        <Button
          type="button"
          className="w-full"
          disabled={consentPending || !consentChecked}
          onClick={submitConsent}
        >
          {consentPending ? 'Recording…' : 'I consent — continue'}
        </Button>
      </div>
    );
  }

  if (status === 'ACTIVE' && roomUrl) {
    return (
      <div className="space-y-3">
        <StatusBanner variant="success" title="Your provider is ready">
          Tap the button below to join the video call.
        </StatusBanner>
        <Button asChild className="w-full">
          <a href={roomUrl} target="_blank" rel="noopener noreferrer">
            <Video className="mr-2 h-4 w-4" aria-hidden />
            Join call
          </a>
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          The call opens in a new tab. Keep this window open in case you need to rejoin.
        </p>
      </div>
    );
  }

  if (status === 'COMPLETED') {
    return (
      <StatusBanner variant="success" title="Visit complete">
        Thanks for joining your telehealth visit. You can close this page.
      </StatusBanner>
    );
  }

  if (status === 'CANCELLED' || status === 'EXPIRED') {
    return (
      <StatusBanner variant="warning" title="Visit unavailable">
        This visit was cancelled or expired. Please contact your clinic for next steps.
      </StatusBanner>
    );
  }

  // CONSENT_CAPTURED or anything else mid-flow — waiting for clinician.
  const startTime = new Date(scheduledStartIso);
  const startLabel = startTime.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div className="space-y-4 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--status-info-fg)]" aria-hidden />
      <p className="text-sm text-foreground/90">Waiting for your provider…</p>
      <p className="text-xs text-muted-foreground">Scheduled for {startLabel}</p>
      {pollError && <StatusBanner variant="warning">{pollError}</StatusBanner>}
    </div>
  );
}
