'use client';

import { useEffect, useState } from 'react';

/**
 * usePrefersReducedMotion — Unit 36.
 *
 * Reads + subscribes to the `prefers-reduced-motion: reduce` media
 * query. Returns `true` when the user has asked the OS to suppress
 * non-essential motion.
 *
 * SSR-safe: returns `false` on the server (default to "motion
 * allowed" since the server can't know the user's preference; client
 * hydration corrects on first effect).
 *
 * Use this in client components that programmatically animate
 * (motion library tweens, CSS-in-JS transitions, canvas effects).
 * Global CSS already suppresses `animation-duration` + `transition-
 * duration` via the media query in `globals.css`; this hook covers
 * the JS-driven cases the CSS rule can't reach.
 *
 * @example
 *   const reducedMotion = usePrefersReducedMotion();
 *   <motion.div animate={reducedMotion ? false : { opacity: 1 }} />
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Sync initial state on mount (the first render returned `false`
    // — this corrects it if the user has the preference enabled).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(mql.matches);

    function onChange(e: MediaQueryListEvent) {
      setReduced(e.matches);
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
