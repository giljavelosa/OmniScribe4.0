import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  firstName: string;
  lastName: string;
  /** When set, renders a photo instead of initials. Must be a presigned URL — never a raw DB value. */
  imageUrl?: string | null;
  size?: Size;
  className?: string;
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

/**
 * UserAvatar — deterministic initials circle, photo-ready.
 *
 * Color slot is derived from the sum of the first char codes of first
 * and last name modulo 5 — same name always gets the same color, but
 * adjacent names in a list get visually distinct colors.
 *
 * PHI rule: imageUrl must be a presigned S3 URL with a short TTL.
 * Never pass a raw DB column value; never log or store the URL
 * client-side.
 */
export function UserAvatar({ firstName, lastName, imageUrl, size = 'md', className }: Props) {
  const initials = deriveInitials(firstName, lastName);
  const label = `${firstName} ${lastName}`;
  const sizeClass = SIZE_CLASSES[size];

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={label}
        aria-label={label}
        className={cn('rounded-full object-cover shrink-0', sizeClass, className)}
      />
    );
  }

  const { bg, text } = colorSlot(firstName, lastName);

  return (
    <span
      aria-label={label}
      role="img"
      className={cn(
        'inline-flex items-center justify-center rounded-full shrink-0 font-semibold select-none',
        sizeClass,
        bg,
        text,
        className,
      )}
    >
      {initials}
    </span>
  );
}

function deriveInitials(first: string, last: string): string {
  const f = first.trim()[0] ?? '?';
  const l = last.trim()[0] ?? '';
  return (f + l).toUpperCase();
}

/**
 * Five deterministic color slots. Uses /15 opacity backgrounds to stay
 * calm on white cards while still distinguishing identities visually.
 * Slot 4 (muted) is the fallback for names starting with non-letters.
 */
function colorSlot(first: string, last: string): { bg: string; text: string } {
  const a = first.trim().charCodeAt(0) || 0;
  const b = last.trim().charCodeAt(0) || 0;
  const slot = (a + b) % 5;

  switch (slot) {
    case 0:
      return { bg: 'bg-primary/15', text: 'text-primary' };
    case 1:
      // info blue
      return {
        bg: 'bg-[oklch(0.55_0.15_240)]/15',
        text: 'text-[oklch(0.55_0.15_240)]',
      };
    case 2:
      // violet
      return {
        bg: 'bg-[oklch(0.50_0.18_295)]/15',
        text: 'text-[oklch(0.50_0.18_295)]',
      };
    case 3:
      // warm amber
      return {
        bg: 'bg-[oklch(0.55_0.18_75)]/15',
        text: 'text-[oklch(0.55_0.18_75)]',
      };
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground' };
  }
}
