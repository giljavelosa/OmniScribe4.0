'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import type { OrgRole, PlatformRole } from '@prisma/client';
import {
  Gauge,
  LayoutDashboard,
  LogOut,
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
 *   - Admin link: ORG_ADMIN, SITE_ADMIN
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

const ADMIN_ROLES: OrgRole[] = ['ORG_ADMIN', 'SITE_ADMIN'];

export type AppNavProps = {
  email: string;
  role: OrgRole | null;
  platformRole: PlatformRole;
  /** Organization name — shown as a small pill in the header so the
   *  clinician always knows which workspace they are operating in. */
  orgName?: string | null;
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

export function AppNav({ email, role, platformRole, orgName, currentSection }: AppNavProps) {
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
    // Usage page surfaces the per-period draft count + plan-comparison
    // table — the customer-facing half of the BillingPlan rollout.
    // Visible to every signed-in user because every plan (Solo / Duo /
    // Practice / Trial) has usage data worth seeing.
    { href: '/account/usage', label: 'Usage', Icon: Gauge, section: '/account' },
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
      {/* Nav links hidden on mobile — MobileBottomNav handles navigation
          on < lg viewports so we don't duplicate them in the header. */}
      {clinicalItems.map((item) => (
        <span key={item.href} className="hidden lg:inline-flex">
          <NavLink {...item} active={derivedSection === item.section} />
        </span>
      ))}
      {consoleItems.length > 0 && (
        <>
          <span className="hidden lg:inline-flex text-muted-foreground/40 px-1" aria-hidden>
            ·
          </span>
          {consoleItems.map((item) => (
            <span key={item.href} className="hidden lg:inline-flex">
              <NavLink
                {...item}
                active={derivedSection === item.section}
              />
            </span>
          ))}
        </>
      )}
      <div className="ml-auto pl-3 flex items-center gap-2">
        <div className="flex flex-col items-end gap-0.5">
          {orgName && (
            <span className="hidden sm:inline-flex items-center rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-primary-foreground/90 max-w-[14rem] truncate">
              {orgName}
            </span>
          )}
          <span className="text-xs text-primary-foreground/70 truncate max-w-[16rem]">
            {email}
          </span>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary-foreground/80 hover:text-primary-foreground hover:bg-white/10 transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-3 w-3" aria-hidden />
          Sign out
        </button>
      </div>
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
          ? 'bg-white/15 text-white font-medium'
          : 'text-primary-foreground/80 hover:text-white hover:bg-white/10',
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
