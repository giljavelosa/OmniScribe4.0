'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { OrgRole, PlatformRole } from '@prisma/client';
import {
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Wrench,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * AppNav — Polish (post-Wave 6).
 *
 * Role-aware global navigation strip. Renders inside each layout's
 * header (clinical, admin, owner, ops) so a user can jump between
 * surfaces without memorizing URLs. Highlights the current section
 * when the route prefix matches.
 *
 * Visibility matrix:
 *   - Clinical group (Home, Patients): every authenticated user
 *   - Admin link: SUPER_ADMIN, ORG_ADMIN, SITE_ADMIN
 *   - Owner link: PLATFORM_OWNER (platformRole)
 *   - Ops link: PLATFORM_OWNER OR PLATFORM_OPS (platformRole)
 *
 * The component is server-renderable — it takes the user's roles as
 * props from the layout's `auth()` call. No client-side role checks.
 *
 * `currentPath` is the route prefix the page lives under (e.g.
 * '/admin', '/owner', '/patients'). The layout passes it explicitly
 * so we don't rely on usePathname (which would force client boundary).
 */

const ADMIN_ROLES: OrgRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'SITE_ADMIN'];

export type AppNavProps = {
  email: string;
  role: OrgRole | null;
  platformRole: PlatformRole;
  /** Current top-level path segment, e.g. '/home', '/patients',
   *  '/admin', '/owner', '/ops'. Used to highlight the active link. */
  currentSection?: string;
};

type NavItem = {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  section: string;
};

export function AppNav({ email, role, platformRole, currentSection }: AppNavProps) {
  // Derive the active section from the current pathname when the layout
  // doesn't pass one explicitly — without this, no link ever highlights.
  const pathname = usePathname();
  const derivedSection = currentSection ?? deriveSection(pathname);
  const isAdmin = role && ADMIN_ROLES.includes(role);
  const isOwner = platformRole === 'PLATFORM_OWNER';
  const isOps = platformRole === 'PLATFORM_OPS' || isOwner;

  // Clinician-side: visible to everyone signed in.
  const clinicalItems: NavItem[] = [
    { href: '/home', label: 'Home', Icon: LayoutDashboard, section: '/home' },
    { href: '/patients', label: 'Patients', Icon: Stethoscope, section: '/patients' },
  ];

  // Role-gated console links.
  const consoleItems: NavItem[] = [];
  if (isAdmin) {
    consoleItems.push({
      href: '/admin/users',
      label: 'Administration',
      Icon: ShieldCheck,
      section: '/admin',
    });
  }
  if (isOwner) {
    consoleItems.push({
      href: '/owner/orgs',
      label: 'Owner',
      Icon: Sparkles,
      section: '/owner',
    });
  }
  if (isOps) {
    consoleItems.push({
      href: '/ops',
      label: 'Ops',
      Icon: Wrench,
      section: '/ops',
    });
  }

  return (
    <nav
      aria-label="Primary"
      className="flex items-center gap-1 flex-wrap"
    >
      {clinicalItems.map((item) => (
        <NavLink key={item.href} {...item} active={derivedSection === item.section} />
      ))}
      {consoleItems.length > 0 && (
        <>
          <span className="text-muted-foreground/40 px-1" aria-hidden>
            ·
          </span>
          {consoleItems.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              active={derivedSection === item.section}
            />
          ))}
        </>
      )}
      <span className="ml-auto pl-3 text-xs text-muted-foreground truncate max-w-[16rem]">
        {email}
      </span>
    </nav>
  );
}

/** Pull the top-level segment (e.g. '/admin', '/patients', '/home') from
 *  the current pathname so the matching nav link highlights. */
function deriveSection(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? `/${first}` : undefined;
}

function NavLink({
  href,
  label,
  Icon,
  active,
}: NavItem & { active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 min-h-[var(--touch-min)] text-sm',
        active
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Link>
  );
}

/** Small chip showing the current console name + the platform role.
 *  Used in admin/owner/ops layouts to make the consoles' context obvious. */
export function ConsoleBadge({ label, tone }: { label: string; tone: 'admin' | 'owner' | 'ops' }) {
  const variant =
    tone === 'owner' ? 'violet' : tone === 'ops' ? 'warning' : 'info';
  return (
    <StatusBadge variant={variant} noIcon className="uppercase text-[10px]">
      {label}
    </StatusBadge>
  );
}
