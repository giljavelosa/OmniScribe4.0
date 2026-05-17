'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Loader2, Mic, MicOff, RotateCw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import {
  checkBrowserCompat,
  measureRoundTrip,
  type CompatResult,
  type RoundTripResult,
} from '@/lib/telehealth/preflight';

type CheckStatus = 'idle' | 'running' | 'pass' | 'fail';

type CompatState = { status: CheckStatus; result: CompatResult | null };
type NetworkState = { status: CheckStatus; result: RoundTripResult | null };
type MicState = {
  status: CheckStatus;
  level: number; // 0..1 RMS smoothed
  reason: string | null;
};

const MIC_SAMPLE_RATE = 16_000;

/**
 * Preflight shell — three sequential-but-independent checks:
 *
 *   1. Browser compat (sync, pure logic from preflight.ts)
 *   2. Mic permission + live level meter (getUserMedia)
 *   3. Network RTT (fetch /api/telehealth/preflight/ping)
 *
 * Each check has its own retry. When all three pass, the "Continue to
 * telehealth room" button enables and navigates to the room. Failures
 * fire TELEHEALTH_PRECALL_CHECK_FAILED via the existing audit endpoint
 * so ops can see common setup failure modes.
 */
export function PreflightShell({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const [compat, setCompat] = useState<CompatState>({ status: 'idle', result: null });
  const [mic, setMic] = useState<MicState>({ status: 'idle', level: 0, reason: null });
  const [network, setNetwork] = useState<NetworkState>({ status: 'idle', result: null });

  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const auditFail = useCallback((check: 'mic' | 'network' | 'browser_compat', reason: string) => {
    void fetch('/api/audit/copilot-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'TELEHEALTH_PRECALL_CHECK_FAILED',
        surface: 'telehealth-room',
        // noteId is required by the existing endpoint schema; pass scheduleId
        // here (the surface is pre-room so there's no noteId yet — the audit
        // row's resourceType ends up Note but the resourceId is the schedule
        // for easy join). Acceptable compromise to avoid forking the audit
        // ingress for one new action.
        noteId: scheduleId,
        itemCount: 0,
      }),
    }).catch(() => {});
    void check;
    void reason;
  }, [scheduleId]);

  const teardownMic = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioContextRef.current?.state !== 'closed') void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const runCompat = useCallback(() => {
    setCompat({ status: 'running', result: null });
    const result = checkBrowserCompat();
    setCompat({ status: result.ok ? 'pass' : 'fail', result });
    if (!result.ok) auditFail('browser_compat', JSON.stringify(result.details));
  }, [auditFail]);

  const runMic = useCallback(async () => {
    teardownMic();
    setMic({ status: 'running', level: 0, reason: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: MIC_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setMic((m) => (m.status === 'pass' || m.status === 'running' ? { ...m, level: rms } : m));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setMic({ status: 'pass', level: 0, reason: null });
    } catch (e) {
      const reason = e instanceof Error ? e.name : String(e);
      setMic({ status: 'fail', level: 0, reason });
      auditFail('mic', reason);
    }
  }, [auditFail, teardownMic]);

  const runNetwork = useCallback(async () => {
    setNetwork({ status: 'running', result: null });
    const r = await measureRoundTrip();
    setNetwork({ status: r.ok ? 'pass' : 'fail', result: r });
    if (!r.ok) auditFail('network', r.reason);
  }, [auditFail]);

  // Kick all three checks on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runCompat();
    void runMic();
    void runNetwork();
    return () => teardownMic();
  }, [runCompat, runMic, runNetwork, teardownMic]);

  const allPass = compat.status === 'pass' && mic.status === 'pass' && network.status === 'pass';

  return (
    <div className="space-y-4">
      <CheckRow
        title="Browser compatibility"
        status={compat.status}
        right={
          compat.status === 'fail' && compat.result ? (
            <span className="text-xs text-[var(--status-danger-fg)]">
              {compat.result.details.hasMediaStreamTrackProcessor
                ? 'Missing required API'
                : 'Use Chrome or Edge'}
            </span>
          ) : compat.status === 'pass' ? (
            <span className="text-xs text-muted-foreground">Supported</span>
          ) : null
        }
        retry={runCompat}
      />
      <CheckRow
        title="Microphone"
        status={mic.status}
        right={
          mic.status === 'pass' ? (
            <MicLevelBar level={mic.level} />
          ) : mic.status === 'fail' ? (
            <span className="text-xs text-[var(--status-danger-fg)] flex items-center gap-1">
              <MicOff className="h-3 w-3" aria-hidden /> {micFailMessage(mic.reason)}
            </span>
          ) : mic.status === 'running' ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Mic className="h-3 w-3" aria-hidden /> Requesting access…
            </span>
          ) : null
        }
        retry={runMic}
      />
      <CheckRow
        title="Network"
        status={network.status}
        right={
          network.status === 'pass' && network.result?.ok ? (
            <span className="text-xs text-muted-foreground">RTT {network.result.rttMs} ms</span>
          ) : network.status === 'fail' && network.result && !network.result.ok ? (
            <span className="text-xs text-[var(--status-danger-fg)]">
              {network.result.reason === 'timeout' ? 'Slow or unreachable' : 'Network error'}
            </span>
          ) : null
        }
        retry={runNetwork}
      />

      {!allPass && (
        <StatusBanner variant="warning">
          Resolve the failing checks above before joining the room. Fix the issue, then click the
          retry button on that check.
        </StatusBanner>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={!allPass}
        onClick={() => {
          teardownMic();
          router.push(`/telehealth/room/${scheduleId}`);
        }}
      >
        Continue to telehealth room
      </Button>
    </div>
  );
}

function CheckRow({
  title,
  status,
  right,
  retry,
}: {
  title: string;
  status: CheckStatus;
  right: React.ReactNode;
  retry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-3 min-w-0">
        <StatusGlyph status={status} />
        <p className="text-sm font-medium">{title}</p>
      </div>
      <div className="flex items-center gap-2">
        {right}
        {(status === 'fail' || status === 'pass') && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={retry} aria-label={`Retry ${title}`}>
            <RotateCw className="h-3 w-3" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: CheckStatus }) {
  if (status === 'pass') {
    return <CheckCircle2 className="h-5 w-5 text-[var(--status-success-fg)]" aria-hidden />;
  }
  if (status === 'fail') {
    return <XCircle className="h-5 w-5 text-[var(--status-danger-fg)]" aria-hidden />;
  }
  if (status === 'running') {
    return <Loader2 className="h-5 w-5 animate-spin text-[var(--status-info-fg)]" aria-hidden />;
  }
  return <Circle className="h-5 w-5 text-muted-foreground/40" aria-hidden />;
}

function MicLevelBar({ level }: { level: number }) {
  const pct = Math.min(100, Math.round(level * 200));
  return (
    <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full bg-[var(--status-success-fg)] transition-[width] duration-100"
        style={{ width: `${pct}%` }}
        aria-label={`Mic level ${pct}%`}
      />
    </div>
  );
}

function micFailMessage(reason: string | null): string {
  if (!reason) return 'Mic unavailable';
  if (reason === 'NotAllowedError') return 'Permission denied';
  if (reason === 'NotFoundError') return 'No mic detected';
  if (reason === 'NotReadableError') return 'Mic in use by another app';
  return 'Mic unavailable';
}
