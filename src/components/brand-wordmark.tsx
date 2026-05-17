import { cn } from '@/lib/cn';

type Props = {
  className?: string;
  /** Show only the quill, no wordmark text. */
  iconOnly?: boolean;
};

/**
 * OmniScribe wordmark — quill SVG + Geist Sans gradient text.
 * Spec: ui-context.md "Brand". Single canonical name "OmniScribe" (rule: always one word, capital O + capital S).
 */
export function BrandWordmark({ className, iconOnly = false }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 select-none',
        'font-display text-lg font-semibold',
        className,
      )}
      aria-label="OmniScribe"
    >
      <svg
        viewBox="0 0 22 22"
        width="22"
        height="22"
        aria-hidden="true"
        className="drop-shadow-[0_4px_10px_rgba(0,0,0,0.22)] dark:drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
      >
        <defs>
          <linearGradient id="osw-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#064d2a" />
            <stop offset="50%" stopColor="#0B7A42" />
            <stop offset="100%" stopColor="#3da878" />
          </linearGradient>
        </defs>
        <path
          d="M16.6 3.4c-2.4 0-4.6 1.2-6.4 3.4-2 2.4-3.4 5.6-3.8 8.6l-1.2 4 4-1.2c3-.4 6.2-1.8 8.6-3.8 2.2-1.8 3.4-4 3.4-6.4 0-2.4-2-4.6-4.6-4.6z"
          fill="url(#osw-grad)"
          stroke="url(#osw-grad)"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        <path
          d="M5.4 17.2c-.6.6-1.2 1.2-1.8 1.6"
          stroke="url(#osw-grad)"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {!iconOnly && (
        <span
          className="bg-gradient-to-r from-[#064d2a] via-[#0B7A42] to-[#3da878] bg-clip-text text-transparent"
        >
          OmniScribe
        </span>
      )}
    </span>
  );
}
