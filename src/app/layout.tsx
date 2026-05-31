import type { Metadata, Viewport } from 'next';
import { Inter, Geist, Geist_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';
import { ImpersonationBanner } from '@/components/impersonation-banner';
import { RegisterServiceWorker } from '@/components/pwa/register-sw';
import { InstallPrompt } from '@/components/pwa/install-prompt';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'OmniScribe',
    template: '%s · OmniScribe',
  },
  description:
    'HIPAA-grade medical AI scribe with an integrated agentic clinical copilot, self-serve registration, and strict audited platform-owner workflows for validated registration and tenant-database deletion requests, subject to HIPAA, BAA, retention, and legal-hold requirements.',
  applicationName: 'OmniScribe',
  formatDetection: { telephone: false },
  // Unit 36 — PWA manifest reference. Static file at public/manifest.json;
  // Next emits the proper <link rel="manifest"> tag.
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'OmniScribe',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#3d8b8b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground antialiased">
        <Providers>
          {/* Unit 32 — global impersonation banner. Self-renders nothing
              when no impersonation is active, so safe to mount at root. */}
          <ImpersonationBanner />
          {/* Unit 36 — PWA infrastructure. RegisterServiceWorker is
              effect-only (no DOM); InstallPrompt self-renders nothing
              until beforeinstallprompt fires + the user is eligible. */}
          <RegisterServiceWorker />
          <InstallPrompt />
          {children}
        </Providers>
      </body>
    </html>
  );
}
