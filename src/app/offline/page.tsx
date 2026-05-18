import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';

import { BrandWordmark } from '@/components/brand-wordmark';

export const metadata: Metadata = {
  title: 'Offline',
  // Suppress robots since this is a fallback shell, not real content.
  robots: { index: false, follow: false },
};

/**
 * /offline — Unit 36.
 *
 * Static-generation eligible (no auth gate; no DB). Served by the
 * service worker as the navigation fallback when fetch fails. Also
 * directly reachable so dev can preview the surface without forcing
 * an offline state.
 *
 * The "Try again" button reloads the current location (which will
 * be /offline itself the first time, then re-attempt the original
 * destination if the SW's cache has it). Keeping the action a plain
 * <button onClick> would require a client boundary; an <a href>
 * works server-side + keeps this page free of JS.
 */
export default function OfflinePage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center space-y-6">
      <BrandWordmark />
      <div className="flex flex-col items-center gap-2">
        <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="text-2lg font-semibold">You&apos;re offline</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          OmniScribe couldn&apos;t reach the network. Already-loaded screens
          remain available, but new pages + AI features need a connection.
        </p>
      </div>
      <Link
        href="/home"
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        Try again
      </Link>
      <p className="text-[11px] text-muted-foreground italic max-w-md">
        Tip: if you were mid-capture, the recording continues locally. Reconnect
        before signing the note so transcripts can finalize.
      </p>
    </main>
  );
}
