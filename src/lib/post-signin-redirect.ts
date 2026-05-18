/**
 * D2 — always-required MFA decision tree.
 *
 *   mfaEnabled ?
 *     no  → /mfa-setup  (cannot reach /home until enrolled)
 *     yes →
 *       mfaVerified ?
 *         no  → /mfa-challenge
 *         yes → /home
 */
export type SigninState = {
  mfaEnabled: boolean;
  mfaVerified: boolean;
};

export function postSigninRedirect(state: SigninState): '/home' | '/mfa-setup' | '/mfa-challenge' {
  if (!state.mfaEnabled) return '/mfa-setup';
  if (!state.mfaVerified) return '/mfa-challenge';
  return '/home';
}
