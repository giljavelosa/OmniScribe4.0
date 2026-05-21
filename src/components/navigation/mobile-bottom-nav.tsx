'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { OrgRole, PlatformRole } from '@prisma/client';
import {
  FileEdit,
  Home,
  MoreHorizontal,
  Stethoscope,
  Mic,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

type Props = {
  role: OrgRole | null;
  platformRole: PlatformRole;
  orgName?: string | null;
};

const ADMIN_ROLES: OrgRole[] = ['ORG_ADMIN', 'SITE_ADMIN'];

/**
 * MobileBottomNav — fixed 5-item bottom navigation bar, lg:hidden.
 *
 * Shown on every clinical page on mobile. Mirrors the AppNav links
 * that are hidden at < lg breakpoints. "Record" links to /patients
 * (patient lookup is the gate to starting a recording — you must
 * select a patient first). "More" opens a sheet with role-gated
 * admin/owner/ops links.
 *
 * Safe-area-inset-bottom is applied so the bar clears the iOS home
 * indicator on notched devices.
 */
export function MobileBottomNav({ role, platformRole, orgName }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isAdmin = role && ADMIN_ROLES.includes(role);
  const isOwner = platformRole === 'PLATFORM_OWNER';
  const isOps = platformRole === 'PLATFORM_OPS' || isOwner;
  const hasConsole = isAdmin || isOwner || isOps;

  function active(prefix: string) {
    return pathname?.startsWith(prefix) ?? false;
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        'lg:hidden',
        'fixed bottom-0 left-0 right-0 z-40',
        'flex items-stretch',
        'bg-primary',
        'h-16',
        // Safe area inset for iOS notched devices
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <NavItem href="/home" label="Home" Icon={Home} active={active('/home')} />
      <NavItem href="/patients" label="Patients" Icon={Stethoscope} active={active('/patients')} />
      <NavItem href="/patients" label="Record" Icon={Mic} active={false} primary />
      <NavItem
        href="/review"
        label="Drafts"
        Icon={FileEdit}
        active={active('/review') || active('/sign') || active('/processing')}
      />

      {/* "More" — opens a sheet with role-gated console links.
          For users with no console access, More is still shown but
          the sheet just shows settings/sign-out links. */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="More options"
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 pt-1',
              'text-primary-foreground/70 hover:text-white transition-colors',
              'min-h-[var(--touch-min)]',
            )}
          >
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </SheetTrigger>

        <SheetContent side="bottom" className="max-h-[60dvh] rounded-t-xl">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm">More</SheetTitle>
            {orgName && (
              <p className="text-xs text-muted-foreground">{orgName}</p>
            )}
          </SheetHeader>
          <div className="space-y-1 pb-4">
            {hasConsole && (
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-1 pb-1">
                Admin
              </p>
            )}
            {isAdmin && (
              <>
                <SheetLink href="/admin/users" label="Team members" onClose={() => setMoreOpen(false)} />
                <SheetLink href="/admin/templates" label="Templates" onClose={() => setMoreOpen(false)} />
                <SheetLink href="/admin/seats" label="Seats &amp; billing" onClose={() => setMoreOpen(false)} />
                <SheetLink href="/admin/audit" label="Audit log" onClose={() => setMoreOpen(false)} />
              </>
            )}
            {isOwner && (
              <SheetLink href="/owner/orgs" label="Owner console" onClose={() => setMoreOpen(false)} />
            )}
            {isOps && (
              <SheetLink href="/ops" label="Ops dashboard" onClose={() => setMoreOpen(false)} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

function NavItem({
  href,
  label,
  Icon,
  active,
  primary = false,
}: {
  href: string;
  label: string;
  Icon: typeof Home;
  active: boolean;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 pt-1',
        'min-h-[var(--touch-min)] transition-colors',
        active || primary ? 'text-white' : 'text-primary-foreground/60 hover:text-white',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full transition-colors px-3 py-0.5',
          active && 'bg-white/20',
          primary && !active && 'bg-white/15',
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="text-[10px] font-medium">
        {label}
      </span>
    </Link>
  );
}

function SheetLink({
  href,
  label,
  onClose,
}: {
  href: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex items-center rounded-md px-3 py-2.5 text-sm hover:bg-muted/60 min-h-[var(--touch-min)]"
    >
      {label}
    </Link>
  );
}
