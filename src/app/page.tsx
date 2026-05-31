import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, FileSignature, Lock, Sparkles } from 'lucide-react';

import { BrandWordmark } from '@/components/brand-wordmark';

export const metadata: Metadata = {
  title: 'OmniScribe — clinical AI scribe + agentic copilot',
  description:
    'HIPAA-grade medical AI scribe with an integrated agentic clinical copilot. Self-serve org registration; per-visit ambient capture; signed-note compliance trail; strict audited platform-owner workflows for validated registration and tenant-database deletion requests.',
};

/**
 * / — Unit 37 public landing page.
 *
 * Replaces the previous `redirect('/login')`. Server-rendered, no
 * auth gate, no DB calls — safe to cache + safe for crawlers (the
 * metadata above feeds open-graph automatically).
 *
 * Minimal: brand + 1-sentence pitch + 4 feature bullets + 2 CTAs.
 * Marketing depth (pricing, features, blog) is deferred to a future
 * post-GA unit.
 */
export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-6 h-13 flex items-center justify-between">
          <BrandWordmark />
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center min-h-[var(--touch-min)] rounded-md bg-primary text-primary-foreground px-4 text-sm font-medium hover:opacity-90"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <section className="flex-1 mx-auto w-full max-w-5xl px-6 py-12 sm:py-20 space-y-12">
        <div className="space-y-6 max-w-2xl">
          <h1 className="text-xl sm:text-2lg font-semibold leading-tight">
            HIPAA-grade ambient scribe + agentic clinical copilot, built for the
            real visit.
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            OmniScribe records the encounter, drafts a note in your template,
            surfaces the prior-context brief, and answers questions about the
            patient&apos;s chart in real time — all source-grounded, all
            audit-trailed.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center min-h-[var(--touch-min)] rounded-md bg-primary text-primary-foreground px-5 text-sm font-medium hover:opacity-90"
            >
              Get started — free trial
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center min-h-[var(--touch-min)] rounded-md border border-border px-5 text-sm font-medium hover:bg-muted"
            >
              I have an account
            </Link>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 max-w-3xl">
          <Feature
            Icon={Sparkles}
            title="Ambient note generation"
            body="Capture the visit; OmniScribe drafts the SOAP note in your template. Sign when it's right."
          />
          <Feature
            Icon={CheckCircle2}
            title="Source-grounded copilot"
            body="Ask about prior visits, follow-ups, or evidence — every answer cites attested sources."
          />
          <Feature
            Icon={Lock}
            title="HIPAA + BAA throughout"
            body="Bedrock + Soniox BAAs in place. Per-org audit retention, PHI fences, and audited deletion-request workflows."
          />
          <Feature
            Icon={FileSignature}
            title="Compliance-first"
            body="Signed notes are immutable. Audit trail captures who, what, when — including AI suggestions."
          />
        </div>

        <p className="text-[11px] text-muted-foreground italic">
          New orgs land on the STARTER tier. BAA countersignature happens before
          you process real PHI; until then you&apos;re in sandbox mode.
        </p>
      </section>
    </main>
  );
}

function Feature({
  Icon,
  title,
  body,
}: {
  Icon: typeof Sparkles;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
